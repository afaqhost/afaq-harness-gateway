#!/usr/bin/env bash
# Afaq Harness Gateway — Install Wizard (idempotent, environment-agnostic)
#
# Usage:
#   bash scripts/install.sh                 # interactive wizard
#   bash scripts/install.sh --path=native   # non-interactive, native path
#   bash scripts/install.sh --path=docker   # non-interactive, docker path
#   bash scripts/install.sh --no-system     # skip OS-package installs (CI mode)
#   bash scripts/install.sh --dry-run       # print actions without executing
#   bash scripts/install.sh --no-redis      # don't install or start redis
#   bash scripts/install.sh --no-node       # don't install node/npm
#   bash scripts/install.sh --harness <name>... # also install given harness CLIs
#                                              # (agy, opencode, codex, ...)
#   bash scripts/install.sh --port 3500     # override port
#
# Exit codes:
#   0  success
#   1  user cancelled
#   2  missing tool the user declined to install
#   3  pip wheel build failed even after installing build deps
#   4  docker path: docker daemon unreachable
#
# After this script exits 0 the gateway is ready to start. Use `make dev` or
# `make run` (or `docker compose up` on the docker path).
set -e
set -u
set -o pipefail

# ---------- Args ----------
WIZARD_PATH=""
NO_PROMPT=false
NO_SYSTEM=false
DRY_RUN=false
NO_REDIS=false
NO_NODE=false
HARNESSES=()
PORT_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --path=*)      WIZARD_PATH="${1#*=}"; shift ;;
    --path)        WIZARD_PATH="${2:-}"; shift 2 ;;
    --no-prompt)   NO_PROMPT=true; shift ;;
    --no-system)   NO_SYSTEM=true; shift ;;
    --dry-run)     DRY_RUN=true; shift ;;
    --no-redis)    NO_REDIS=true; shift ;;
    --no-node)     NO_NODE=true; shift ;;
    --harness)     shift; while [[ $# -gt 0 && "$1" != --* ]]; do HARNESSES+=("$1"); shift; done ;;
    --harness=*)   HARNESSES+=("${1#*=}"); shift ;;
    --port=*)      PORT_OVERRIDE="${1#*=}"; shift ;;
    --port)        PORT_OVERRIDE="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# ---------- Colors ----------
if [ -t 1 ]; then
  GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; DIM='\033[2m'; NC='\033[0m'
else
  GREEN=''; CYAN=''; YELLOW=''; RED=''; DIM=''; NC=''
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

log()   { echo -e "${CYAN}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*" >&2; }
dim()   { echo -e "${DIM}  $*${NC}"; }

run() {
  if [ "$DRY_RUN" = true ]; then
    echo -e "${DIM}  [dry-run] $*${NC}"
  else
    "$@"
  fi
}

# ---------- OS detection ----------
detect_os() {
  OS_FAMILY="unknown"
  PKG_MANAGER="none"
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    case "${ID:-}" in
      ubuntu|debian|pop|linuxmint|elementary|kali|raspbian)
        OS_FAMILY="debian"; PKG_MANAGER="apt" ;;
      fedora|rhel|centos|rocky|almalinux|ol|amzn)
        OS_FAMILY="rhel"; PKG_MANAGER="dnf" ;;
      opensuse*|sles)
        OS_FAMILY="suse"; PKG_MANAGER="zypper" ;;
      arch|manjaro|endeavouros)
        OS_FAMILY="arch"; PKG_MANAGER="pacman" ;;
      alpine)
        OS_FAMILY="alpine"; PKG_MANAGER="apk" ;;
    esac
  fi
  if [ "$OS_FAMILY" = "unknown" ]; then
    case "$(uname -s 2>/dev/null || echo unknown)" in
      Darwin) OS_FAMILY="macos"; PKG_MANAGER="brew" ;;
      MINGW*|MSYS*|CYGWIN*) OS_FAMILY="windows" ;;
      *) ;;
    esac
  fi
}

detect_os

# ---------- Sudo ----------
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi
fi

# ---------- Step 1: detect ----------
echo -e "${CYAN}━━━ Afaq Harness Gateway — Install Wizard ━━━${NC}"
echo
log "Detected host: ${OS_FAMILY} (package manager: ${PKG_MANAGER})"
echo

HAVE_PYTHON3=false
HAVE_PIP=false
HAVE_VENV=false
HAVE_NODE=false
HAVE_NPM=false
HAVE_DOCKER=false
HAVE_REDIS=false
HAVE_GIT=false
HAVE_CURL=false
HAVE_BUILD_TOOLS=false
PY_VERSION=""

