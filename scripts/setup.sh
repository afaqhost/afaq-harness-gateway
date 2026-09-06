#!/usr/bin/env bash
# Afaq Harness Gateway — Setup Script (idempotent)
# Usage: bash scripts/setup.sh [OPTIONS]  OR  make setup
# Options:
#   --run           Start server after setup (make dev)
#   --restart       Kill existing server on $PORT and restart
#   --port 3500     Override port (default from .env or 3500)
#   --no-prompt     Don't ask interactive prompt at end
#   -h, --help      Show help
set -e

# Parse args
RUN_SERVER=false
RESTART_SERVER=false
NO_PROMPT=false
PORT_OVERRIDE=""
for arg in "$@"; do
  case "$arg" in
    --run) RUN_SERVER=true ;;
    --restart) RESTART_SERVER=true; RUN_SERVER=true ;;
    --no-prompt) NO_PROMPT=true ;;
    --port) echo "Usage: --port 3500 (use --port=3500)"; exit 1 ;;
    --port=*) PORT_OVERRIDE="${arg#*=}" ;;
    -h|--help)
      echo "Usage: bash scripts/setup.sh [OPTIONS]"
      echo "  --run           Start server after setup"
      echo "  --restart       Kill existing server and restart"
      echo "  --port=3500     Port to use (default 3500)"
      echo "  --no-prompt     Don't ask interactive prompt"
      exit 0
      ;;
  esac
done
# handle --port <value> form
for i in "${!@}"; do if [ "${!i}" = "--port" ]; then j=$((i+1)); PORT_OVERRIDE="${!j}"; fi; done

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo -e "${CYAN}━━━ Afaq Harness Gateway — Setup ━━━${NC}"

# ---------- 1. Check prerequisites ----------
echo -e "\n${YELLOW}[1/5] Checking prerequisites...${NC}"

if ! command -v python3 &>/dev/null; then
  echo -e "${RED}✗ python3 not found. Please install Python 3.12+${NC}"
  exit 1
fi

PY_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PY_MAJOR=$(echo "$PY_VERSION" | cut -d. -f1)
PY_MINOR=$(echo "$PY_VERSION" | cut -d. -f2)
echo "  Python $PY_VERSION found"

if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 10 ]; }; then
  echo -e "${YELLOW}  ⚠ Python $PY_VERSION is old. Recommended: 3.12+${NC}"
fi

if command -v node &>/dev/null; then
  echo "  Node $(node --version) found"
else
  echo -e "${YELLOW}  ⚠ Node not found — needed only for harness CLIs (opencode, codex, etc.)${NC}"
fi

if command -v npm &>/dev/null; then
  echo "  npm $(npm --version) found"
fi

# ---------- 2. Virtual environment ----------
echo -e "\n${YELLOW}[2/5] Setting up virtual environment...${NC}"

if [ ! -d ".venv" ]; then
  echo "  Creating .venv ..."
  python3 -m venv .venv
  echo -e "${GREEN}  ✓ Created .venv${NC}"
else
  echo -e "${GREEN}  ✓ .venv already exists${NC}"
fi

# Upgrade pip quietly
echo "  Upgrading pip..."
.venv/bin/python -m pip install --upgrade pip -q 2>&1 | grep -v "already satisfied" || true

# ---------- 3. Install dependencies ----------
echo -e "\n${YELLOW}[3/5] Installing dependencies...${NC}"

if [ -f "requirements.txt" ]; then
  .venv/bin/pip install -r requirements.txt -q
  echo -e "${GREEN}  ✓ Dependencies installed${NC}"
else
  echo -e "${RED}  ✗ requirements.txt not found${NC}"
  exit 1
fi

# ---------- 4. Environment file ----------
echo -e "\n${YELLOW}[4/5] Configuring .env ...${NC}"

generate_secret() {
  python3 -c "import secrets; print(secrets.token_urlsafe(48))"
}

if [ ! -f ".env" ]; then
  echo "  Creating .env from .env.example ..."
  cp .env.example .env
  echo -e "${GREEN}  ✓ Created .env${NC}"
else
  echo -e "${GREEN}  ✓ .env already exists (will patch weak secrets if needed)${NC}"
fi

# Check and patch weak secrets
NEEDS_PATCH=false
if grep -q "replace-with-a-long-random-secret" .env 2>/dev/null; then
  NEEDS_PATCH=true
fi
if grep -q "replace-with-a-long-random-encryption-secret" .env 2>/dev/null; then
  NEEDS_PATCH=true
