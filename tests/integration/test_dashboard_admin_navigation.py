import pytest


@pytest.mark.asyncio
async def test_admin_navigation_is_hidden_before_role_check(client):
    response = await client.get("/chat")

    assert response.status_code == 200
    assert 'href="/users" data-page="users" data-admin-only hidden' in response.text
    assert 'href="/terminal" data-page="terminal" data-admin-only hidden' in response.text
