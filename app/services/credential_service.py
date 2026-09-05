"""Credential profile service — encrypt/decrypt and env mapping."""

from __future__ import annotations

import logging
import os
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decrypt_secret, encrypt_secret
from app.db.database import CredentialProfile

logger = logging.getLogger("afaq")

# mapping harness -> env var name that carries its token
HARNESS_ENV_MAP: dict[str, str] = {
    "claude": "ANTHROPIC_API_KEY",
    "codex": "OPENAI_API_KEY",
    "opencode": "OPENAI_API_KEY",
    "commandcode": "COMMAND_CODE_TOKEN",
    # generic fallbacks
    "generic": "API_TOKEN",
}

# also support explicit env var via provider? For now use map above


async def create_profile(
    db: AsyncSession,
    user_id: int,
    harness: str,
    profile_name: str,
    auth_type: str,
    raw_token: str | None,
) -> CredentialProfile:
    enc = encrypt_secret(raw_token) if raw_token else None
    profile = CredentialProfile(
        user_id=user_id,
        harness=harness,
        profile_name=profile_name,
        auth_type=auth_type,
        encrypted_token=enc,
        status="unknown",
    )
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    return profile


async def get_profile(db: AsyncSession, profile_id: int, user_id: int) -> CredentialProfile | None:
    prof = await db.get(CredentialProfile, profile_id)
    if prof and prof.user_id == user_id:
        return prof
    return None


async def list_profiles(db: AsyncSession, user_id: int) -> list[CredentialProfile]:
    result = await db.execute(select(CredentialProfile).where(CredentialProfile.user_id == user_id).order_by(CredentialProfile.harness, CredentialProfile.profile_name))
    return list(result.scalars().all())


async def delete_profile(db: AsyncSession, profile: CredentialProfile) -> None:
    await db.delete(profile)
    await db.commit()


async def get_env_for_harness(db: AsyncSession, user_id: int, harness: str) -> dict[str, str]:
    """Return env dict to inject into harness subprocess.

    Looks up the default profile for harness+user (profile_name=default or first).
    If no profile or auth_type==cli, returns {}.
    """
    # try default profile first
    result = await db.execute(select(CredentialProfile).where(CredentialProfile.user_id == user_id, CredentialProfile.harness == harness).order_by(CredentialProfile.id))
    profiles = list(result.scalars().all())
    if not profiles:
        return {}
    # prefer profile_name == "default"
    chosen = next((p for p in profiles if p.profile_name == "default"), profiles[0])
    if chosen.auth_type == "cli":
        return {}
    if not chosen.encrypted_token:
        return {}
    try:
        raw = decrypt_secret(chosen.encrypted_token)
    except Exception:
        return {}
    env_key = HARNESS_ENV_MAP.get(harness, HARNESS_ENV_MAP.get("generic", "API_TOKEN"))
    # also support harness-specific overrides: e.g., if harness is "claude" we use ANTHROPIC, etc.
    # For commandcode, also set via generic
    return {env_key: raw} if raw else {}


async def update_status(db: AsyncSession, profile: CredentialProfile, status: str):
    profile.status = status
    profile.last_checked_at = datetime.utcnow()
    await db.commit()
    await db.refresh(profile)
    return profile


def get_env_var_for_harness(harness: str) -> str:
    return HARNESS_ENV_MAP.get(harness, "API_TOKEN")


async def _create_default_profile_if_missing(session: AsyncSession, admin_id: int, harness: str, raw_token: str) -> bool:
    """Create a default profile if none exists. Returns True if created."""
    existing = (
        await session.execute(
            select(CredentialProfile).where(
                CredentialProfile.user_id == admin_id,
                CredentialProfile.harness == harness,
                CredentialProfile.profile_name == "default",
            )
        )
    ).scalar_one_or_none()
    if existing:
        return False
    try:
        encrypted = encrypt_secret(raw_token)
    except Exception as exc:
        logger.warning("credential_harvest_encrypt_failed harness=%s error=%s", harness, str(exc))
        return False
    session.add(
        CredentialProfile(
            user_id=admin_id,
            harness=harness,
            profile_name="default",
            auth_type="environment",
            encrypted_token=encrypted,
            status="unknown",
        )
    )
    return True


async def harvest_env_credentials() -> int:
    """Create default CredentialProfiles from environment for the first admin.

    Best-effort startup helper: reads known env vars, creates a default
    profile per harness if the admin exists and the profile is missing.
    Returns number of profiles created. Never raises — logs and returns 0
    on DB or crypto failure so startup is not blocked.
    """
    from sqlalchemy.exc import SQLAlchemyError

    from app.db.database import SessionLocal, User

    env_harness_map: dict[str, str] = {
        "ANTHROPIC_API_KEY": "claude",
        "OPENAI_API_KEY": "opencode",
        "CODEX_API_KEY": "codex",
        "COMMAND_CODE_TOKEN": "commandcode",
        "OPENSOURCE_API_KEY": "opencode",
    }
    try:
        async with SessionLocal() as session:
            admin = (await session.execute(select(User).where(User.role == "admin").limit(1))).scalar_one_or_none()
            if not admin:
                return 0
            created = 0
            for env_var, harness in env_harness_map.items():
                raw = os.getenv(env_var)
                if not raw:
                    continue
                if await _create_default_profile_if_missing(session, admin.id, harness, raw):
                    created += 1
            if created:
                await session.commit()
            return created
    except SQLAlchemyError as exc:
        logger.warning("credential_harvest_db_failed error=%s", str(exc))
        return 0
    except Exception as exc:
        logger.warning("credential_harvest_unexpected_failed error=%s", str(exc))
        return 0
