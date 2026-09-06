"""Leaf time helper — naive UTC now for DB compatibility (no app imports)."""

from __future__ import annotations

from datetime import datetime, timezone


def utcnow() -> datetime:
    """Return naive UTC datetime (compatible with existing SQLite naive columns).

    Uses timezone-aware source then strips tzinfo to keep DB values identical
    to previous ``datetime.utcnow()`` without deprecation warning.
    """

    return datetime.now(timezone.utc).replace(tzinfo=None)


def utcnow_aware() -> datetime:
    """Aware UTC datetime for logs/metrics where tz is desirable."""

    return datetime.now(timezone.utc)
