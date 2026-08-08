.PHONY: setup dev stop status

setup:
	@command -v psql >/dev/null || { echo "psql not found — is Postgres.app running?"; exit 1; }
	@redis-cli ping >/dev/null 2>&1 || { echo "Redis not responding on :6379 (brew services start redis)"; exit 1; }
	@psql -h localhost -U $$USER -tAc "SELECT 1 FROM pg_database WHERE datname='commerce_db'" | grep -q 1 \
		|| { echo "creating commerce_db..."; createdb -h localhost -U $$USER commerce_db; }
	@COMMERCE_DB_HOST=localhost COMMERCE_DB_USERNAME=$$USER COMMERCE_DB_NAME=commerce_db npm run migration:run
	@echo "commerce_db ready. Start the stack with: make dev"

dev:
	@chmod +x scripts/commerce.sh && ./scripts/commerce.sh start

stop:
	@./scripts/commerce.sh stop

status:
	@./scripts/commerce.sh status