probe_python() {
  if command -v python3 >/dev/null 2>&1; then
    HAVE_PYTHON3=true
    PY_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "?")
  fi
  if python3 -m pip --version >/dev/null 2>&1; then HAVE_PIP=true; fi
  if python3 -m venv --help >/dev/null 2>&1; then HAVE_VENV=true; fi
}
probe_python
command -v node     >/dev/null 2>&1 && HAVE_NODE=true
command -v npm      >/dev/null 2>&1 && HAVE_NPM=true
command -v docker   >/dev/null 2>&1 && HAVE_DOCKER=true
command -v redis-server >/dev/null 2>&1 && HAVE_REDIS=true
command -v git      >/dev/null 2>&1 && HAVE_GIT=true
command -v curl     >/dev/null 2>&1 && HAVE_CURL=true
case "$OS_FAMILY" in
  debian)  command -v gcc >/dev/null 2>&1 && HAVE_BUILD_TOOLS=true ;;
  rhel)    command -v gcc >/dev/null 2>&1 && HAVE_BUILD_TOOLS=true ;;
  alpine)  command -v gcc >/dev/null 2>&1 && HAVE_BUILD_TOOLS=true ;;
  macos)   command -v clang >/dev/null 2>&1 && HAVE_BUILD_TOOLS=true ;;
esac

print_status() {
  local name="$1" have="$2" detail="$3"
  if [ "$have" = true ]; then
    echo -e "  ${GREEN}✓${NC} ${name} ${DIM}${detail}${NC}"
  else
    echo -e "  ${RED}✗${NC} ${name} ${DIM}${detail}${NC}"
  fi
}

echo "Detected tools:"
print_status "python3"  "$HAVE_PYTHON3"  "$PY_VERSION"
print_status "pip"      "$HAVE_PIP"      ""
print_status "venv"     "$HAVE_VENV"     ""
print_status "node"     "$HAVE_NODE"     "$( [ "$HAVE_NODE" = true ] && node --version )"
print_status "npm"      "$HAVE_NPM"      ""
print_status "docker"   "$HAVE_DOCKER"   "$( [ "$HAVE_DOCKER" = true ] && docker --version )"
print_status "redis-server" "$HAVE_REDIS" "$([ "$NO_REDIS" = true ] && echo '(skipped by flag)' || true)"
print_status "git"      "$HAVE_GIT"      ""
print_status "curl"     "$HAVE_CURL"     ""
print_status "build tools (gcc/make)" "$HAVE_BUILD_TOOLS" "needed only if pip can't fetch a wheel"
echo

# ---------- Step 2: pick path ----------
choose_path() {
  if [ -n "$WIZARD_PATH" ]; then
    case "$WIZARD_PATH" in
      native|docker) return ;;
      *) err "Invalid --path: $WIZARD_PATH (expected: native or docker)"; exit 1 ;;
    esac
  fi
  if [ "$NO_PROMPT" = true ]; then
    err "--no-prompt requires --path=native or --path=docker"
    exit 1
  fi
  if [ ! -t 0 ]; then
    err "No TTY and no --path given. Re-run with --path=native or --path=docker."
    exit 1
  fi
  echo -e "${CYAN}Choose install path:${NC}"
  echo -e "  ${GREEN}[1]${NC} Native    ${DIM}— install missing tools on this host, run gateway directly${NC}"
  echo -e "  ${GREEN}[2]${NC} Docker    ${DIM}— install docker if needed, run gateway in a container${NC}"
  echo -e "  ${GREEN}[N]${NC} Cancel"
  local choice=""
  read -r -p "Choice [1/2/N, default 1]: " choice
  case "$choice" in
    ""|1) WIZARD_PATH="native" ;;
    2)    WIZARD_PATH="docker" ;;
    *)    echo "Cancelled."; exit 1 ;;
  esac
}

choose_path
log "Selected path: ${GREEN}${WIZARD_PATH}${NC}"
echo

