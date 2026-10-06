#!/bin/bash
# One-time AWS provisioning for the commerce-platform prod stack (ap-southeast-7, josh's default VPC).
# Creates: 3 ECR repos, 2 security groups, EC2 IAM role, RDS Postgres db.t4g.small, EC2 t4g.large + Elastic IP.
# Cost (Bangkok on-demand, 2026-10): EC2 ~$56 + EBS ~$3.5 + EIP ~$3.7 + RDS ~$34 + RDS storage ~$2.5 ≈ $99/month.
# Upgrade when scraping/offload load is real: EC2 → m7g.large (stop/start), RDS → db.t4g.medium (modify).
#
# Does NOT touch josh's security group (sg-0d2e4da9ca5115d1c). It currently allows 5432/27017 from 0.0.0.0/0,
# so commerce can reach josh's DBs today; when those rules get closed, first add:
#   aws ec2 authorize-security-group-ingress --group-id $JOSH_SG --protocol tcp --port 5432  --source-group <commerce-platform-sg>
#   aws ec2 authorize-security-group-ingress --group-id $JOSH_SG --protocol tcp --port 27017 --source-group <commerce-platform-sg>
#
# Usage: ./aws-provision.sh   (run once; not idempotent — re-running fails on "already exists")
set -euo pipefail
export AWS_REGION=ap-southeast-7 AWS_PAGER=""

VPC=vpc-0785d0cc40921461f
SUBNET=subnet-0a3fa6177d5e57523          # 172.31.32.0/20, ap-southeast-7c — same AZ as josh-db/josh-web
AZ=ap-southeast-7c
JOSH_SG=sg-0d2e4da9ca5115d1c
ALL_SUBNETS="subnet-0a3fa6177d5e57523 subnet-0911a12e0e08bafbd subnet-0d0beed13367ca95d"  # RDS subnet group needs >=2 AZs
TAGS='{Key=Project,Value=commerce-platform}'

echo "== ECR"
for repo in commerce-platform commerce-admin commerce-portal; do
  aws ecr create-repository --repository-name "$repo" --image-scanning-configuration scanOnPush=true \
    --encryption-configuration encryptionType=AES256 --query 'repository.repositoryUri' --output text
done

echo "== Security groups"
APP_SG=$(aws ec2 create-security-group --group-name commerce-platform-sg --vpc-id $VPC \
  --description "commerce-platform EC2" --tag-specifications "ResourceType=security-group,Tags=[$TAGS]" \
  --query GroupId --output text)
# API reachable from josh servers only. No SSH (use SSM); admin/portal via SSM port-forward until nginx/TLS exists.
aws ec2 authorize-security-group-ingress --group-id "$APP_SG" --protocol tcp --port 3100 --source-group $JOSH_SG >/dev/null

DB_SG=$(aws ec2 create-security-group --group-name commerce-db-sg --vpc-id $VPC \
  --description "commerce-platform RDS" --tag-specifications "ResourceType=security-group,Tags=[$TAGS]" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$DB_SG" --protocol tcp --port 5432 --source-group "$APP_SG" >/dev/null
echo "APP_SG=$APP_SG DB_SG=$DB_SG"

echo "== IAM role"
aws iam create-role --role-name commerce-platform-ec2-role --assume-role-policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
aws iam attach-role-policy --role-name commerce-platform-ec2-role --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
aws iam attach-role-policy --role-name commerce-platform-ec2-role --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam create-instance-profile --instance-profile-name commerce-platform-ec2-role >/dev/null
aws iam add-role-to-instance-profile --instance-profile-name commerce-platform-ec2-role --role-name commerce-platform-ec2-role
sleep 15  # instance profile propagation before run-instances

echo "== RDS (takes ~10-15 min to become available; continues in background)"
aws rds create-db-subnet-group --db-subnet-group-name commerce-db-subnets \
  --db-subnet-group-description "commerce-platform RDS" --subnet-ids $ALL_SUBNETS >/dev/null
aws rds create-db-instance \
  --db-instance-identifier commerce-prod \
  --engine postgres --engine-version 18.6 \
  --db-instance-class db.t4g.small \
  --storage-type gp3 --allocated-storage 20 --max-allocated-storage 100 --storage-encrypted \
  --db-name commerce_db --master-username commerce_admin --manage-master-user-password \
  --db-subnet-group-name commerce-db-subnets --availability-zone $AZ \
  --vpc-security-group-ids "$DB_SG" --no-publicly-accessible \
  --backup-retention-period 7 --preferred-backup-window 19:00-19:30 \
  --preferred-maintenance-window sun:20:00-sun:20:30 \
  --auto-minor-version-upgrade --deletion-protection --copy-tags-to-snapshot \
  --tags Key=Project,Value=commerce-platform >/dev/null
# windows are UTC: 19:00 UTC = 02:00 Bangkok

echo "== EC2"
AMI=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
  --query Parameter.Value --output text)
USERDATA=$(mktemp)
cat > "$USERDATA" <<'EOF'
#!/bin/bash
set -eux
dnf install -y docker git jq amazon-ecr-credential-helper
systemctl enable --now docker
usermod -aG docker ec2-user
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-aarch64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
mkdir -p /home/ec2-user/.docker
echo '{"credsStore":"ecr-login"}' > /home/ec2-user/.docker/config.json
chown -R ec2-user:ec2-user /home/ec2-user/.docker
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
EOF
INSTANCE=$(aws ec2 run-instances \
  --image-id "$AMI" --instance-type t4g.large \
  --subnet-id $SUBNET --security-group-ids "$APP_SG" \
  --iam-instance-profile Name=commerce-platform-ec2-role \
  --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":40,"VolumeType":"gp3","Encrypted":true,"DeleteOnTermination":true}}]' \
  --metadata-options HttpTokens=required,HttpPutResponseHopLimit=2,HttpEndpoint=enabled \
  --disable-api-termination --disable-api-stop \
  --user-data "file://$USERDATA" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=commerce-platform-prod},$TAGS]" \
                       "ResourceType=volume,Tags=[{Key=Name,Value=commerce-platform-prod},$TAGS]" \
  --query 'Instances[0].InstanceId' --output text)
rm -f "$USERDATA"
aws ec2 wait instance-running --instance-ids "$INSTANCE"

echo "== Elastic IP"
ALLOC=$(aws ec2 allocate-address --domain vpc \
  --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=commerce-platform-prod},$TAGS]" \
  --query AllocationId --output text)
aws ec2 associate-address --instance-id "$INSTANCE" --allocation-id "$ALLOC" >/dev/null

echo
echo "Done."
echo "  EC2:        $INSTANCE  ($(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text))"
echo "  APP_SG:     $APP_SG    DB_SG: $DB_SG"
echo "  ECR:        $(aws sts get-caller-identity --query Account --output text).dkr.ecr.$AWS_REGION.amazonaws.com"
echo "  RDS:        aws rds wait db-instance-available --db-instance-identifier commerce-prod && \\"
echo "              aws rds describe-db-instances --db-instance-identifier commerce-prod --query 'DBInstances[0].Endpoint.Address' --output text"
echo "  DB password lives in Secrets Manager (see RDS console → commerce-prod → Configuration → Master credentials ARN)."
echo "  Shell in:   aws ssm start-session --target $INSTANCE"
