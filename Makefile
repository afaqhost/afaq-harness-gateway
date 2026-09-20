.PHONY: setup install dev start run restart test check lint docker docker-down clean bootstrap health setup-status install-agy update-agy help

PY := .venv/bin/python
PIP := .venv/bin/pip
UVICORN := .venv/bin/python -m uvicorn
PORT ?= 3500
HOST ?= localhost

# Detect python for setup
PYTHON ?= python3

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-16s\033[0m %s\n", $$1, $$2}'

setup: ## One-command setup: venv + deps + .env + data dirs (add --run/--restart)
	@bash scripts/setup.sh $(ARGS)

install: ## Install dependencies into .venv (requires .venv exists)
	$(PIP) install -r requirements.txt

dev: ## Run dev server with auto-reload (foreground)
	$(UVICORN) app.main:app --host $(HOST) --port $(PORT) --reload

start: ## Run production server (no reload)
	$(UVICORN) app.main:app --host $(HOST) --port $(PORT)

run: ## Setup + run server (foreground) — same as: bash scripts/setup.sh --run
	@bash scripts/setup.sh --run --port=$(PORT)

restart: ## Restart server (background, kills old on PORT) — same as: bash scripts/setup.sh --restart
	@bash scripts/setup.sh --restart --port=$(PORT)

stop: ## Stop server on PORT
	@PORT=$(PORT) bash -c 'if command -v lsof &>/dev/null; then pids=$$(lsof -i :$$PORT -sTCP:LISTEN -t 2>/dev/null || true); [ -n "$$pids" ] && echo "$$pids" | xargs -r kill 2>/dev/null; sleep 1; echo "$$pids" | xargs -r kill -9 2>/dev/null || true; echo "stopped"; else pkill -f "uvicorn.*$$PORT" 2>/dev/null || true; echo "stopped"; fi'

test: ## Run compile + JS check + pytest (204 tests)
	$(PY) -m compileall -q app
	@node --check app/static/app.js && echo "JS syntax OK"
	$(PY) -m pytest -q

check: ## Alias for test
	@$(MAKE) test

lint: ## Basic lint placeholder (compileall + JS)
	$(PY) -m compileall -q app
	@node --check app/static/app.js

docker: ## Build and run via docker-compose
	docker compose up --build

docker-down: ## Stop docker-compose
	docker compose down

clean: ## Remove caches and temp files
	rm -rf __pycache__ .pytest_cache .ruff_cache htmlcov
	rm -rf app/__pycache__ app/**/__pycache__
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true

bootstrap: ## Create first admin: make bootstrap EMAIL=admin@example.com PASS=secret NAME=Admin
	@if [ -z "$(EMAIL)" ] || [ -z "$(PASS)" ]; then echo "Usage: make bootstrap EMAIL=admin@example.com PASS=StrongPass123 NAME=Admin [URL=http://127.0.0.1:3500]"; exit 1; fi
	@URL=$${URL:-http://127.0.0.1:$(PORT)}; \
	echo "Bootstrapping $$URL/api/auth/bootstrap ..."; \
	curl -s -X POST $$URL/api/auth/bootstrap \
	  -H "Content-Type: application/json" \
	  -d "{\"email\":\"$(EMAIL)\",\"password\":\"$(PASS)\",\"display_name\":\"$${NAME:-Admin}\"}" | python3 -m json.tool || true

health: ## Check gateway health: make health [URL=http://127.0.0.1:3500]
	@URL=$${URL:-http://127.0.0.1:$(PORT)}; curl -fsS $$URL/health | python3 -m json.tool; echo ""

install-agy: ## Install Google Antigravity CLI (official installer → ~/.local/bin/agy)
	curl -fsSL https://antigravity.google/cli/install.sh | bash
	@echo "agy installed to $$HOME/.local/bin — run 'agy' once to sign in, then 'make restart'"

update-agy: ## Update Google Antigravity CLI in place
	agy update

setup-status: ## Check if bootstrap needed (first-run detection)
	@URL=$${URL:-http://127.0.0.1:$(PORT)}; curl -fsS $$URL/api/auth/setup-status | python3 -m json.tool; echo ""
