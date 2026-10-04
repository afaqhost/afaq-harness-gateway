from app.clients.github_issues import (
    CreatedIssue,
    GitHubIssueAuthenticationError,
    GitHubIssueError,
    GitHubIssuesClient,
)
from app.core.config import settings


class IssueReportingUnavailableError(RuntimeError):
    pass


class IssueSubmissionError(RuntimeError):
    pass


async def submit_project_issue(title: str, body: str) -> CreatedIssue:
    token = settings.github_issues_token.get_secret_value()
    if not token:
        raise IssueReportingUnavailableError("GitHub issue reporting is not configured")
    issue_body = f"{body.rstrip()}\n\n---\nSubmitted from AFAQ Harness Gateway v{settings.version}."
    try:
        client = GitHubIssuesClient(settings.github_repository, token)
        return await client.create_issue(title, issue_body)
    except GitHubIssueAuthenticationError as exc:
        raise IssueReportingUnavailableError(str(exc)) from exc
    except GitHubIssueError as exc:
        raise IssueSubmissionError("Could not submit the issue to GitHub") from exc
