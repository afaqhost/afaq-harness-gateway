"""Integration tests for atomic database-backed API-key quota reservations.

Proves:
- Concurrent daily limit=1 attempts admit exactly one and reject the rest with 429.
- Monthly admission is atomic.
- Active reservations count; expired reservations do not.
- Finalization creates one usage row and removes the reservation without double-counting.
- Missing/double-finalized tokens never create usage.
- Failure/cancel releases the reservation and permits a later request.
- OpenAI stream/non-stream finalize/release correctly.
- Finalization failure in streaming prevents [DONE] emission.
- Caller request session with active transaction / pending mutations is isolated and never committed/rolled back.
- Dashboard chat with an API key records api_key_id; conversation creation does not consume quota.
- Cross-user dashboard API key is rejected with 403 and never charged.
- Quota session factory seam proves production SessionLocal is never used.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import pytest
import pytest_asyncio
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.clients.registry import MODEL_CACHE
from app.core.security import create_access_token, generate_api_key, hash_password
from app.db import database
from app.db.database import APIKey, Base, Conversation, Message, QuotaReservation, UsageRecord, User, get_db
from app.main import app
from app.models.harness import HarnessModel, HarnessResult
from app.services import quota_service
from app.shared.time import utcnow

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def seed_test_models():
    MODEL_CACHE.clear()
    MODEL_CACHE["opencode"] = [
        HarnessModel(
            id="opencode//opencode/big-pickle",
            harness="opencode",
            provider="opencode",
            name="opencode/big-pickle",
        )
    ]
    yield
    MODEL_CACHE.clear()


@pytest_asyncio.fixture
async def shared_db(tmp_path: Path):
    """Create a temporary SQLite file with WAL mode and busy_timeout using pytest tmp_path."""
    db_path = str(tmp_path / "test_quota.db")

    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", poolclass=NullPool, connect_args={"check_same_thread": False})

    @event.listens_for(engine.sync_engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
        cursor.execute("PRAGMA busy_timeout=5000;")
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    quota_service.set_session_factory(session_factory)

    yield engine, session_factory, db_path

    quota_service.set_session_factory(None)
    if hasattr(engine.sync_engine.pool, "checkedout"):
        assert engine.sync_engine.pool.checkedout() == 0
    await engine.dispose()


@pytest.mark.asyncio
async def test_quota_session_factory_seam_proves_production_sessionlocal_not_used(shared_db):
    """Proves quota_service uses the injected session factory seam and never calls production SessionLocal."""
    _, session_factory, _ = shared_db
    quota_service.set_session_factory(session_factory)

    raw, prefix, digest = generate_api_key()
    key = APIKey(id=99, user_id=99, name="seam-key", key_prefix=prefix, key_hash=digest, daily_limit=5)
    async with session_factory() as session:
        user = User(id=99, email="seam@test.com", password_hash="hash")
        session.add(user)
        session.add(key)
        await session.commit()

    with patch("app.db.database.SessionLocal", side_effect=AssertionError("Production SessionLocal must not be used!")):
        res = await quota_service.reserve_quota(key)
        assert res is not None
        assert res.api_key_id == 99

        finalized = await quota_service.finalize_reservation(
            token=res.token,
            user_id=99,
            api_key_id=99,
            harness="opencode",
            model="opencode//opencode/big-pickle",
            prompt_tokens=5,
            completion_tokens=5,
        )
        assert finalized is not None

        released = await quota_service.release_reservation("nonexistent-token")
        assert released is False


@pytest.mark.asyncio
async def test_caller_session_isolation_preserves_active_transaction_and_mutations(shared_db):
    """Caller session with an active transaction and uncommitted mutations is never committed or rolled back."""
    _, session_factory, _ = shared_db

    async with session_factory() as caller_session:
        user = User(id=77, email="caller@test.com", password_hash="hash")
        raw, prefix, digest = generate_api_key()
        key = APIKey(id=77, user_id=77, name="caller-key", key_prefix=prefix, key_hash=digest, daily_limit=1)
        caller_session.add(user)
        caller_session.add(key)
        await caller_session.commit()

        # Start an active transaction by performing a read
        _ = await caller_session.get(User, 77)

        # Stage an uncommitted new mutation on caller_session
        uncommitted_conv = Conversation(user_id=77, title="Uncommitted Draft", model="default")
        caller_session.add(uncommitted_conv)
        assert uncommitted_conv in caller_session.new

        # Reserve quota, passing the active caller_session
        res = await quota_service.reserve_quota(key, db=caller_session)
        assert res is not None

        # Verify caller_session still has uncommitted_conv in its uncommitted pending set (NOT committed!)
        assert uncommitted_conv in caller_session.new

        # Attempting second quota reservation raises 429
        with pytest.raises(HTTPException) as exc_info:
            await quota_service.reserve_quota(key, db=caller_session)
        assert exc_info.value.status_code == 429
        assert exc_info.value.headers["Retry-After"] == "86400"

        # Verify caller_session was NOT rolled back by the 429
        assert uncommitted_conv in caller_session.new

        # Now clean up: caller explicitly commits its own uncommitted work
        await caller_session.commit()
        saved = await caller_session.get(Conversation, uncommitted_conv.id)
        assert saved is not None
        assert saved.title == "Uncommitted Draft"

        # Release quota
        await quota_service.release_reservation(res.token)


@pytest.mark.asyncio
async def test_missing_and_double_finalized_tokens_never_create_usage(shared_db):
    """Missing or double-finalized tokens return None and never create usage rows."""
    _, session_factory, _ = shared_db

    async with session_factory() as session:
        user = User(id=88, email="token_test@test.com", password_hash="hash")
        raw, prefix, digest = generate_api_key()
        key = APIKey(id=88, user_id=88, name="token-key", key_prefix=prefix, key_hash=digest, daily_limit=5)
        session.add(user)
        session.add(key)
        await session.commit()

        # 1. Finalizing with a nonexistent token returns None and creates 0 usage rows
        bad_finalized = await quota_service.finalize_reservation(
            token="completely-bogus-token",
            user_id=88,
            api_key_id=88,
            harness="opencode",
            model="default",
            prompt_tokens=10,
            completion_tokens=10,
        )
        assert bad_finalized is None
        cnt = await session.scalar(select(func.count()).select_from(UsageRecord).where(UsageRecord.api_key_id == 88))
        assert cnt == 0

        # 2. Reserve a real token
        res = await quota_service.reserve_quota(key)
        assert res is not None

        # 3. Finalize it once -> success, exactly 1 usage row created
        ok_rec = await quota_service.finalize_reservation(
            token=res.token,
            user_id=88,
            api_key_id=88,
            harness="opencode",
            model="default",
            prompt_tokens=10,
            completion_tokens=10,
        )
        assert ok_rec is not None
        cnt = await session.scalar(select(func.count()).select_from(UsageRecord).where(UsageRecord.api_key_id == 88))
        assert cnt == 1

        # 4. Double-finalization of the same token returns None and usage count remains 1
        second_attempt = await quota_service.finalize_reservation(
            token=res.token,
            user_id=88,
            api_key_id=88,
            harness="opencode",
            model="default",
            prompt_tokens=10,
            completion_tokens=10,
        )
        assert second_attempt is None
        cnt = await session.scalar(select(func.count()).select_from(UsageRecord).where(UsageRecord.api_key_id == 88))
        assert cnt == 1


@pytest.mark.asyncio
async def test_concurrent_daily_limit_admits_exactly_one(shared_db):
    """Concurrent daily limit=1 attempts admit exactly one and reject the rest with 429."""
    engine, session_factory, _ = shared_db

    # Seed user and key with daily_limit=1
    async with session_factory() as session:
        user = User(id=1, email="daily_user@test.com", password_hash="hash")
        raw, prefix, digest = generate_api_key()
        key = APIKey(id=1, user_id=1, name="daily-key", key_prefix=prefix, key_hash=digest, daily_limit=1)
        session.add(user)
        session.add(key)
        await session.commit()

    async def override_get_db():
        async with session_factory() as session:
            yield session

    async def fake_run(*args, **kwargs):
        await asyncio.sleep(0.05)
        return HarnessResult(text="response text", model="default")

    app.dependency_overrides[get_db] = override_get_db
    try:
        with patch("app.db.database.SessionLocal", session_factory), patch("app.api.openai.get_adapter") as mock_get:
            mock_get.return_value.run = fake_run
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                headers = {"Authorization": f"Bearer {raw}"}
                payload = {
                    "model": "opencode//opencode/big-pickle",
                    "messages": [{"role": "user", "content": "hello"}],
                }

                tasks = [client.post("/v1/chat/completions", headers=headers, json=payload) for _ in range(8)]
                responses = await asyncio.gather(*tasks)

                statuses = [r.status_code for r in responses]
                assert statuses.count(200) == 1, f"Expected exactly 1 success, got {statuses}"
                assert statuses.count(429) == 7, f"Expected 7 429s, got {statuses}"

                # Check 429 response structure and Retry-After
                rejected = [r for r in responses if r.status_code == 429]
                for r in rejected:
                    data = r.json()
                    assert data["error"]["code"] == "quota_exceeded"
                    assert "daily" in data["error"]["kind"].lower()
                    assert r.headers.get("Retry-After") == "86400"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_concurrent_monthly_admission_is_atomic(shared_db):
    """Monthly quota admission is atomic across concurrent sessions."""
    engine, session_factory, _ = shared_db

    async with session_factory() as session:
        user = User(id=2, email="monthly_user@test.com", password_hash="hash")
        raw, prefix, digest = generate_api_key()
        key = APIKey(id=2, user_id=2, name="monthly-key", key_prefix=prefix, key_hash=digest, monthly_limit=2)
        session.add(user)
        session.add(key)
        await session.commit()

    async def override_get_db():
        async with session_factory() as session:
            yield session

    async def fake_run(*args, **kwargs):
        await asyncio.sleep(0.04)
        return HarnessResult(text="monthly response", model="default")

    app.dependency_overrides[get_db] = override_get_db
    try:
        with patch("app.db.database.SessionLocal", session_factory), patch("app.api.openai.get_adapter") as mock_get:
            mock_get.return_value.run = fake_run
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                headers = {"Authorization": f"Bearer {raw}"}
                payload = {
                    "model": "opencode//opencode/big-pickle",
                    "messages": [{"role": "user", "content": "hi"}],
                }

                tasks = [client.post("/v1/chat/completions", headers=headers, json=payload) for _ in range(6)]
                responses = await asyncio.gather(*tasks)

                statuses = [r.status_code for r in responses]
                assert statuses.count(200) == 2, f"Expected exactly 2 successes, got {statuses}"
                assert statuses.count(429) == 4, f"Expected 4 429s, got {statuses}"

                for r in responses:
                    if r.status_code == 429:
                        assert r.headers.get("Retry-After") == "2592000"
                        assert "monthly" in r.json()["error"]["kind"]
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_active_reservations_count_and_expired_do_not(shared_db):
    """Active reservations count towards limit; expired reservations do not."""
    _, session_factory, _ = shared_db

    now = utcnow()
    async with session_factory() as session:
        user = User(id=3, email="expiry@test.com", password_hash="hash")
        raw, prefix, digest = generate_api_key()
        key = APIKey(id=3, user_id=3, name="expiry-key", key_prefix=prefix, key_hash=digest, daily_limit=2)
        session.add(user)
        session.add(key)
        await session.commit()

        # 1 active reservation (expires 10 minutes in future)
        active_res = QuotaReservation(
            token="active-token-1",
            api_key_id=3,
            created_at=now,
            expires_at=now + timedelta(minutes=10),
        )
        # 1 expired reservation (expired 5 minutes ago)
        expired_res = QuotaReservation(
            token="expired-token-1",
            api_key_id=3,
            created_at=now - timedelta(minutes=20),
            expires_at=now - timedelta(minutes=5),
        )
        session.add(active_res)
        session.add(expired_res)
        await session.commit()

        # Check quota exceeded: should be False because only 1 active reservation against limit=2
        exceeded, _ = await quota_service.is_quota_exceeded(key, now=now)
        assert not exceeded

        # Reserve a second slot: should succeed
        res2 = await quota_service.reserve_quota(key, now=now)
        assert res2 is not None

        # Check: now 2 active reservations -> limit reached
        exceeded, kind = await quota_service.is_quota_exceeded(key, now=now)
        assert exceeded
        assert kind == "daily"

        # Attempting a third reservation must raise 429 HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await quota_service.reserve_quota(key, now=now)
        assert exc_info.value.status_code == 429
        assert exc_info.value.detail["error"]["code"] == "quota_exceeded"
        assert exc_info.value.detail["error"]["kind"] == "daily"
        assert exc_info.value.headers["Retry-After"] == "86400"


@pytest.mark.asyncio
async def test_finalization_creates_one_usage_and_removes_reservation(shared_db):
    """Finalization creates exactly one usage row and removes reservation in the same transaction."""
    _, session_factory, _ = shared_db

    now = utcnow()
    async with session_factory() as session:
        user = User(id=4, email="finalize@test.com", password_hash="hash")
        raw, prefix, digest = generate_api_key()
        key = APIKey(id=4, user_id=4, name="finalize-key", key_prefix=prefix, key_hash=digest, daily_limit=5)
        session.add(user)
        session.add(key)
        await session.commit()

        # Reserve
        reservation = await quota_service.reserve_quota(key, now=now)
        token = reservation.token

        # Verify reservation row exists in DB
        res_count = await session.scalar(
            select(func.count()).select_from(QuotaReservation).where(QuotaReservation.token == token)
        )
        assert res_count == 1

        # Finalize
        rec = await quota_service.finalize_reservation(
            token=token,
            user_id=4,
            api_key_id=key.id,
            harness="opencode",
            model="opencode//opencode/big-pickle",
            prompt_tokens=10,
            completion_tokens=20,
            total_tokens=30,
        )
        assert rec is not None
        assert rec.api_key_id == key.id

        # Verify reservation is removed
        res_after = await session.scalar(
            select(func.count()).select_from(QuotaReservation).where(QuotaReservation.token == token)
        )
        assert res_after == 0

        # Verify usage record exists
        usage_count = await session.scalar(
            select(func.count()).select_from(UsageRecord).where(UsageRecord.api_key_id == key.id)
        )
        assert usage_count == 1


@pytest.mark.asyncio
async def test_failure_and_cancel_release_and_permit_later_request(shared_db):
    """Failure or cancel releases reservation and allows subsequent request to succeed."""
    _, session_factory, _ = shared_db

    async with session_factory() as session:
        user = User(id=5, email="cancel@test.com", password_hash="hash")
        raw, prefix, digest = generate_api_key()
        key = APIKey(id=5, user_id=5, name="cancel-key", key_prefix=prefix, key_hash=digest, daily_limit=1)
        session.add(user)
        session.add(key)
        await session.commit()

        # Reserve slot 1 -> quota saturated
        res = await quota_service.reserve_quota(key)
        assert res is not None

        # Next reservation fails with 429 HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await quota_service.reserve_quota(key)
        assert exc_info.value.status_code == 429
        assert exc_info.value.detail["error"]["code"] == "quota_exceeded"
        assert exc_info.value.headers["Retry-After"] == "86400"

        # Simulate release (failure / cancellation)
        released = await quota_service.release_reservation(res.token)
        assert released is True

        # Now reservation succeeds again
        res2 = await quota_service.reserve_quota(key)
        assert res2 is not None
        assert res2.token != res.token


@pytest.mark.asyncio
async def test_openai_non_stream_finalize_and_release(shared_db):
    """OpenAI non-stream completes and finalizes on success, releases on failure."""
    engine, session_factory, _ = shared_db

    async with session_factory() as session:
        user = User(id=6, email="nonstream@test.com", password_hash="hash")
        raw, prefix, digest = generate_api_key()
        key = APIKey(id=6, user_id=6, name="ns-key", key_prefix=prefix, key_hash=digest, daily_limit=1)
        session.add(user)
        session.add(key)
        await session.commit()

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with patch("app.db.database.SessionLocal", session_factory), patch("app.api.openai.get_adapter") as mock_get:
            # First: test failure releases reservation
            async def failing_run(*args, **kwargs):
                raise RuntimeError("Harness crashed")

            mock_get.return_value.run = failing_run
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                headers = {"Authorization": f"Bearer {raw}"}
                payload = {"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi"}]}

                resp_fail = await client.post("/v1/chat/completions", headers=headers, json=payload)
                assert resp_fail.status_code == 502

                # Verify reservation was released (0 reservations in DB)
                async with session_factory() as session:
                    active_res = await session.scalar(
                        select(func.count()).select_from(QuotaReservation).where(QuotaReservation.api_key_id == 6)
                    )
                    assert active_res == 0

                # Second: test successful request succeeds and finalizes
                async def ok_run(*args, **kwargs):
                    return HarnessResult(text="all good", model="default")

                mock_get.return_value.run = ok_run
                resp_ok = await client.post("/v1/chat/completions", headers=headers, json=payload)
                assert resp_ok.status_code == 200

                async with session_factory() as session:
                    active_res = await session.scalar(
                        select(func.count()).select_from(QuotaReservation).where(QuotaReservation.api_key_id == 6)
                    )
                    assert active_res == 0
                    usage_cnt = await session.scalar(
                        select(func.count()).select_from(UsageRecord).where(UsageRecord.api_key_id == 6)
                    )
                    assert usage_cnt == 1

                # Third: limit=1 now exceeded
                resp_429 = await client.post("/v1/chat/completions", headers=headers, json=payload)
                assert resp_429.status_code == 429
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_openai_stream_finalize_and_release(shared_db):
    """OpenAI stream finalizes on successful stream and releases on error."""
    engine, session_factory, _ = shared_db

    async with session_factory() as session:
        user = User(id=7, email="stream_user@test.com", password_hash="hash")
        raw, prefix, digest = generate_api_key()
        key = APIKey(id=7, user_id=7, name="st-key", key_prefix=prefix, key_hash=digest, daily_limit=1)
        session.add(user)
        session.add(key)
        await session.commit()

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with patch("app.db.database.SessionLocal", session_factory), patch("app.api.openai.get_adapter") as mock_get:
            # Case 1: Stream failure releases reservation
            async def failing_stream(*args, **kwargs):
                raise RuntimeError("stream harness error")
                yield "never", {}

            mock_get.return_value.stream = failing_stream
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                headers = {"Authorization": f"Bearer {raw}"}
                payload = {
                    "model": "opencode//opencode/big-pickle",
                    "messages": [{"role": "user", "content": "hi"}],
                    "stream": True,
                }

                resp = await client.post("/v1/chat/completions", headers=headers, json=payload)
                assert resp.status_code == 200
                content = resp.text
                assert "error" in content or "cancelled" in content

                # Reservation released
                async with session_factory() as session:
                    res_cnt = await session.scalar(
                        select(func.count()).select_from(QuotaReservation).where(QuotaReservation.api_key_id == 7)
                    )
                    assert res_cnt == 0

                # Case 2: Successful stream finalizes reservation and records usage
                async def ok_stream(*args, **kwargs):
                    yield "chunk1 ", {}
                    yield "chunk2", {}

                mock_get.return_value.stream = ok_stream
                resp_ok = await client.post("/v1/chat/completions", headers=headers, json=payload)
                assert resp_ok.status_code == 200
                content_ok = resp_ok.text
                assert "[DONE]" in content_ok

                async with session_factory() as session:
                    res_cnt = await session.scalar(
                        select(func.count()).select_from(QuotaReservation).where(QuotaReservation.api_key_id == 7)
                    )
                    assert res_cnt == 0
                    usage_cnt = await session.scalar(
                        select(func.count()).select_from(UsageRecord).where(UsageRecord.api_key_id == 7)
                    )
                    assert usage_cnt == 1

                # Third request blocked by daily_limit=1
                resp_blocked = await client.post("/v1/chat/completions", headers=headers, json=payload)
                assert resp_blocked.status_code == 429
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_finalization_failure_prevents_sse_done_event(shared_db):
    """If quota finalization fails in streaming, [DONE] event is never emitted and error is sent."""
    _, session_factory, _ = shared_db

    async with session_factory() as session:
        user = User(id=89, email="fail_stream@test.com", password_hash="hash")
        raw, prefix, digest = generate_api_key()
        key = APIKey(id=89, user_id=89, name="fail-stream-key", key_prefix=prefix, key_hash=digest, daily_limit=5)
        session.add(user)
        session.add(key)
        await session.commit()

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with patch("app.db.database.SessionLocal", session_factory), \
             patch("app.api.openai.get_adapter") as mock_get, \
             patch("app.services.quota_service.finalize_reservation", return_value=None):
            async def ok_stream(*args, **kwargs):
                yield "hello world", {}

            mock_get.return_value.stream = ok_stream
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                headers = {"Authorization": f"Bearer {raw}"}
                payload = {
                    "model": "opencode//opencode/big-pickle",
                    "messages": [{"role": "user", "content": "hi"}],
                    "stream": True,
                }
                resp = await client.post("/v1/chat/completions", headers=headers, json=payload)
                assert resp.status_code == 200
                text = resp.text
                # [DONE] MUST NOT be present!
                assert "[DONE]" not in text, f"Expected [DONE] to not be present, got: {text}"
                assert "quota_finalization_failed" in text

                # Verify reservation was NOT released and remains active
                async with session_factory() as session:
                    active_res = await session.scalar(
                        select(func.count()).select_from(QuotaReservation).where(QuotaReservation.api_key_id == 89)
                    )
                    assert active_res == 1, "Reservation must remain active on finalization failure to fail closed"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_dashboard_chat_records_api_key_id_and_conversation_does_not_consume(shared_db):
    """Dashboard chat with an API key records api_key_id; conversation creation does not consume quota."""
    engine, session_factory, _ = shared_db

    async with session_factory() as session:
        user = User(id=8, email="dash@test.com", password_hash=hash_password("Pass123!"), role="user")
        raw, prefix, digest = generate_api_key()
        key = APIKey(id=8, user_id=8, name="dash-key", key_prefix=prefix, key_hash=digest, daily_limit=1)
        session.add(user)
        session.add(key)
        await session.commit()

    jwt_token = create_access_token(str(8))

    async def override_get_db():
        async with session_factory() as session:
            yield session

    async def fake_run(*args, **kwargs):
        return HarnessResult(text="reply from dash", model="default")

    app.dependency_overrides[get_db] = override_get_db
    try:
        with patch("app.db.database.SessionLocal", session_factory), patch("app.api.chat.get_adapter") as mock_get:
            mock_get.return_value.run = fake_run
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                headers = {
                    "Authorization": f"Bearer {jwt_token}",
                    "X-API-Key": raw,
                }

                # 1. Create conversation with API key header: must NOT consume quota
                conv_resp = await client.post(
                    "/api/chat/conversations",
                    headers=headers,
                    json={"model": "opencode//opencode/big-pickle", "title": "Test Chat"},
                )
                assert conv_resp.status_code == 200
                conv_id = conv_resp.json()["id"]

                async with session_factory() as session:
                    res_cnt = await session.scalar(select(func.count()).select_from(QuotaReservation))
                    usage_cnt = await session.scalar(select(func.count()).select_from(UsageRecord))
                    assert res_cnt == 0, "Conversation creation should not create reservations"
                    assert usage_cnt == 0, "Conversation creation should not record usage"

                # 2. Send message with API key: must record api_key_id in usage record
                msg_resp = await client.post(
                    f"/api/chat/conversations/{conv_id}/messages",
                    headers=headers,
                    json={"content": "hello from dashboard", "model": "opencode//opencode/big-pickle"},
                )
                assert msg_resp.status_code == 200

                async with session_factory() as session:
                    # Reservation finalized (removed)
                    res_cnt = await session.scalar(select(func.count()).select_from(QuotaReservation))
                    assert res_cnt == 0
                    # Usage record created with api_key_id == 8
                    usage = (
                        await session.execute(
                            select(UsageRecord).where(UsageRecord.user_id == 8)
                        )
                    ).scalar_one_or_none()
                    assert usage is not None
                    assert usage.api_key_id == 8, f"Expected api_key_id=8, got {usage.api_key_id}"

                # 3. Next message exceeds daily_limit=1 -> 429
                msg_resp_blocked = await client.post(
                    f"/api/chat/conversations/{conv_id}/messages",
                    headers=headers,
                    json={"content": "another message", "model": "opencode//opencode/big-pickle"},
                )
                assert msg_resp_blocked.status_code == 429
                assert msg_resp_blocked.json()["error"]["code"] == "quota_exceeded"

                # 4. JWT-only calls remain unrestricted
                jwt_only_headers = {"Authorization": f"Bearer {jwt_token}"}
                msg_jwt_ok = await client.post(
                    f"/api/chat/conversations/{conv_id}/messages",
                    headers=jwt_only_headers,
                    json={"content": "jwt message", "model": "opencode//opencode/big-pickle"},
                )
                assert msg_jwt_ok.status_code == 200
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_cross_user_dashboard_api_key_rejected_with_403(shared_db):
    """An API key belonging to another user must be rejected with 403 on conversation creation and message paths."""
    _, session_factory, _ = shared_db

    async with session_factory() as session:
        user_a = User(id=10, email="user_a@test.com", password_hash=hash_password("PassA123!"), role="user")
        user_b = User(id=11, email="user_b@test.com", password_hash=hash_password("PassB123!"), role="user")
        raw_b, prefix_b, digest_b = generate_api_key()
        key_b = APIKey(id=11, user_id=11, name="key-b", key_prefix=prefix_b, key_hash=digest_b, daily_limit=5)
        session.add(user_a)
        session.add(user_b)
        session.add(key_b)
        await session.commit()

    token_a = create_access_token(str(10))

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with patch("app.db.database.SessionLocal", session_factory):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                headers = {
                    "Authorization": f"Bearer {token_a}",
                    "X-API-Key": raw_b,  # Key B sent by User A!
                }

                # 1. Conversation creation rejected with 403
                conv_resp = await client.post(
                    "/api/chat/conversations",
                    headers=headers,
                    json={"title": "Cross User Test", "model": "opencode//opencode/big-pickle"},
                )
                assert conv_resp.status_code == 403
                assert conv_resp.json()["error"]["code"] == "forbidden"

                # Create valid conversation for User A without X-API-Key
                valid_conv_resp = await client.post(
                    "/api/chat/conversations",
                    headers={"Authorization": f"Bearer {token_a}"},
                    json={"title": "User A Chat", "model": "opencode//opencode/big-pickle"},
                )
                assert valid_conv_resp.status_code == 200
                conv_id = valid_conv_resp.json()["id"]

                # 2. Non-stream message rejected with 403
                msg_resp = await client.post(
                    f"/api/chat/conversations/{conv_id}/messages",
                    headers=headers,
                    json={"content": "hello", "model": "opencode//opencode/big-pickle"},
                )
                assert msg_resp.status_code == 403
                assert msg_resp.json()["error"]["code"] == "forbidden"

                # 3. Stream message rejected with 403
                stream_resp = await client.post(
                    f"/api/chat/conversations/{conv_id}/messages/stream",
                    headers=headers,
                    json={"content": "hello stream", "model": "opencode//opencode/big-pickle"},
                )
                assert stream_resp.status_code == 403
                assert stream_resp.json()["error"]["code"] == "forbidden"

                # Verify User B was never charged
                async with session_factory() as session:
                    b_usage = await session.scalar(
                        select(func.count()).select_from(UsageRecord).where(UsageRecord.api_key_id == 11)
                    )
                    assert b_usage == 0
                    b_res = await session.scalar(
                        select(func.count()).select_from(QuotaReservation).where(QuotaReservation.api_key_id == 11)
                    )
                    assert b_res == 0
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_api_key_finalization_failure_leaves_reservation_active_openai_non_stream(shared_db):
    """An API-key OpenAI non-stream finalization failure fails with 500, does not report success, and leaves reservation active."""
    _, session_factory, _ = shared_db

    async with session_factory() as session:
        user = User(id=91, email="fail_nonstream@test.com", password_hash="hash")
        raw, prefix, digest = generate_api_key()
        key = APIKey(id=91, user_id=91, name="fail-nonstream-key", key_prefix=prefix, key_hash=digest, daily_limit=5)
        session.add(user)
        session.add(key)
        await session.commit()

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with patch("app.db.database.SessionLocal", session_factory), \
             patch("app.api.openai.get_adapter") as mock_get, \
             patch("app.services.quota_service.finalize_reservation", return_value=None):
            async def ok_run(*args, **kwargs):
                return HarnessResult(text="completed successfully", model="default")

            mock_get.return_value.run = ok_run
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                headers = {"Authorization": f"Bearer {raw}"}
                payload = {
                    "model": "opencode//opencode/big-pickle",
                    "messages": [{"role": "user", "content": "hi"}],
                    "stream": False,
                }
                resp = await client.post("/v1/chat/completions", headers=headers, json=payload)
                assert resp.status_code == 500
                data = resp.json()
                assert data["error"]["code"] == "quota_finalization_failed"

                # Proves: active reservation is NOT deleted/released on finalization failure (fails closed)
                async with session_factory() as session:
                    res_cnt = await session.scalar(
                        select(func.count()).select_from(QuotaReservation).where(QuotaReservation.api_key_id == 91)
                    )
                    assert res_cnt == 1, "Reservation must remain active until TTL expiry"
                    usage_cnt = await session.scalar(
                        select(func.count()).select_from(UsageRecord).where(UsageRecord.api_key_id == 91)
                    )
                    assert usage_cnt == 0
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_api_key_finalization_failure_leaves_reservation_active_dashboard_stream_and_non_stream(shared_db):
    """An API-key dashboard stream and non-stream finalization failure does not release reservation and fails closed."""
    _, session_factory, _ = shared_db

    async with session_factory() as session:
        user = User(id=92, email="fail_dash@test.com", password_hash=hash_password("Pass123!"), role="user")
        raw, prefix, digest = generate_api_key()
        key = APIKey(id=92, user_id=92, name="fail-dash-key", key_prefix=prefix, key_hash=digest, daily_limit=5)
        conv1 = Conversation(id=921, user_id=92, title="Chat 1", model="opencode//opencode/big-pickle")
        conv2 = Conversation(id=922, user_id=92, title="Chat 2", model="opencode//opencode/big-pickle")
        session.add(user)
        session.add(key)
        session.add(conv1)
        session.add(conv2)
        await session.commit()

    jwt_token = create_access_token(str(92))

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with patch("app.db.database.SessionLocal", session_factory), \
             patch("app.api.chat.get_adapter") as mock_get, \
             patch("app.services.quota_service.finalize_reservation", return_value=None):
            # 1. Non-stream dashboard test
            async def ok_run(*args, **kwargs):
                return HarnessResult(text="dash reply", model="default")

            mock_get.return_value.run = ok_run
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                headers = {"Authorization": f"Bearer {jwt_token}", "X-API-Key": raw}
                resp_nonstream = await client.post(
                    f"/api/chat/conversations/{conv1.id}/messages",
                    headers=headers,
                    json={"content": "hello", "model": "opencode//opencode/big-pickle"},
                )
                assert resp_nonstream.status_code == 500
                assert resp_nonstream.json()["error"]["code"] == "quota_finalization_failed"

                # Verify reservation remains active
                async with session_factory() as session:
                    res_cnt = await session.scalar(
                        select(func.count()).select_from(QuotaReservation).where(QuotaReservation.api_key_id == 92)
                    )
                    assert res_cnt == 1, "Non-stream finalization failure must leave reservation active"

                # 2. Stream dashboard test
                async def ok_stream(*args, **kwargs):
                    yield "stream chunk", {}

                mock_get.return_value.stream = ok_stream
                resp_stream = await client.post(
                    f"/api/chat/conversations/{conv2.id}/messages/stream",
                    headers=headers,
                    json={"content": "stream test", "model": "opencode//opencode/big-pickle"},
                )
                assert resp_stream.status_code == 200
                text = resp_stream.text
                assert "[DONE]" not in text, f"Expected [DONE] to not be present, got: {text}"
                assert "quota_finalization_failed" in text

                # Verify both reservations remain active
                async with session_factory() as session:
                    res_cnt = await session.scalar(
                        select(func.count()).select_from(QuotaReservation).where(QuotaReservation.api_key_id == 92)
                    )
                    assert res_cnt == 2, "Stream finalization failure must leave reservation active"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_jwt_only_finalization_failure_does_not_report_success_or_done(shared_db):
    """Proves a JWT-only finalization failure fails closed and never reports success or emits [DONE]."""
    _, session_factory, _ = shared_db

    async with session_factory() as session:
        user = User(id=93, email="jwt_fail@test.com", password_hash=hash_password("Pass123!"), role="user")
        conv = Conversation(id=930, user_id=93, title="JWT Fail Test", model="opencode//opencode/big-pickle")
        session.add(user)
        session.add(conv)
        await session.commit()

    jwt_token = create_access_token(str(93))

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with patch("app.db.database.SessionLocal", session_factory), \
             patch("app.api.openai.get_adapter") as mock_openai_get, \
             patch("app.api.chat.get_adapter") as mock_chat_get, \
             patch("app.services.quota_service.finalize_reservation", return_value=None):

            async def ok_run(*args, **kwargs):
                return HarnessResult(text="response text", model="default")

            async def ok_stream(*args, **kwargs):
                yield "stream token", {}

            mock_openai_get.return_value.run = ok_run
            mock_openai_get.return_value.stream = ok_stream
            mock_chat_get.return_value.run = ok_run
            mock_chat_get.return_value.stream = ok_stream

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                jwt_headers = {"Authorization": f"Bearer {jwt_token}"}

                # 1. OpenAI non-stream with JWT only
                resp_oa_nonstream = await client.post(
                    "/v1/chat/completions",
                    headers=jwt_headers,
                    json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi"}], "stream": False},
                )
                assert resp_oa_nonstream.status_code == 500
                assert resp_oa_nonstream.json()["error"]["code"] == "quota_finalization_failed"

                # 2. OpenAI stream with JWT only
                resp_oa_stream = await client.post(
                    "/v1/chat/completions",
                    headers=jwt_headers,
                    json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi"}], "stream": True},
                )
                assert resp_oa_stream.status_code == 200
                oa_stream_text = resp_oa_stream.text
                assert "[DONE]" not in oa_stream_text, f"Expected [DONE] to not be present, got: {oa_stream_text}"
                assert "quota_finalization_failed" in oa_stream_text

                # 3. Dashboard non-stream with JWT only
                resp_dash_nonstream = await client.post(
                    f"/api/chat/conversations/{conv.id}/messages",
                    headers=jwt_headers,
                    json={"content": "dash jwt nonstream", "model": "opencode//opencode/big-pickle"},
                )
                assert resp_dash_nonstream.status_code == 500
                assert resp_dash_nonstream.json()["error"]["code"] == "quota_finalization_failed"

                # 4. Dashboard stream with JWT only
                resp_dash_stream = await client.post(
                    f"/api/chat/conversations/{conv.id}/messages/stream",
                    headers=jwt_headers,
                    json={"content": "dash jwt stream", "model": "opencode//opencode/big-pickle"},
                )
                assert resp_dash_stream.status_code == 200
                dash_stream_text = resp_dash_stream.text
                assert "[DONE]" not in dash_stream_text, f"Expected [DONE] to not be present, got: {dash_stream_text}"
                assert "quota_finalization_failed" in dash_stream_text
    finally:
        app.dependency_overrides.pop(get_db, None)
