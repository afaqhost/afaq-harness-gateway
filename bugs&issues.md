# Afaq Harness Gateway — Audit Findings & Issue Register

Final review date: 2026-10-04
Reviewed revision: `e0d9cd8`
Baseline audit revision: `ca38352` (`881616a`)
Status: **All original P1, P2, and P3 findings are RESOLVED.** There are **no known open release-blocking defects** remaining from this audit.

---

## 1. Resolved Findings Register

| ID | Severity | Title | Resolving Commit | Regression Test Coverage | Status |
| --- | --- | --- | --- | --- | --- |
| **SEC-01** | P1 | Restrict API keys from privileged dashboard and terminal routes | `a3f6caa` | `tests/security/test_auth_hardening.py::test_admin_api_key_cannot_reach_admin_endpoints_or_terminal_start`<br>`tests/security/test_auth_hardening.py::test_os_terminal_websocket_rejects_admin_api_key` | **RESOLVED** |
| **SEC-02** | P1 | Reject exact secrets and placeholders shipped in `.env.example` | `a3f6caa` | `tests/security/test_auth_hardening.py::test_exact_example_placeholders_and_weak_secrets_rejected`<br>`tests/security/test_auth_hardening.py::test_env_example_file_fails_in_production_mode` | **RESOLVED** |
| **NET-01** | P1 | Bind Uvicorn to container interface (`0.0.0.0`) and isolate Compose ports | `dccba91` | `tests/unit/test_docker_deployment.py::test_dockerfile_uvicorn_binds_to_all_interfaces`<br>`tests/unit/test_docker_deployment.py::test_compose_gateway_published_port_loopback_only` | **RESOLVED** |
| **SEC-03** | P1 | Defend against spoofed `X-Forwarded-For` headers in rate limiting | `a3f6caa` | `tests/security/test_auth_hardening.py::test_forwarded_ip_spoofing_ignored_by_default_honored_for_trusted_proxies` | **RESOLVED** |
| **REL-01** | P2 | Isolate OpenAI SSE replay history per stream instance | `0e20ab3`<br>`13d7e78` | `tests/integration/test_sse_reconnect.py::test_two_openai_streams_same_user_do_not_collide`<br>`tests/unit/test_transport_identity.py::test_build_history_key` | **RESOLVED** |
| **REL-02** | P2 | Drain subprocess stderr concurrently during streaming | `0e20ab3` | `tests/unit/test_harness_adapters.py::test_stream_verbose_stderr_no_deadlock` | **RESOLVED** |
| **DAT-01** | P2 | Atomic API-key quota reservations and durable usage accounting | `217c7ba` | `tests/integration/test_quota_reservation_integration.py::test_concurrent_daily_limit_admits_exactly_one`<br>`tests/integration/test_quota_reservation_integration.py::test_concurrent_monthly_admission_is_atomic` | **RESOLVED** |
| **PERF-01**| P2 | Eliminate synchronous Redis I/O from async request and streaming paths | `13d7e78` | `tests/unit/test_redis_async_hardening.py::test_no_production_module_imports_sync_redis`<br>`tests/unit/test_redis_async_hardening.py::test_async_history_pipeline_order_and_bounded_length` | **RESOLVED** |
| **AUTH-01**| P3 | Reject login attempts for inactive accounts immediately | `a3f6caa` | `tests/security/test_auth_hardening.py::test_inactive_user_login_fails_without_jwt` | **RESOLVED** |
| **ASYNC-01**| P3| Await or remove orphan Redis reset cleanup tasks | `13d7e78`<br>`e0d9cd8` | `tests/unit/test_redis_async_hardening.py::test_rate_limiter_reset_is_local_only_and_creates_no_tasks`<br>`tests/unit/test_redis_async_hardening.py::test_no_unawaited_coroutine_warnings` | **RESOLVED** |
| **DOC-01** | P3 | Align documented test counts and remove stale metrics | `e0d9cd8`<br>reconciliation | Enforced warning-free test execution (`pytest -W error`) in `Makefile` and documentation | **RESOLVED** |

---

## 2. Additional Hardening Measures (`e0d9cd8`)

