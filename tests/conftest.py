import asyncio
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.security import create_access_token, hash_password
from app.db.database import Base, User, get_db
from app.main import app


@pytest_asyncio.fixture
async def test_engine():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    Session = async_sessionmaker(test_engine, expire_on_commit=False)
    async with Session() as session:
        yield session
        await session.rollback()


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    from app.middleware.rate_limit import global_rate_limiter

    global_rate_limiter.reset()
    yield
    global_rate_limiter.reset()


@pytest.fixture(autouse=True)
def reset_process_registry():
    from app.services.process_registry import process_registry

    process_registry.clear()
    yield
    process_registry.clear()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession, test_engine):
    async def override_get_db():
        yield db_session

    # Patch background SessionLocal used by streaming endpoints to use the test engine
    from unittest.mock import patch

    TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False)
    with patch("app.db.database.SessionLocal", TestSessionLocal):
        app.dependency_overrides[get_db] = override_get_db
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
        app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def admin_user(db_session: AsyncSession) -> User:
    user = User(email="admin@test.com", password_hash=hash_password("AdminPass123!"), display_name="Admin", role="admin")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def regular_user(db_session: AsyncSession) -> User:
    user = User(email="user@test.com", password_hash=hash_password("UserPass123!"), display_name="User", role="user")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def admin_headers(admin_user: User) -> dict:
    token = create_access_token(str(admin_user.id))
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def user_headers(regular_user: User) -> dict:
    token = create_access_token(str(regular_user.id))
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def api_key_headers(db_session: AsyncSession, regular_user: User) -> tuple[dict, str]:
    from app.core.security import generate_api_key
    from app.db.database import APIKey

    raw, prefix, digest = generate_api_key()
    key = APIKey(user_id=regular_user.id, name="test-key", key_prefix=prefix, key_hash=digest)
    db_session.add(key)
    await db_session.commit()
    return {"Authorization": f"Bearer {raw}"}, raw


class FakeAdapter:
    def __init__(self, name="opencode", display_name="OpenCode", text="fake response"):
        self.name = name
        self.display_name = display_name
        self.executable = "fake"
        self.provider = "fake"
        self._text = text

    def is_installed(self) -> bool:
        return True

    async def list_models(self):
        from app.models.harness import HarnessModel

        return [HarnessModel(id=f"{self.name}//fake-model", harness=self.name, provider=None, name="fake-model")]

    def build_command(self, prompt, model=None, session_id=None):
        return ["echo", prompt]

    def parse_line(self, line, model):
        return line, {}

    def parse_output(self, output, model):
        return output.decode(errors="replace").strip()

    async def run(self, prompt, model=None, session_id=None, env=None, request_id=None):
        from app.models.harness import HarnessResult

        return HarnessResult(text=self._text, model=model or "default")

    async def stream(self, prompt, model=None, session_id=None, env=None, request_id=None):
        for chunk in ["fake ", "response"]:
            yield chunk, {}


@pytest.fixture
def fake_adapter():
    return FakeAdapter()