# ---------- Step 3: install system packages ----------
install_native_pkgs() {
  local pkgs=("$@")
  [ "${#pkgs[@]}" -eq 0 ] && return 0
  if [ "$NO_SYSTEM" = true ]; then
    warn "--no-system set; skipping OS install for: ${pkgs[*]}"
    return 0
  fi
  case "$PKG_MANAGER" in
    apt)
      log "apt-get install ${pkgs[*]}"
      run $SUDO apt-get update -y
      run $SUDO apt-get install -y --no-install-recommends "${pkgs[@]}" ;;
    dnf)
      log "dnf install ${pkgs[*]}"
      run $SUDO dnf install -y "${pkgs[@]}" ;;
    zypper)
      log "zypper install ${pkgs[*]}"
      run $SUDO zypper --non-interactive install "${pkgs[@]}" ;;
    pacman)
      log "pacman -S ${pkgs[*]}"
      run $SUDO pacman -Sy --noconfirm "${pkgs[@]}" ;;
    apk)
      log "apk add ${pkgs[*]}"
      run $SUDO apk add --no-cache "${pkgs[@]}" ;;
    brew)
      log "brew install ${pkgs[*]}"
      run brew install "${pkgs[@]}" ;;
    none)
      err "No supported package manager on $OS_FAMILY. Install manually: ${pkgs[*]}"
      exit 2 ;;
  esac
}

install_node() {
  if [ "$HAVE_NODE" = true ] && [ "$HAVE_NPM" = true ]; then return 0; fi
  if [ "$NO_NODE" = true ]; then warn "Skipping node (--no-node)"; return 0; fi
  if [ "$NO_SYSTEM" = true ]; then warn "--no-system set; skipping node install"; return 0; fi
  case "$OS_FAMILY" in
    debian)
      # NodeSource setup_22.x — installs nodejs + npm + npx
      if [ ! -f /etc/apt/sources.list.d/nodesource.list ] && [ ! -f /etc/apt/keyrings/nodesource.gpg ]; then
        log "Installing Node.js 22.x via NodeSource"
        if [ "$DRY_RUN" = true ]; then
          dim "[dry-run] curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"
        else
          run $SUDO apt-get update -y
          run $SUDO apt-get install -y --no-install-recommends ca-certificates curl gnupg
          run curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO bash -
        fi
      fi
      install_native_pkgs nodejs ;;
    rhel)
      if ! command -v dnf >/dev/null 2>&1; then return 0; fi
      log "Installing Node.js via dnf module"
      run $SUDO dnf module -y install nodejs:22/common || run $SUDO dnf install -y nodejs npm ;;
    alpine)
      install_native_pkgs nodejs npm ;;
    macos)
      if command -v brew >/dev/null 2>&1; then
        run brew install node
      else
        err "Homebrew not found. Install Node.js manually from https://nodejs.org/"
        return 0
      fi ;;
    *)
      err "No node install recipe for OS_FAMILY=$OS_FAMILY. Install manually: https://nodejs.org/" ;;
  esac
  HAVE_NODE=true; HAVE_NPM=true
}

install_docker_linux() {
  if [ "$HAVE_DOCKER" = true ]; then return 0; fi
  if [ "$NO_SYSTEM" = true ]; then warn "--no-system set; skipping docker install"; return 0; fi
  case "$OS_FAMILY" in
    debian|rhel|alpine|suse|arch)
      log "Installing Docker via get.docker.com (official convenience script)"
      if [ "$DRY_RUN" = true ]; then
        dim "[dry-run] curl -fsSL https://get.docker.com | sh"
      else
        run curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
        run $SUDO sh /tmp/get-docker.sh
      fi
      ;;
    *)
      err "Install Docker Desktop manually for $OS_FAMILY: https://www.docker.com/products/docker-desktop/" ;;
  esac
  HAVE_DOCKER=true
}

install_redis_native() {
  if [ "$HAVE_REDIS" = true ] || [ "$NO_REDIS" = true ]; then return 0; fi
  case "$OS_FAMILY" in
    debian) install_native_pkgs redis-server ;;
    rhel)   install_native_pkgs redis ;;
    alpine) install_native_pkgs redis ;;
    macos)
      if command -v brew >/dev/null 2>&1; then run brew install redis; else warn "No brew; skipping redis"; fi ;;
    *) warn "No redis install recipe for $OS_FAMILY" ;;
  esac
  command -v redis-server >/dev/null 2>&1 && HAVE_REDIS=true
}

