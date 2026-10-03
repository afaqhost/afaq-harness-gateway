import asyncio
from pathlib import Path
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import AsyncAdaptedQueuePool

from app.clients.registry import MODEL_CACHE
from app.core.security import generate_api_key
from app.db.database import APIKey, Base, User, get_db
from app.main import app
from app.models.harness import HarnessModel, HarnessResult
from app.services import quota_service

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
async def queue_pool_db(tmp_path: Path):
    """Engine using AsyncAdaptedQueuePool to explicitly monitor connection checkouts and checkins."""
    db_path = str(tmp_path / "test_pool.db")
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_path}",
        poolclass=AsyncAdaptedQueuePool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    quota_service.set_session_factory(session_factory)

    raw, prefix, digest = generate_api_key()
    async with session_factory() as session:
        user = User(id=1, email="pool_test@test.com", password_hash="hash")
        key = APIKey(id=1, user_id=1, name="pool-key", key_prefix=prefix, key_hash=digest, daily_limit=100)
        session.add_all([user, key])
        await session.commit()

    yield engine, session_factory, raw

    quota_service.set_session_factory(None)
    # Ensure zero checked-out connections at fixture teardown
    assert engine.sync_engine.pool.checkedout() == 0
    await engine.dispose()


@pytest.mark.asyncio
async def test_zero_checked_out_connections_after_non_streaming_request(queue_pool_db):
    """Proves non-streaming requests return their connection to the pool immediately upon completion."""
    engine, session_factory, raw = queue_pool_db

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with patch("app.db.database.SessionLocal", session_factory), patch("app.api.openai.get_adapter") as mock_get:
            async def fake_run(*args, **kwargs):
                return HarnessResult(text="response text", model="default")

            mock_get.return_value.run = fake_run
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                headers = {"Authorization": f"Bearer {raw}"}
                payload = {
                    "model": "opencode//opencode/big-pickle",
                    "messages": [{"role": "user", "content": "hello"}],
                }
                resp = await client.post("/v1/chat/completions", headers=headers, json=payload)
                assert resp.status_code == 200

            # Connection must be fully returned to pool
            assert engine.sync_engine.pool.checkedout() == 0
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_zero_checked_out_connections_after_streaming_request(queue_pool_db):
    """Proves streaming requests deterministically return all connections to pool after stream finishes."""
    engine, session_factory, raw = queue_pool_db

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with patch("app.db.database.SessionLocal", session_factory), patch("app.api.openai.get_adapter") as mock_get:
            async def fake_stream(*args, **kwargs):
                yield "chunk1 ", {}
                await asyncio.sleep(0.01)
                yield "chunk2", {}

            mock_get.return_value.stream = fake_stream
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                headers = {"Authorization": f"Bearer {raw}"}
                payload = {
                    "model": "opencode//opencode/big-pickle",
                    "messages": [{"role": "user", "content": "hello"}],
                    "stream": True,
                }
                resp = await client.post("/v1/chat/completions", headers=headers, json=payload)
                assert resp.status_code == 200
                assert "[DONE]" in resp.text

            # Connection must be fully returned to pool
            assert engine.sync_engine.pool.checkedout() == 0
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_zero_checked_out_connections_after_aborted_streaming_request(queue_pool_db):
    """Proves early client abort during streaming returns all connections to pool cleanly."""
    engine, session_factory, raw = queue_pool_db

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with patch("app.db.database.SessionLocal", session_factory), patch("app.api.openai.get_adapter") as mock_get:
            async def fake_stream(*args, **kwargs):
                yield "chunk1 ", {}
                await asyncio.sleep(0.05)
                yield "chunk2", {}

            mock_get.return_value.stream = fake_stream
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                headers = {"Authorization": f"Bearer {raw}"}
                payload = {
                    "model": "opencode//opencode/big-pickle",
                    "messages": [{"role": "user", "content": "hello"}],
                    "stream": True,
                }
                async with client.stream("POST", "/v1/chat/completions", headers=headers, json=payload) as resp:
                    async for chunk in resp.aiter_lines():
                        if "chunk1" in chunk:
                            break  # Early abort by client

            # Connection must be fully returned to pool even after abort
            assert engine.sync_engine.pool.checkedout() == 0
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_zero_checked_out_connections_after_streaming_error(queue_pool_db):
    """Proves harness error during streaming releases connection back to pool."""
    engine, session_factory, raw = queue_pool_db

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with patch("app.db.database.SessionLocal", session_factory), patch("app.api.openai.get_adapter") as mock_get:
            async def failing_stream(*args, **kwargs):
                raise RuntimeError("harness failed mid-stream")
                yield "never", {}

            mock_get.return_value.stream = failing_stream
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                headers = {"Authorization": f"Bearer {raw}"}
                payload = {
                    "model": "opencode//opencode/big-pickle",
                    "messages": [{"role": "user", "content": "hello"}],
                    "stream": True,
                }
                resp = await client.post("/v1/chat/completions", headers=headers, json=payload)
                assert resp.status_code == 200
                assert "error" in resp.text or "cancelled" in resp.text

            # Connection must be fully returned to pool
            assert engine.sync_engine.pool.checkedout() == 0
    finally:
        app.dependency_overrides.pop(get_db, None)
