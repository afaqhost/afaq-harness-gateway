import pytest
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.clients import registry
from app.db.database import Harness
from app.services.model_refresh_service import refresh_models

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
@pytest.mark.parametrize("adapter_count", [0, 1, 4])
async def test_refresh_synchronizes_harnesses_with_one_lookup(
    test_engine, db_session, fake_adapter, monkeypatch, adapter_count
):
    existing = Harness(
        name="adapter-0", display_name="Old name", executable="custom-command", provider="custom-provider",
        enabled=False, authenticated=True, config={"operator_setting": True}, installed=False,
    )
    unrelated = Harness(name="unrelated", display_name="Unrelated", executable="other", installed=True)
    db_session.add_all([existing, unrelated])
    await db_session.commit()
    adapters = {
        f"adapter-{index}": type(fake_adapter)(name=f"adapter-{index}", display_name=f"Adapter {index}")
        for index in range(adapter_count)
    }
    if adapter_count > 1:
        monkeypatch.setattr(adapters["adapter-1"], "is_installed", lambda: False)
    monkeypatch.setattr(registry, "ADAPTERS", adapters)
    monkeypatch.setattr(registry, "MODEL_CACHE", {})
    monkeypatch.setattr("app.db.database.SessionLocal", async_sessionmaker(test_engine, expire_on_commit=False))
    lookups = []

    def count_harness_lookups(conn, cursor, statement, parameters, context, executemany):
        normalized = " ".join(statement.lower().split())
        if normalized.startswith("select ") and "from harnesses" in normalized:
            lookups.append(statement)

    event.listen(test_engine.sync_engine, "before_cursor_execute", count_harness_lookups)
    try:
        await refresh_models()
    finally:
        event.remove(test_engine.sync_engine, "before_cursor_execute", count_harness_lookups)

    assert len(lookups) == (1 if adapter_count else 0)
    db_session.expire_all()
    rows = {row.name: row for row in (await db_session.scalars(select(Harness))).all()}
    assert set(rows) == {"adapter-0", "unrelated"} | set(adapters)
    assert rows["unrelated"].installed is True
    assert rows["unrelated"].last_checked_at is None
    assert rows["adapter-0"].executable == "custom-command"
    assert rows["adapter-0"].provider == "custom-provider"
    assert rows["adapter-0"].enabled is False
    assert rows["adapter-0"].authenticated is True
    assert rows["adapter-0"].config == {"operator_setting": True}
    for name, adapter in adapters.items():
        row = rows[name]
        assert row.display_name == adapter.display_name
        assert row.installed is (name != "adapter-1")
        assert row.last_checked_at is not None
        if name != "adapter-0":
            assert row.executable == adapter.executable
            assert row.provider == adapter.provider
