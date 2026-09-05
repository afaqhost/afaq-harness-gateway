# Phase 03 — Usage History, Pagination & Archive

**Session ID:** `S3` · **Effort:** 3h · **Risk:** Medium · **Depends:** None (parallel to S1/S2)  
**Goal:** Dashboard can paginate, search, archive (not hard-delete) and query usage.

---

## 1. Why

`AFQAUDIT.md:166` flags *`list_conversations` returns all with no `limit/offset`* — mobile will OOM with 1k conversations. `AFQAUDIT.md:182` `UsageRecord` has no `GET` endpoint. `AFQAUDIT.md:166` `archive` missing — delete is permanent `app/api/chat.py:148` `db.delete(conv)`.

**Files:**

- `app/db/database.py:53` `Conversation` (no `archived`/`deleted_at`)
- `app/db/database.py:72` `UsageRecord`
- `app/api/chat.py:104` `list_conversations`
- `app/repositories/conversation_repository.py:15` `list_conversations_for_user`
- `app/main.py:26` router mount

---

## 2. Scope

**IN:** `GET /api/chat/usage`, `GET /conversations?limit&offset&q&archived`, `PATCH archived`, soft-delete + restore.  
**OUT:** Search by message content FTS (defer), sync tokens (S8).

---

## 3. Architecture After

```
GET /conversations?limit=20&offset=0&q=hello&archived=false
  -> repository.list_conversations_for_user(user, limit, offset, q, archived)
     -> SELECT ... WHERE user_id=? AND archived=? AND (title ILIKE ? OR EXISTS Message ...) ORDER BY updated_at DESC LIMIT ? OFFSET ?
```

New: `app/repositories/usage_repository.py`, `app/api/usage.py`. `Conversation` adds `archived`, `archived_at`, `deleted_at` (soft).

---

## 4. Detailed Tasks

### 4.1 S3.1 — DB Schema (`30m`)

- [ ] Add to `Conversation` `app/db/database.py:53`:

```python
archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

- [ ] For `SQLite` tests `Base.metadata.create_all` handles it; for prod `data/afaq.db` document migration:

```bash
# if alembic not yet: simple script
.venv/bin/python -c "from app.db.database import Base, engine; import asyncio; asyncio.run(engine.begin(lambda c: c.run_sync(Base.metadata.create_all)))"
```

- [ ] Add composite index `Index("ix_conversations_user_archived_updated", "user_id", "archived", "updated_at")` if query plan shows.

### 4.2 S3.2 — Usage History (`45m`)

- [ ] Create `app/repositories/usage_repository.py`:

```python
async def list_usage(db, user_id, limit=20, offset=0, harness=None, model=None, from_dt=None, to_dt=None):
    q = select(UsageRecord).where(UsageRecord.user_id == user_id)
    if harness: q = q.where(UsageRecord.harness == harness)
    # ... filters, order_by(desc(created_at)), limit/offset
    return scalars, total_count
```

- [ ] Create `app/api/usage.py`:

```python
router = APIRouter()
@router.get("/usage", response_model=dict)
async def list_usage(limit: int = 20, offset: int = 0, harness: str | None = None, ... , user=Depends(current_user), db=Depends(get_db)):
    if limit > 100: raise HTTPException(400, "limit max 100")
    items, total = await usage_repo.list_usage(db, user.id, limit, offset, harness)
    return {"items": items, "total": total, "limit": limit, "offset": offset}
```

- [ ] Mount in `app/main.py:28` `app.include_router(usage_router, prefix="/api/chat", tags=["usage"])` (or `/api/usage`).

### 4.3 S3.3 — Conversation Pagination & Search (`45m`)

- [ ] Update `app/repositories/conversation_repository.py:15`:

```python
async def list_conversations_for_user(user, db, limit=20, offset=0, q: str | None = None, archived: bool = False):
    stmt = select(Conversation).where(Conversation.user_id == user.id, Conversation.archived == archived, Conversation.deleted_at.is_(None))
    if q: stmt = stmt.where(Conversation.title.ilike(f"%{q}%"))
    stmt = stmt.order_by(desc(Conversation.updated_at)).limit(limit).offset(offset)
    return list((await db.execute(stmt)).scalars().all())
```

- [ ] Update `app/api/chat.py:104` `list_conversations(limit: int=20, offset: int=0, q: str | None=None, archived: bool=False)` to forward params. Add `fastapi.Query` validation `ge=0, le=100`.

- [ ] Also add `GET /conversations/{id}` message pagination `?limit_messages=50&offset_messages=0` (optional, not blocking).

### 4.4 S3.4 — Archive & Soft-Delete (`45m`)

- [ ] `PATCH /conversations/{id}` `app/api/chat.py:135` already handles `title/model` — extend to accept `archived: bool | None`:

```python
if payload.archived is not None:
    conv.archived = payload.archived
    conv.archived_at = datetime.utcnow() if payload.archived else None
```

- [ ] `DELETE /conversations/{id}` `app/api/chat.py:148` change from `db.delete(conv)` to `conv.deleted_at = datetime.utcnow(); conv.archived = True` (soft). Return `204`.

- [ ] New `POST /conversations/{id}/restore` → set `deleted_at=None`.

- [ ] `GET /conversations?archived=true` shows archived; default `archived=false` hides both archived and deleted.

### 4.5 S3.5 — Config & Docs (`15m`)

- [ ] Update `docs/api.md` with new query params and `archived` example.

---

## 5. Tests

**Integration** `tests/integration/test_pagination_integration.py`:

- `test_list_pagination_returns_limited` — create 25 convs, `GET ?limit=10` → 10, `offset=10` → next 10, no overlap.
- `test_search_filters_by_title` — create titles `hello`, `world`, `hello world`, `q=hello` → 2 results.
- `test_archived_filter_hides_by_default` — archive one, default list  → not present, `?archived=true` → present.

**Integration** `tests/integration/test_usage_integration.py`:

- Seed 3 `UsageRecord` (different harness/model), `GET /usage?limit=2` → 2 + `total=3`, `?harness=opencode` filters.
- `test_usage_isolation` — user A cannot see user B's usage.

**Integration** `tests/integration/test_archive_integration.py`:

- `test_archive_and_restore` — `PATCH archived=true` → not in default, `POST /restore` → back, `DELETE` soft → `GET {id}` → `404` or `410`? Keep `404` for soft-deleted (or `200` with `deleted=true` — choose `404` to match existing `get_conversation_or_404` that checks `deleted_at`).

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_pagination_integration.py tests/integration/test_usage_integration.py -q
```

---

## 6. Verification & Exit

- [ ] Dashboard `GET /api/chat/conversations?limit=20` no longer returns all 1k rows (check via `curl | jq . | wc -l`).
- [ ] Archive button sets `archived=true`, conversation disappears from default list, appears with `?archived=true`.
- [ ] `GET /usage` returns `{"items":[...],"total":...}` with authz.
- [ ] `pytest -m integration -q` green; total ~105 tests.

**Checklist:**

- [ ] `- [x] S3 Usage/Pagination/Archive`

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Existing `data/afaq.db` missing new columns | `create_all` adds columns for SQLite; for prod, ship `migrate_s3.py` script with `ALTER TABLE conversations ADD COLUMN archived BOOLEAN DEFAULT 0`. |
| `q` LIKE injection | Use bound param `ilike(f"%{q}%")` via SQLAlchemy (already parameterized), not string interpolation. |
| `limit` DoS | Cap `100` `app/api/chat.py:104` `Query(le=100)`. |

**Rollback:** Keep `archived` default `False`; old code ignores new columns, safe.

