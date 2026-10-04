import pytest


@pytest.mark.asyncio
async def test_project_update_requires_administrator(client, user_headers):
    response = await client.post("/api/admin/project/update", headers=user_headers)

    assert response.status_code == 403