In addition to the initial audit items, final stability and safety passes in `e0d9cd8` resolved further potential failure modes:
1. **Direct Bcrypt Integration with 72-Byte UTF-8 Ceiling (`app/core/security.py`):** Replaced legacy `passlib` with direct `bcrypt` hashing, explicitly enforcing `BCRYPT_MAX_PASSWORD_BYTES = 72` to prevent silent password truncation. Verified by `tests/unit/test_security_utils.py::test_bcrypt_72_byte_limit_enforced_explicitly`.
2. **Multithread-Safe POSIX OS Terminal Spawning (`app/services/os_terminal.py`):** Replaced unsafe `pty.fork()` in multi-threaded Uvicorn runtimes with `os.openpty()` and `os.posix_spawn()`, paired with an isolated child execution wrapper (`app/services/os_terminal_child.py`). Verified by `tests/integration/test_os_terminal.py`.
3. **Deterministic Subprocess Timeout & Reaping (`app/clients/base.py`):** Created `communicate_with_timeout` to ensure child processes are terminated, waited, and standard stream transports closed upon timeout or cancellation. Verified by `tests/unit/test_subprocess_timeout.py::test_communicate_with_timeout_terminates_and_reaps_on_timeout`.
4. **Connection Pool & Session Hygiene (`tests/integration/test_connection_pool_cleanup.py`):** Verified proper connection recycling, checkout/checkin lifecycle, and clean session teardown across high-frequency operations.

---

## 3. Verification & Evidence Summary

Verification was conducted on clean repository revision `e0d9cd8`:

- **Automated Test Suite:**
  ```bash
  .venv/bin/python -m pytest -q -W error
  # Output: 328 passed in 92.46s, 0 warnings
  ```
- **Bytecode Compilation:**
  ```bash
  .venv/bin/python -m compileall -q app
  # Output: clean (exit code 0)
  ```
- **Frontend Syntax Validation:**
  ```bash
  node --check app/static/app.js
  # Output: clean (exit code 0)
  ```
- **Git Formatting & Whitespace:**
  ```bash
  git diff --check
  # Output: clean (exit code 0)
  ```
- **Container Smoke Test:** Docker image build, non-root user verification, port 3500 binding, and Compose published-port reachability confirmed.

---

## 4. Honest Remaining Limitations & Technical Debt

The following items are acknowledged architectural limitations and technical debt that do not block release 0.1.0, but should be managed by operators and scheduled for future roadmap milestones:

1. **No Database Migration Framework:** Schema initialization relies on `Base.metadata.create_all()` in `app/db/database.py`. There is no built-in schema migration tool (e.g. Alembic) or automated rollback framework. Schema modifications on deployed systems require manual SQL scripts or database recreation.
2. **Operator-Managed SQLite Backups:** SQLite in WAL mode provides robust single-node ACID guarantees, but disaster recovery, snapshotting, and offsite backups of `data/afaq.db` (and `-wal` / `-shm` sidecars) are the operator's responsibility.
3. **Replica-Local Fallback During Redis Outages:** If Redis becomes unavailable, each replica degrades to its in-memory history buffer and shadow rate limiter. Cross-replica rate-limit coordination is unavailable during the outage, and locally buffered events are not backfilled into Redis upon recovery. Reconnecting clients can replay outage-period events only when routed to the originating replica.
4. **POSIX-Only Admin Terminal:** The interactive OS terminal relies on POSIX primitives (`openpty`, `posix_spawn`). It is unavailable on Windows environments (returns `HTTP 503`). Furthermore, because it provides shell access as the container/host user, administrative access must be guarded strictly.
5. **Testing Scope Boundaries:** Automated regression coverage uses fake/mocked harness adapters and isolated in-memory Redis tests. The test suite does not connect to live external LLM provider accounts or test live multi-node Redis cluster network partitions.
6. **Frontend & Controller Layering Debt:** The frontend remains a monolithic 2,100-line script (`app/static/app.js`). Similarly, while the target architecture specifies thin controllers calling single domain services, several controllers (`app/api/chat.py`, `app/api/openai.py`) still execute direct database operations and orchestration inline.