install_native_basics() {
  case "$OS_FAMILY" in
    debian)
      install_native_pkgs python3 python3-pip python3-venv ca-certificates curl git
      ;;
    rhel)
      install_native_pkgs python3 python3-pip python3-devel gcc make libffi-devel openssl-devel ca-certificates curl git
      ;;
    alpine)
      install_native_pkgs python3 py3-pip python3-dev ca-certificates curl git build-base libffi-dev openssl-dev musl-dev
      ;;
    arch)
      install_native_pkgs python python-pip ca-certificates curl git base-devel
      ;;
    macos)
      if ! command -v brew >/dev/null 2>&1; then
        err "Homebrew not found. Install from https://brew.sh/ — required for native install on macOS."
        exit 2
      fi
      run brew install python@3.12 curl git
      ;;
    *)
      err "Unsupported OS for native install: $OS_FAMILY"
      exit 2 ;;
  esac
  # Re-probe after install
  probe_python
  command -v git  >/dev/null 2>&1 && HAVE_GIT=true
  command -v curl >/dev/null 2>&1 && HAVE_CURL=true
}

install_greenlet_build_deps() {
  # Only needed if pip cannot fetch a prebuilt wheel. We try pip first and
  # fall back to installing the toolchain only on failure.
  case "$OS_FAMILY" in
    debian) install_native_pkgs python3-dev libffi-dev libssl-dev build-essential pkg-config ;;
    rhel)   install_native_pkgs python3-devel libffi-devel openssl-devel gcc make gcc-c++ ;;
    alpine) install_native_pkgs python3-dev libffi-dev openssl-dev build-base musl-dev ;;
    arch)   install_native_pkgs base-devel ;;
    macos)  warn "greenlet on macOS needs Xcode CLT — install via 'xcode-select --install'" ;;
  esac
  HAVE_BUILD_TOOLS=true
}

# ---------- Step 4: dispatch ----------
case "$WIZARD_PATH" in
  native)
    log "Native install path"
    [ "$HAVE_PYTHON3" = false ] || [ "$HAVE_PIP" = false ] || [ "$HAVE_VENV" = false ] || [ "$HAVE_CURL" = false ] || [ "$HAVE_GIT" = false ] && {
      install_native_basics
    }
    if [ "$HAVE_NODE" = false ]; then install_node; fi
    if [ "$HAVE_REDIS" = false ] && [ "$NO_REDIS" = false ]; then install_redis_native; fi

    # Ensure build deps are present in case pip falls back to sdist wheels.
    # We try to install the requirements first; if any wheel fails to build, we
    # install the toolchain and retry once.
    ;;
  docker)
    log "Docker install path"
    install_docker_linux
    if [ "$HAVE_DOCKER" = false ]; then
      err "Docker installation did not complete; cannot continue on docker path."
      exit 2
    fi
    if [ "$HAVE_REDIS" = false ] && [ "$NO_REDIS" = false ]; then
      warn "Redis not installed on host — the gateway's docker-compose stack ships its own redis:7 service, so this is fine."
    fi
    ;;
esac

# ---------- Step 5: venv + pip (native only) ----------
if [ "$WIZARD_PATH" = "native" ]; then
  if [ ! -d ".venv" ]; then
    log "Creating .venv"
    run python3 -m venv .venv
  else
    dim ".venv already exists — reusing"
  fi
  log "Upgrading pip"
  run .venv/bin/python -m pip install --upgrade pip -q

  log "Installing Python requirements (one retry with build deps on wheel failure)"
  set +e
  if [ "$DRY_RUN" = true ]; then
    dim "[dry-run] .venv/bin/pip install -r requirements.txt"
    PIP_RC=0
  else
    .venv/bin/pip install -r requirements.txt -q
    PIP_RC=$?
  fi
  set -e
  if [ "$PIP_RC" -ne 0 ]; then
    warn "pip wheel build failed — installing build toolchain and retrying once"
    install_greenlet_build_deps
    set +e
    if [ "$DRY_RUN" = true ]; then
      dim "[dry-run] .venv/bin/pip install -r requirements.txt (retry)"
    else
      .venv/bin/pip install -r requirements.txt -q
      PIP_RC=$?
    fi
    set -e
    if [ "$PIP_RC" -ne 0 ]; then
      err "pip install failed even with build toolchain. Check the output above."
      exit 3
    fi
  fi

  # Validate imports
  log "Verifying required Python imports"
  run .venv/bin/python -c "import fastapi, sqlalchemy, aiosqlite, cryptography, redis, prometheus_client; print('  ok')"
fi

# ---------- Step 6: .env ----------
log "Configuring .env"
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    run cp .env.example .env
  else
    err ".env.example missing — cannot seed .env"
    exit 2
  fi
