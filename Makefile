# EFIP — developer & deploy shortcuts.
# Run `make help` for the list. All targets operate on the platform/ workspace.

PLATFORM := platform

.DEFAULT_GOAL := help
.PHONY: help install build typecheck audit ci seed seed-users start dev sync-dashboard docker-build deploy

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Clean install from the lockfile
	cd $(PLATFORM) && npm ci

build: ## Build shared + web and sync the dashboard (the deploy artifact)
	cd $(PLATFORM) && npm run build:deploy

typecheck: ## Typecheck all workspaces
	cd $(PLATFORM) && npm run build -w @efip/shared && npm run typecheck

audit: ## Security audit — fail on High or Critical
	cd $(PLATFORM) && npm audit --audit-level=high

ci: install typecheck build audit ## Run the full CI sequence locally

seed: ## Create/update the admin login from .env
	cd $(PLATFORM) && npm run seed

seed-users: ## Bulk-seed RC logins from platform/seed/rc_users.csv (gitignored)
	cd $(PLATFORM) && npm run seed:users

docker-build: ## Build the App Runner image (context = repo root)
	docker build -f $(PLATFORM)/Dockerfile -t efip-server .

start: ## Start the production server (reads platform/.env)
	cd $(PLATFORM) && npm start

dev: ## Run server + login SPA in watch mode
	cd $(PLATFORM) && npm run dev

sync-dashboard: ## Copy SAI_Financial_Intelligence.html into the server
	cd $(PLATFORM) && npm run sync:dashboard

deploy: ## Redeploy on the SERVER (git reset → build → restart). Run this on EC2.
	cd /opt/efip && git fetch --all && git reset --hard origin/main
	cd /opt/efip/$(PLATFORM) && npm ci && npm run build:deploy
	sudo systemctl restart efip
	@sleep 2 && curl -fsS http://127.0.0.1:4000/api/health && echo " ✓ up"
