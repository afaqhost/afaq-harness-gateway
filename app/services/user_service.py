from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.db.database import User
from app.repositories import auth_repository


class UserNotFoundError(Exception):
    pass


class UserConflictError(Exception):
    pass


@dataclass(frozen=True)
class NewUser:
    email: str
    password: str
    display_name: str
    role: str


@dataclass(frozen=True)
class UserChanges:
    email: str | None = None
    password: str | None = None
    display_name: str | None = None
    role: str | None = None
    is_active: bool | None = None


async def create_user(db: AsyncSession, request: NewUser) -> User:
    email = request.email.strip().lower()
    if await auth_repository.get_user_by_email(db, email):
        raise UserConflictError("Email already exists")
    user = User(
        email=email,
        password_hash=hash_password(request.password),
        display_name=request.display_name.strip(),
        role=request.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def list_users(db: AsyncSession) -> list[User]:
    return await auth_repository.list_users(db)


async def update_user(
    db: AsyncSession,
    actor: User,
    user_id: int,
    changes: UserChanges,
) -> User:
    target = await auth_repository.get_user_by_id(db, user_id)
    if not target:
        raise UserNotFoundError("User not found")
    await _validate_account_safety(db, actor, target, changes)
    await _apply_unique_email(db, target, changes.email)
    _apply_user_changes(target, changes)
    await db.commit()
    await db.refresh(target)
    return target


async def delete_user(db: AsyncSession, actor: User, user_id: int) -> None:
    target = await auth_repository.get_user_by_id(db, user_id)
    if not target:
        raise UserNotFoundError("User not found")
    if target.id == actor.id:
        raise UserConflictError("You cannot delete your own account")
    await auth_repository.delete_user_and_owned_data(db, target)
    await db.commit()


async def _validate_account_safety(
    db: AsyncSession,
    actor: User,
    target: User,
    changes: UserChanges,
) -> None:
    removes_access = changes.is_active is False or (
        changes.role is not None and changes.role != "admin"
    )
    if target.id == actor.id and removes_access:
        raise UserConflictError("You cannot disable or demote your own account")
    if target.role == "admin" and target.is_active and removes_access:
        if await auth_repository.count_active_admins(db) <= 1:
            raise UserConflictError("At least one active administrator is required")


async def _apply_unique_email(
    db: AsyncSession,
    target: User,
    requested_email: str | None,
) -> None:
    if requested_email is None:
        return
    normalized_email = requested_email.strip().lower()
    existing = await auth_repository.get_user_by_email(db, normalized_email)
    if existing and existing.id != target.id:
        raise UserConflictError("Email already exists")
    target.email = normalized_email


def _apply_user_changes(target: User, changes: UserChanges) -> None:
    if changes.password is not None:
        target.password_hash = hash_password(changes.password)
    if changes.display_name is not None:
        target.display_name = changes.display_name.strip()
    if changes.role is not None:
        target.role = changes.role
    if changes.is_active is not None:
        target.is_active = changes.is_active