fi
if grep -q "change-me-in-production" .env 2>/dev/null; then
  NEEDS_PATCH=true
fi

if [ "$NEEDS_PATCH" = true ]; then
  echo "  Generating strong secrets..."
  SECRET=$(generate_secret)
  CRED=$(generate_secret)

  # Use python for safe replacement (handles special chars)
  python3 <<PYEOF
import pathlib, secrets

p = pathlib.Path(".env")
text = p.read_text()

# Generate two fresh secrets
import subprocess, sys
# Already have SECRET/CRED from bash via env, but regenerate in python for safety
secret = "$SECRET"
cred = "$CRED"

# Replace placeholders (cover both variants)
replacements = {
    "replace-with-a-long-random-secret-generate-with-secrets-token_urlsafe": secret,
    "replace-with-a-long-random-encryption-secret-generate-with-secrets-token_urlsafe": cred,
    "replace-with-a-long-random-secret": secret,
    "replace-with-a-long-random-encryption-secret": cred,
    "change-me-in-production-32-byte-key": secret,
    "change-me-in-production": secret,
}

for old, new in replacements.items():
    if old in text:
        text = text.replace(old, new)

p.write_text(text)
print("  Patched .env with strong secrets")
PYEOF
  # Double-check that both keys are now set to non-placeholder
  # If one of them still placeholder (e.g. only SECRET was patched), patch again
  if grep -q "replace-with" .env; then
    # fallback: brute-force line replacement
    S2=$(generate_secret)
    C2=$(generate_secret)
    sed -i "s|^SECRET_KEY=.*|SECRET_KEY=$S2|" .env || true
    sed -i "s|^CREDENTIALS_KEY=.*|CREDENTIALS_KEY=$C2|" .env || true
  fi
  echo -e "${GREEN}  ✓ Secrets generated and saved to .env${NC}"
else
  # Verify secrets are not empty
  if grep -q "^SECRET_KEY=$" .env || grep -q "^SECRET_KEY=\"\"$" .env || grep -q "^CREDENTIALS_KEY=$" .env; then
    echo -e "${YELLOW}  ⚠ SECRET_KEY or CREDENTIALS_KEY is empty — generating...${NC}"
    S2=$(generate_secret)
    C2=$(generate_secret)
    # python safe patch
    python3 <<PYEOF2
import pathlib
p = pathlib.Path(".env")
t = p.read_text()
import os
s = os.environ.get("S2", "$S2")
c = os.environ.get("C2", "$C2")
# simple line replace if empty
lines=[]
for line in t.splitlines():
    if line.startswith("SECRET_KEY=") and line.strip() in ("SECRET_KEY=", 'SECRET_KEY=""', "SECRET_KEY=''"):
        lines.append(f"SECRET_KEY={s}")
    elif line.startswith("CREDENTIALS_KEY=") and line.strip() in ("CREDENTIALS_KEY=", 'CREDENTIALS_KEY=""', "CREDENTIALS_KEY=''"):
        lines.append(f"CREDENTIALS_KEY={c}")
    else:
        lines.append(line)
p.write_text("\n".join(lines)+"\n")
PYEOF2
  else
    echo -e "${GREEN}  ✓ Secrets already configured${NC}"
  fi
fi

# Show masked preview
echo "  .env preview:"
grep -E "^(APP_NAME|PORT|DEBUG|SECRET_KEY|CREDENTIALS_KEY|DATABASE_URL)=" .env | sed -E 's/(SECRET_KEY|CREDENTIALS_KEY)=.*/\1=••••••••••••••••••••••••••••••••••••/' | sed 's/^/    /'

# ---------- 5. Data directories ----------
echo -e "\n${YELLOW}[5/5] Preparing data directories...${NC}"

mkdir -p data storage/harnesses storage/uploads
echo -e "${GREEN}  ✓ data/ storage/harnesses/ storage/uploads/${NC}"

# Init DB quickly (optional, best-effort)
echo "  Initializing database (best-effort)..."
.venv/bin/python -c "
try:
    import asyncio
    from app.db.database import init_db
    asyncio.run(init_db())
    print('  ✓ Database ready')
except Exception as e:
    print(f'  ⚠ DB init skipped: {e}')
" 2>&1 | sed 's/^/    /' || true

