#!/bin/bash
# Install GitHub Actions self-hosted runner on this EC2 (commerce-platform).
#
# Prerequisites:
#   - Docker, docker compose, aws CLI, git, jq, curl
#   - Repo admin: Settings → Actions → Runners → New self-hosted runner → copy token
#
# Usage (on EC2):
#   export RUNNER_TOKEN=XXXXXXXX
#   export GITHUB_REPO_URL=https://github.com/pongpanots-blip/commerce-platform
#   ./github-runner-setup.sh
#
# Then install as service (needs root once):
#   sudo ./svc.sh install
#   sudo ./svc.sh start
#
set -euo pipefail

RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner}"
RUNNER_VERSION="${RUNNER_VERSION:-2.329.0}"
GITHUB_REPO_URL="${GITHUB_REPO_URL:-https://github.com/pongpanots-blip/commerce-platform}"
RUNNER_NAME="${RUNNER_NAME:-commerce-platform-ec2}"
RUNNER_LABELS="${RUNNER_LABELS:-self-hosted,linux,commerce-platform}"

if [[ -z "${RUNNER_TOKEN:-}" ]]; then
  echo "Set RUNNER_TOKEN from: GitHub → Settings → Actions → Runners → New self-hosted runner"
  exit 1
fi

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Do not run config as root. Run as the deploy user (docker group), then sudo ./svc.sh install"
  exit 1
fi

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1"; exit 1; }; }
need curl
need tar

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

ARCH=$(uname -m)
case "$ARCH" in
  x86_64) RUNNER_ARCH=x64 ;;
  aarch64|arm64) RUNNER_ARCH=arm64 ;;
  *) echo "unsupported arch: $ARCH"; exit 1 ;;
esac

curl -fsSL -o actions-runner.tar.gz \
  "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
tar xzf actions-runner.tar.gz
rm actions-runner.tar.gz

./config.sh --url "$GITHUB_REPO_URL" --token "$RUNNER_TOKEN" \
  --name "$RUNNER_NAME" --labels "$RUNNER_LABELS" --unattended --replace

echo "Runner configured. Next:"
echo "  sudo $RUNNER_DIR/svc.sh install"
echo "  sudo $RUNNER_DIR/svc.sh start"
