import pytest
from pydantic import SecretStr

from app.core.config import settings


@pytest.mark.asyncio
async def test_project_update_requires_administrator(client, user_headers):
    response = await client.post("/api/admin/project/update", headers=user_headers)

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_issue_submission_requires_dashboard_authentication(client):
    response = await client.post(
        "/api/admin/project/issues",
        json={"title": "Update fails", "body": "The update fails after confirmation."},
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_issue_submission_rejects_blank_content(client, admin_headers):
    response = await client.post(
        "/api/admin/project/issues",
        headers=admin_headers,
        json={"title": "   ", "body": "          "},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_issue_submission_reports_missing_server_token(client, admin_headers, monkeypatch):
    monkeypatch.setattr(settings, "github_issues_token", SecretStr(""))
    response = await client.post(
        "/api/admin/project/issues",
        headers=admin_headers,
        json={"title": "Update fails", "body": "The update fails after confirmation."},
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "issue_reporting_unavailable"