# ---------- Done ----------
echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ Setup complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "Next steps:"
echo -e "  ${CYAN}make dev${NC}  or  ${CYAN}.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 3500 --reload${NC}"
echo -e "  Open ${CYAN}http://127.0.0.1:3500/setup${NC}  (first run) or ${CYAN}http://127.0.0.1:3500/login${NC}"
echo ""
echo -e "Docker:"
echo -e "  ${CYAN}make docker${NC}  (requires .env with strong secrets)"
echo ""
echo -e "Create first admin via CLI:"
echo -e "  ${CYAN}make bootstrap EMAIL=admin@example.com PASS=StrongPass123${NC}"
echo ""
echo -e "Health check:"
echo -e "  ${CYAN}make health${NC}   or   ${CYAN}curl http://127.0.0.1:3500/health${NC}"
echo ""

# ---------- Optional: Run / Restart server ----------
# Determine port
PORT_TO_USE="${PORT_OVERRIDE:-}"
if [ -z "$PORT_TO_USE" ]; then
  # try from .env, fallback 3500
  PORT_TO_USE=$(grep -E "^PORT=" .env 2>/dev/null | cut -d= -f2 | tr -d ' "' || echo "3500")
  [ -z "$PORT_TO_USE" ] && PORT_TO_USE="3500"
fi

is_port_in_use() {
  local p="$1"
  if command -v lsof &>/dev/null; then lsof -i :"$p" -sTCP:LISTEN -t &>/dev/null && return 0 || return 1
  elif command -v ss &>/dev/null; then ss -ltn "sport = :$p" 2>/dev/null | grep -q ":$p" && return 0 || return 1
  else return 1; fi
}

kill_port() {
  local p="$1"
  echo -e "${YELLOW}Stopping existing server on port $p...${NC}"
  if command -v lsof &>/dev/null; then
    local pids=$(lsof -i :"$p" -sTCP:LISTEN -t 2>/dev/null || true)
    if [ -n "$pids" ]; then echo "$pids" | xargs -r kill 2>/dev/null || true; sleep 1; echo "$pids" | xargs -r kill -9 2>/dev/null || true; echo -e "${GREEN}  ✓ Stopped${NC}"; else echo "  (none)"; fi
  elif command -v fuser &>/dev/null; then fuser -k "${p}/tcp" 2>/dev/null || true; sleep 1; echo -e "${GREEN}  ✓ Stopped${NC}"
  else
    pkill -f "uvicorn.*$p" 2>/dev/null || true; sleep 1; echo -e "${GREEN}  ✓ Stopped (pkill)${NC}"
  fi
}

start_server() {
  local p="$1"
  echo -e "${CYAN}Starting server on http://127.0.0.1:$p ...${NC}"
  # prefer make dev if available
  if [ -f "Makefile" ]; then
    # run in background with nohup if --restart, otherwise foreground
    if [ "$RESTART_SERVER" = true ]; then
      nohup .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port "$p" --reload > /tmp/afaq-gateway.log 2>&1 &
      echo -e "${GREEN}  ✓ Server started (PID $!) — log: /tmp/afaq-gateway.log${NC}"
      echo -e "  ${CYAN}curl http://127.0.0.1:$p/health${NC}  or  ${CYAN}http://127.0.0.1:$p/setup${NC}"
    else
      echo -e "${YELLOW}Running foreground (Ctrl+C to stop) — or use --restart for background${NC}"
      .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port "$p" --reload
    fi
  else
    .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port "$p" --reload
  fi
}

if [ "$RESTART_SERVER" = true ]; then
  kill_port "$PORT_TO_USE"
  start_server "$PORT_TO_USE"
  exit 0
fi

if [ "$RUN_SERVER" = true ]; then
  if is_port_in_use "$PORT_TO_USE"; then
    echo -e "${YELLOW}Port $PORT_TO_USE is already in use. Use --restart to restart.${NC}"
    exit 0
  fi
  start_server "$PORT_TO_USE"
  exit 0
fi

# Interactive prompt if TTY and not --no-prompt
if [ "$NO_PROMPT" = false ] && [ -t 0 ]; then
  echo ""
  echo -e "${CYAN}Quick start?${NC}"
  echo -e "  [1] Run server (foreground, --run)"
  echo -e "  [2] Restart server (background, --restart) — kills old on $PORT_TO_USE"
  echo -e "  [N] Do nothing (default)"
  read -r -p "Choice [1/2/N]: " choice
  case "$choice" in
    1) RUN_SERVER=true; start_server "$PORT_TO_USE" ;;
    2) RESTART_SERVER=true; kill_port "$PORT_TO_USE"; start_server "$PORT_TO_USE" ;;
    *) echo -e "${GREEN}Done. Run manually: make dev or bash scripts/setup.sh --run${NC}" ;;
  esac
fi
