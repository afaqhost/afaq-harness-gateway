from dataclasses import dataclass

import httpx


class GitHubIssueError(RuntimeError):
    pass


class GitHubIssueAuthenticationError(GitHubIssueError):
    pass


@dataclass(frozen=True)
class CreatedIssue:
    number: int
    url: str


class GitHubIssuesClient:
    def __init__(
        self,
        repository: str,
        token: str,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self._repository = repository
        self._token = token
        self._transport = transport

    async def create_issue(self, title: str, body: str) -> CreatedIssue:
        try:
            response = await self._post_issue(title, body)
        except httpx.RequestError as exc:
            raise GitHubIssueError("Could not reach GitHub") from exc
        if response.status_code in (401, 403, 404):
            raise GitHubIssueAuthenticationError("GitHub issue reporting credentials were rejected")
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise GitHubIssueError("GitHub rejected the issue submission") from exc
        return _created_issue(response)

    async def _post_issue(self, title: str, body: str) -> httpx.Response:
        headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {self._token}",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        async with httpx.AsyncClient(
            base_url="https://api.github.com",
            timeout=15.0,
            transport=self._transport,
        ) as http_client:
            return await http_client.post(
                f"/repos/{self._repository}/issues",
                headers=headers,
                json={"title": title, "body": body},
            )


def _created_issue(response: httpx.Response) -> CreatedIssue:
    try:
        payload = response.json()
    except ValueError as exc:
        raise GitHubIssueError("GitHub returned an invalid issue response") from exc
    if not isinstance(payload.get("number"), int) or not isinstance(payload.get("html_url"), str):
        raise GitHubIssueError("GitHub returned an invalid issue response")
    return CreatedIssue(number=payload["number"], url=payload["html_url"])
