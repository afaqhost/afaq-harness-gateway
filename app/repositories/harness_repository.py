"""Persistence of discovered harness installation state."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import Harness


async def sync_harnesses(db: AsyncSession, discovered: list[Harness]) -> None:
    if not discovered:
        return
    query = select(Harness).where(Harness.name.in_([harness.name for harness in discovered]))
    existing = {row.name: row for row in (await db.scalars(query)).all()}
    for harness in discovered:
        row = existing.get(harness.name)
        if row is None:
            db.add(harness)
        else:
            row.installed = harness.installed
            row.last_checked_at = harness.last_checked_at
            row.display_name = harness.display_name