fi

# Patch weak secrets if present (same logic as scripts/setup.sh)
generate_secret() { python3 -c "import secrets; print(secrets.token_urlsafe(48))"; }

if grep -qE "replace-with-a-long-random-secret|change-me-in-production" .env 2>/dev/null; then
  log "Generating strong secrets"
  SECRET=$(generate_secret)
  CRED=$(generate_secret)
  if [ "$DRY_RUN" = false ]; then
    SECRET_VAL="$SECRET" CRED_VAL="$CRED" python3 <<'PYEOF'
import os, pathlib
p = pathlib.Path(".env")
text = p.read_text()
secret = os.environ["SECRET_VAL"]
cred = os.environ["CRED_VAL"]
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
PYEOF
  fi
fi

# ---------- Step 7: data dirs + DB ----------
log "Preparing data dirs"
run mkdir -p data storage/harnesses storage/uploads

if [ "$WIZARD_PATH" = "native" ]; then
  log "Initializing database (best-effort)"
  run .venv/bin/python -c "import asyncio; from app.db.database import init_db; asyncio.run(init_db()); print('  db ok')" || true
fi

# ---------- Step 8: optional harness CLIs ----------
install_harness_cli() {
  local name="$1"
  case "$name" in
    agy)
      log "Installing agy (Antigravity CLI) via official script"
      if [ "$DRY_RUN" = true ]; then
        dim "[dry-run] curl -fsSL https://antigravity.google/cli/install.sh | bash"
      else
        run curl -fsSL https://antigravity.google/cli/install.sh | bash
      fi
      ;;
    opencode|claude|codex|pi)
      log "Installing $name via npm"
      if ! command -v npm >/dev/null 2>&1; then
        err "npm not found; cannot install $name. Re-run with --no-node or install node first."
        return 1
      fi
      case "$name" in
        opencode) run npm install -g opencode-ai ;;
        claude)   run npm install -g @anthropic-ai/claude-code ;;
        codex)    run npm install -g @openai/codex ;;
        pi)       run npm install -g @mariozechner/pi-coding-agent ;;
      esac
      ;;
    *)
      warn "Unknown harness '$name' — supported: agy, opencode, claude, codex, pi" ;;
  esac
}

if [ "${#HARNESSES[@]}" -gt 0 ]; then
  for h in "${HARNESSES[@]}"; do install_harness_cli "$h" || true; done
fi

# ---------- Step 9: launch on docker path ----------
if [ "$WIZARD_PATH" = "docker" ]; then
  log "Starting docker compose stack"
  if [ "$DRY_RUN" = true ]; then
    dim "[dry-run] docker compose up -d --build"
  else
    if ! docker info >/dev/null 2>&1; then
      err "docker daemon is not reachable. Start Docker Desktop, or re-run after 'sudo systemctl start docker'."
      exit 4
    fi
    run docker compose up -d --build
    log "Waiting for gateway health endpoint…"
    PORT_TO_USE="${PORT_OVERRIDE:-3500}"
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
      sleep 2
      if curl -fsS "http://127.0.0.1:${PORT_TO_USE}/health" >/dev/null 2>&1; then
        ok "Gateway is healthy on port ${PORT_TO_USE}"
        break
      fi
      [ "$i" = "15" ] && warn "Health check did not respond after 30s — check 'docker compose logs'"
    done
  fi
fi

# ---------- Done ----------
echo
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ Install wizard complete (path: ${WIZARD_PATH})${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
case "$WIZARD_PATH" in
  native)
    cat <<EOF
Next steps:
  ${CYAN}make run PORT=3500${NC}        # foreground
  ${CYAN}make restart PORT=3500${NC}    # background, kills old on PORT
  ${CYAN}make bootstrap EMAIL=… PASS=…${NC}   # create first admin

Open ${CYAN}http://127.0.0.1:3500/setup${NC} (first run) or ${CYAN}/login${NC}.

Health:
  ${CYAN}make health${NC}  or  ${CYAN}curl http://127.0.0.1:3500/health${NC}
EOF
    ;;
  docker)
    cat <<EOF
Next steps:
  ${CYAN}docker compose logs -f${NC}     # tail logs
  ${CYAN}docker compose down${NC}       # stop stack
  ${CYAN}docker compose up --build${NC} # rebuild and start

Open ${CYAN}http://127.0.0.1:3500/setup${NC} (first run) or ${CYAN}/login${NC}.
EOF
    ;;
esac
