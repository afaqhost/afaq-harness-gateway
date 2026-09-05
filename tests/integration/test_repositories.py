import pytest
import pytest_asyncio

from app.core.security import hash_password
from app.db.database import Conversation, Message, User
from app.repositories.conversation_repository import fetch_conversation_summary, get_conversation_or_404, list_conversations_for_user
pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_get_conversation_or_404_returns_owned_conversation(db_session):
    user = User(email="owner@test.com", password_hash=hash_password("pass"), display_name="Owner")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    conv = Conversation(user_id=user.id, title="Test", model="opencode//m")
    db_session.add(conv)
    await db_session.commit()
    await db_session.refresh(conv)

    fetched = await get_conversation_or_404(conv.id, user, db_session)
    assert fetched.id == conv.id


@pytest.mark.asyncio
async def test_get_conversation_or_404_rejects_other_users_conversation(db_session, regular_user):
    # regular_user owns nothing; create conversation for another user
    other = User(email="other2@test.com", password_hash=hash_password("pass"), display_name="Other")
    db_session.add(other)
    await db_session.commit()
    await db_session.refresh(other)
    conv = Conversation(user_id=other.id, title="Other", model="opencode//m")
    db_session.add(conv)
    await db_session.commit()
    await db_session.refresh(conv)

    with pytest.raises(Exception) as ei:
        await get_conversation_or_404(conv.id, regular_user, db_session)
    assert "404" in str(ei.value) or "not found" in str(ei.value).lower()


@pytest.mark.asyncio
async def test_fetch_conversation_summary_counts_and_previews(db_session, regular_user):
    conv = Conversation(user_id=regular_user.id, title="T", model="opencode//m")
    db_session.add(conv)
    await db_session.commit()
    await db_session.refresh(conv)
    msg = Message(conversation_id=conv.id, role="user", content="hello world this is a long message that should be counted")
    db_session.add(msg)
    await db_session.commit()

    count, preview = await fetch_conversation_summary(conv, db_session)
    assert count == 1
    assert preview is not None
    assert "hello" in preview


@pytest.mark.asyncio
async def test_fetch_summary_returns_zero_when_no_messages(db_session, regular_user):
    conv = Conversation(user_id=regular_user.id, title="Empty", model="opencode//m")
    db_session.add(conv)
    await db_session.commit()
    await db_session.refresh(conv)
    count, preview = await fetch_conversation_summary(conv, db_session)
    assert count == 0
    assert preview is None


@pytest.mark.asyncio
async def test_list_conversations_ordered_by_updated_at_desc(db_session, regular_user):
    from datetime import datetime, timedelta

    now = datetime.utcnow()
    c1 = Conversation(user_id=regular_user.id, title="First", model="opencode//m", created_at=now - timedelta(hours=2), updated_at=now - timedelta(hours=2))
    c2 = Conversation(user_id=regular_user.id, title="Second", model="opencode//m", created_at=now - timedelta(hours=1), updated_at=now - timedelta(hours=1))
    db_session.add_all([c1, c2])
    await db_session.commit()

    convs = await list_conversations_for_user(regular_user, db_session)
    assert len(convs) == 2
    assert convs[0].title == "Second"
    assert convs[1].title == "First"


@pytest.mark.asyncio
async def test_conversation_cascade_deletes_messages(db_session, regular_user):
    conv = Conversation(user_id=regular_user.id, title="Cascade", model="opencode//m")
    db_session.add(conv)
    await db_session.commit()
    await db_session.refresh(conv)
    msg = Message(conversation_id=conv.id, role="user", content="hi")
    db_session.add(msg)
    await db_session.commit()

    await db_session.delete(conv)
    await db_session.commit()

    from sqlalchemy import select

    remaining = await db_session.execute(select(Message).where(Message.conversation_id == conv.id))
    assert remaining.scalars().first() is None