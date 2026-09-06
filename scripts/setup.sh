#!/usr/bin/env bash
# Afaq Harness Gateway — Setup Script (idempotent)
# Usage: bash scripts/setup.sh  OR  make setup
set -e

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
