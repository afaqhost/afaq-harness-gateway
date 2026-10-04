import json

import httpx
import pytest

from app.clients.github_issues import GitHubIssueAuthenticationError, GitHubIssuesClient


@pytest.mark.asyncio
async def test_create_issue_returns_github_issue_identity():
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/repos/afaqhost/afaq-harness-gateway/issues"
        assert request.headers["authorization"] == "Bearer test-token"
        assert json.loads(request.content) == {"title": "Broken update", "body": "Steps to reproduce"}
        return httpx.Response(201, json={"number": 42, "html_url": "https://github.com/afaqhost/afaq-harness-gateway/issues/42"})

    issue = await GitHubIssuesClient(
        "afaqhost/afaq-harness-gateway", "test-token", httpx.MockTransport(respond)
    ).create_issue("Broken update", "Steps to reproduce")

    assert issue.number == 42
    assert issue.url.endswith("/issues/42")


@pytest.mark.asyncio
async def test_rejected_github_credentials_raise_configuration_error():
    transport = httpx.MockTransport(lambda _: httpx.Response(403, json={"message": "Resource not accessible"}))
    client = GitHubIssuesClient("afaqhost/afaq-harness-gateway", "bad-token", transport)
    with pytest.raises(GitHubIssueAuthenticationError):
        await client.create_issue("Broken update", "Steps to reproduce")
