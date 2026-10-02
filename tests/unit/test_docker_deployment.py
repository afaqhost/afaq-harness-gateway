"""Static configuration and regression tests for Docker and Docker Compose deployment.

These tests verify container networking, unprivileged user security,
Redis isolation, volume mount targets, loopback published ports, CI step ordering,
and application configuration statically without requiring a running Docker daemon.
"""

from pathlib import Path
import pytest
import yaml

from app.core.config import Settings

ROOT_DIR = Path(__file__).resolve().parents[2]
DOCKERFILE_PATH = ROOT_DIR / "Dockerfile"
COMPOSE_PATH = ROOT_DIR / "docker-compose.yml"
CI_WORKFLOW_PATH = ROOT_DIR / ".github" / "workflows" / "ci.yml"


@pytest.fixture
def dockerfile_content() -> str:
    assert DOCKERFILE_PATH.is_file(), f"Dockerfile not found at {DOCKERFILE_PATH}"
    return DOCKERFILE_PATH.read_text(encoding="utf-8")


@pytest.fixture
def compose_config() -> dict:
    assert COMPOSE_PATH.is_file(), f"docker-compose.yml not found at {COMPOSE_PATH}"
    with open(COMPOSE_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


@pytest.fixture
def ci_workflow() -> dict:
    assert CI_WORKFLOW_PATH.is_file(), f"ci.yml not found at {CI_WORKFLOW_PATH}"
    with open(CI_WORKFLOW_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def test_dockerfile_uvicorn_binds_to_all_interfaces(dockerfile_content: str):
    """Container networking: Uvicorn must listen on 0.0.0.0 so Compose published port is reachable."""
    assert "--host 0.0.0.0" in dockerfile_content or '"--host", "0.0.0.0"' in dockerfile_content
    assert "--host localhost" not in dockerfile_content
    assert '"--host", "localhost"' not in dockerfile_content


def test_dockerfile_runs_as_unprivileged_user(dockerfile_content: str):
    """Container security: Must switch to a dedicated unprivileged user, not run as root."""
    user_lines = [
        line.strip()
        for line in dockerfile_content.splitlines()
        if line.strip().startswith("USER ")
    ]
    assert len(user_lines) == 1, "Expected exactly one USER directive in Dockerfile"
    username = user_lines[0].split()[1].strip()
    assert username != "root", "Container must not run as root"
    assert username == "node", f"Expected unprivileged user 'node', got '{username}'"


def test_dockerfile_npm_prefix_and_path_configured(dockerfile_content: str):
    """NPM harness install: User-writable prefix and PATH must include user local and npm bins."""
    assert "NPM_CONFIG_PREFIX=/home/node/.npm-global" in dockerfile_content
    assert "/home/node/.local/bin" in dockerfile_content
    assert "/home/node/.npm-global/bin" in dockerfile_content


def test_dockerfile_directories_chowned(dockerfile_content: str):
    """Data persistence: /app/data, /app/storage, and home directories must be owned by unprivileged user."""
    assert "chown -R node:node" in dockerfile_content
    assert "/app/data" in dockerfile_content
    assert "/app/storage" in dockerfile_content


def test_dockerfile_healthcheck_functional(dockerfile_content: str):
    """Health check: Image must declare a functional HEALTHCHECK hitting /health."""
    assert "HEALTHCHECK" in dockerfile_content
    assert "/health" in dockerfile_content


def test_compose_redis_not_exposed_to_host(compose_config: dict):
    """Redis security: Unauthenticated Redis must not expose host ports."""
    services = compose_config.get("services", {})
    assert "redis" in services, "Redis service missing from compose"
    redis_svc = services["redis"]
    assert "ports" not in redis_svc or not redis_svc["ports"], (
        "Redis service must not publish ports to the host"
    )


def test_compose_redis_has_healthcheck(compose_config: dict):
    """Redis healthcheck: Compose must define a healthcheck for Redis."""
    redis_svc = compose_config["services"]["redis"]
    healthcheck = redis_svc.get("healthcheck")
    assert healthcheck is not None, "Redis service must define healthcheck"
    test_cmd = healthcheck.get("test")
    if isinstance(test_cmd, list):
        test_str = " ".join(test_cmd)
    else:
        test_str = str(test_cmd)
    assert "redis-cli" in test_str and "ping" in test_str


def test_compose_gateway_waits_for_redis_health(compose_config: dict):
    """Compose dependencies: Gateway must wait for Redis service_healthy, not mere creation."""
    gateway_svc = compose_config["services"]["afaq-gateway"]
    depends_on = gateway_svc.get("depends_on")
    assert depends_on is not None, "Gateway must have depends_on"
    assert isinstance(depends_on, dict), "depends_on must be dictionary specifying condition"
    assert "redis" in depends_on
    assert depends_on["redis"].get("condition") == "service_healthy"


def test_compose_gateway_published_port_loopback_only(compose_config: dict):
    """Gateway security: Published port must bind explicitly to 127.0.0.1, not all interfaces."""
    gateway_svc = compose_config["services"]["afaq-gateway"]
    ports = gateway_svc.get("ports", [])
    assert ports, "Gateway must publish port 3500"
    for port_mapping in ports:
        if isinstance(port_mapping, str):
            assert port_mapping.startswith("127.0.0.1:"), (
                f"Port mapping '{port_mapping}' must be explicitly bound to loopback (127.0.0.1)"
            )
            assert not port_mapping.startswith("0.0.0.0:"), "Port mapping must not bind to 0.0.0.0 on host"
        elif isinstance(port_mapping, dict):
            assert port_mapping.get("host_ip") == "127.0.0.1"


def test_compose_gateway_volume_mounts_coherent(compose_config: dict):
    """Volume coherence: Named volume mount targets must reflect unprivileged user paths."""
    gateway_svc = compose_config["services"]["afaq-gateway"]
    volumes = gateway_svc.get("volumes", [])
    vol_str = " ".join(volumes)
    assert "/root/.npm" not in vol_str, "Obsolete /root/.npm volume target must be removed"
    assert "/root/.local" not in vol_str, "Obsolete /root/.local volume target must be removed"
    assert "afaq_harnesses:/home/node/.npm-global" in volumes
    assert "afaq_local_bin:/home/node/.local" in volumes
    assert "afaq_data:/app/data" in volumes
    assert "afaq_storage:/app/storage" in volumes


def test_native_settings_default_host_unchanged():
    """Application setting: Native default host must remain 'localhost'."""
    s = Settings()
    assert s.host == "localhost", f"Expected default host 'localhost', got '{s.host}'"


def test_ci_workflow_creates_env_before_compose_build(ci_workflow: dict):
    """CI ordering: Temporary .env must be created before docker compose build without logging secrets."""
    steps = ci_workflow.get("jobs", {}).get("test", {}).get("steps", [])
    assert steps, "CI workflow must define test job steps"

    env_step_idx = None
    build_step_idx = None
    smoke_step_idx = None
    teardown_step_idx = None

    for idx, step in enumerate(steps):
        name = step.get("name", "").lower()
        run = step.get("run", "")
        if ".env" in run and ("secrets" in run or "create" in name):
            env_step_idx = idx
            # Ensure the secret generation does not print secrets to workflow stdout
            assert "print(f'SECRET_KEY=" not in run and 'print(f"SECRET_KEY=' not in run, (
                "CI step must not print generated secrets to stdout"
            )
        if "compose build" in run or "docker build" in run:
            build_step_idx = idx
        if "curl" in run and "/health" in run:
            smoke_step_idx = idx
        if "compose down" in run:
            teardown_step_idx = idx
            assert step.get("if") == "always()", "Teardown step must have if: always()"

    assert env_step_idx is not None, "Step creating .env was not found in CI workflow"
    assert build_step_idx is not None, "Step building Docker image was not found in CI workflow"
    assert smoke_step_idx is not None, "Step running Compose smoke test was not found in CI workflow"
    assert teardown_step_idx is not None, "Step tearing down Compose was not found in CI workflow"

    assert env_step_idx < build_step_idx, (
        f".env creation step (index {env_step_idx}) must run before build step (index {build_step_idx})"
    )
    assert build_step_idx < smoke_step_idx, (
        f"Build step (index {build_step_idx}) must run before smoke test step (index {smoke_step_idx})"
    )
    assert smoke_step_idx < teardown_step_idx, (
        f"Smoke test step (index {smoke_step_idx}) must run before teardown step (index {teardown_step_idx})"
    )
