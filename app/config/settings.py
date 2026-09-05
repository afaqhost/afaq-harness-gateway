"""Wiring and settings — top-level composition root (re-export for correct layer placement).

New code should import from ``app.config.settings`` directly.
``app.core.config`` is kept as a backwards-compatible facade.
"""

from app.core.config import BASE_DIR, Settings, get_settings, settings

__all__ = ["BASE_DIR", "Settings", "get_settings", "settings"]
