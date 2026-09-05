# Phase 06 — Credential Profiles (Wire `encrypt_secret`)

**Session ID:** `S6` · **Effort:** 3h · **Risk:** Medium · **Depends:** S5  
**Goal:** `encrypt_secret`/`decrypt_secret` `app/core/security.py:34` actually used; per-harness credential profiles.

---

## 1. Why

`AFQAUDIT.md:158` flags `CredentialProfile` *does not exist as code*, `encrypt_secret` dead code. `app/api/admin.py:33` `authenticated` is `bool(row.authenticated)` from `Harness` table but never updated via real check. `DESIGN.md:385` expects `Profile: Personal / Status: Authenticated / Auth: CLI Login`.

**Files:**

- `app/core/security.py:28` `_fernet`, `app/core/security.py:34` `encrypt_secret`
- `app/db/database.py:40` `Harness` (has `authenticated` bool but no token storage)
- `app/clients/base.py:43` `authenticate` stub `manual_required`
- `app/api/admin.py:33` `harnesses` endpoint

---

## 2. Scope

**IN:** `credential_profiles` table, `POST/GET/DELETE /credentials`, `POST /credentials/{id}/check`, env injection into `adapter.run`.  
**OUT:** OAuth flow, token refresh, UI for “Reconnect” button (next session).

---

## 3. Architecture After

```
POST /harnesses/{name}/credentials {profile, auth_type, token} -> encrypt_secret(token) -> DB
GET  /credentials -> [{id, harness, profile, auth_type, status, last_checked_at}] (never raw)
POST /credentials/{id}/check -> adapter.authenticate() -> update status/last_checked_at
DELETE /credentials/{id}

adapter.run(prompt, ..., env=decrypted_token_env)  # via services/credential_service
```

New: `app/db/database.py` `CredentialProfile`, `app/services/credential_service.py`, `app/api/credentials.py`.

---

## 4. Detailed Tasks

### 4.1 S6.1 — Schema (`30m`)

- [ ] Add to `app/db/database.py`:

```python
class CredentialProfile(Base):
    __tablename__ = "credential_profiles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    harness: Mapped[str] = mapped_column(String(80), index=True)
    profile_name: Mapped[str] = mapped_column(String(80), default="default")
    auth_type: Mapped[str] = mapped_column(String(20), default="environment")  # environment|cli|token
    encrypted_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="unknown")  # unknown|authenticated|failed|manual_required
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    user: Mapped[User] = relationship()
```

- [ ] Add `UniqueConstraint(user_id, harness, profile_name)`.

- [ ] Migration: `create_all` for tests; for prod document `ALTER TABLE`.

### 4.2 S6.2 — Service (`45m`)

- [ ] Create `app/services/credential_service.py`:

```python
from app.core.security import encrypt_secret, decrypt_secret

async def create_profile(db, user_id, harness, profile_name, auth_type, raw_token: str | None) -> CredentialProfile:
    enc = encrypt_secret(raw_token) if raw_token else None
    profile = CredentialProfile(user_id=user_id, harness=harness, profile_name=profile_name, auth_type=auth_type, encrypted_token=enc)
    db.add(profile); await db.commit(); ...

async def get_env_for_harness(db, user_id, harness) -> dict:
    # find default profile for harness+user, decrypt, return {"ANTHROPIC_API_KEY": decrypted} etc per harness
    # mapping: claude -> ANTHROPIC_API_KEY, codex -> OPENAI_API_KEY, etc.
```

- [ ] `get_env_for_harness` returns `{}` if no profile or `auth_type==cli` (CLI handles login externally).

### 4.3 S6.3 — API (`1h`)

- [ ] Create `app/api/credentials.py`:

