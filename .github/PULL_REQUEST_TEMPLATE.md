## Problem

<!-- What problem does this PR solve? Link the issue when one exists. -->

## Solution

<!-- Describe the behavior after this change and the main implementation choices. -->

## Architecture impact

<!-- List the affected layers: API, service, repository, client, transport, UI, configuration. -->

## Risk review

- Security and authorization impact:
- Database or migration impact:
- Async, Redis, subprocess, or streaming impact:
- Backward-compatibility impact:

## Verification

<!-- Give exact commands and results. Do not write only "tests pass". -->

```text
make check
git diff --check
```

## User-visible evidence

<!-- Add screenshots for UI changes. Write "Not applicable" otherwise. -->

## Checklist

- [ ] The PR is focused on one problem and contains no unrelated cleanup.
- [ ] I followed `AGENTS.md` and kept new code in the correct layer.
- [ ] I added or updated tests, including failure and cleanup paths where relevant.
- [ ] `make check` passes with warnings treated as errors.
- [ ] `git diff --check` passes.
- [ ] I updated docs for changed routes, configuration, output, or operator behavior.
- [ ] I considered authentication, secrets, quotas, data ownership, and concurrency.
- [ ] I did not commit secrets, generated files, caches, or local state.
- [ ] I added a changelog entry when the change is user-visible.