```python
router = APIRouter()

@router.post("/harnesses/{harness}/credentials")
async def create_credential(harness: str, payload: CredentialCreate, user=Depends(current_user), db=Depends(get_db)):
    # validate harness exists via get_adapter(harness)
    # encrypt, save, return {id, harness, profile_name, status} (never raw)
    ...

@router.get("/credentials")
async def list_credentials(user=Depends(current_user), db=Depends(get_db)):
    ...

@router.post("/credentials/{id}/check")
async def check_credential(id: int, user=Depends(current_user), db=Depends(get_db)):
    profile = await db.get(CredentialProfile, id)
    if not profile or profile.user_id != user.id: raise 404
    adapter = get_adapter(profile.harness)
    result = await adapter.authenticate(mode=profile.auth_type)
    profile.status = result["status"]; profile.last_checked_at = datetime.utcnow()
    await db.commit()
    return {"status": profile.status, "last_checked_at": profile.last_checked_at}

@router.delete("/credentials/{id}", status_code=204)
async def delete_credential(...): ...
```

- [ ] Mount in `app/main.py:28` `app.include_router(credentials_router, prefix="/api/admin", tags=["credentials"])`.

### 4.4 S6.4 — Env Injection (`30m`)

- [ ] In `app/api/chat.py:186` `adapter.run(prompt, model_name)` and `app/api/chat.py:265` `adapter.stream`, inject `env` from `credential_service.get_env_for_harness(db, user.id, harness_name)`:

```python
env = await credential_service.get_env_for_harness(db, user.id, harness_name)
result_h = await adapter.run(prompt, model_name, env=env)
```

- [ ] Same for `app/api/openai.py:160` `_non_stream_response` and `112` `_stream_response`.

### 4.5 S6.5 — Harvest Env on Startup (`15m`)

- [ ] In `app/main.py:17` `lifespan`, after `init_db`, check `os.environ` for `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `COMMAND_CODE_TOKEN` etc., and auto-create `credential_profiles` with `auth_type=environment` for admin user if not exists (masked).

---

## 5. Tests

**Unit** `tests/unit/test_credential_service.py`:

- `test_encrypt_decrypt_roundtrip` already `tests/unit/test_security_utils.py:24` — add `test_create_profile_encrypts_not_plain` — create profile, assert `encrypted_token != raw` and `encrypted_token` not contain `raw` substring, `decrypt(encrypted) == raw`.
- `test_get_env_maps_harness_to_env_var` — for `claude` returns `{"ANTHROPIC_API_KEY": decrypted}`.

**Integration** `tests/integration/test_credentials_integration.py` (real DB):

```python
async def test_create_and_list_credentials_masked(client, user_headers):
    resp = await client.post("/api/admin/harnesses/claude/credentials", headers=user_headers, json={"profile_name":"personal","auth_type":"token","token":"secret123"})
    assert resp.status_code == 200
    assert "secret123" not in resp.text
    list_resp = await client.get("/api/admin/credentials", headers=user_headers)
    assert "secret123" not in list_resp.text
    assert "encrypted_token" not in list_resp.text  # never exposed
```

- `test_check_updates_status` — mock `adapter.authenticate` to return `{"status":"authenticated"}`, `POST /check` → `status authenticated`.

- `test_delete_removes_profile`.

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_credentials_integration.py -q
```

---

## 6. Verification & Exit

- [ ] `POST /harnesses/claude/credentials {"token":"sk-ant-..."} ` → `201` without raw in response, `GET /credentials` shows `status unknown` and no token.
- [ ] `POST /credentials/{id}/check` → `status` changes to `authenticated` or `manual_required` and `last_checked_at` set.
- [ ] `POST /chat/completions` with credential profile present injects env into harness subprocess (verify via `FakeAdapter` that `env` contains key).
- [ ] `app/api/admin.py:33` `authenticated` now reflects `CredentialProfile.status == "authenticated"` for that harness.
- [ ] `pytest -m integration -q` green; total ~115 tests.

**Checklist:**

- [ ] `- [x] S6 Credential Profiles`

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| `credentials_key` change invalidates old rows | Store `key_version` in row, decrypt with old key fallback, re-encrypt on read. Document rotation in `docs/configuration.md`. |
| Token logged in `UsageRecord` or logs | Ensure `redaction` middleware `S8` scrubs `Authorization` and `encrypted_token` never logged; for now manually filter `logger`. |
| `auth_type=cli` confusion | `adapter.authenticate` already `manual_required` `app/clients/base.py:43` — keep, update `status` accordingly. |

**Rollback:** Feature flag `if not settings.enable_credentials: raise 501` — table stays but unused, safe.

