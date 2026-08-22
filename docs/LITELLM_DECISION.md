# LiteLLM Decision

## Decision

LiteLLM is **NOT adopted** as a core or proxy dependency for the MVP.

Afaq Harness Gateway keeps its own independent runtime core. A LiteLLM integration may be reconsidered only later behind a documented, optional, MIT-only component boundary.

This aligns with ADR-002 (do not make a large LiteLLM fork the default; keep Afaq independent) and the "own small runtime core + selective integration" default established in `phases/01-research/01_LITELLM_DECISION.md`.

## Evidence

### Version tested

`litellm==1.97.0`, installed into an isolated venv at `/tmp/litellm_inspect/.venv` via `uv pip install "litellm[proxy]==1.97.0"` on Python 3.13.13.

### License boundaries

- **Core (`litellm`):** MIT license (Copyright (c) 2023 Berri AI). PyPI metadata `license_expression = MIT`.
- **Proxy extra (`litellm[proxy]`):** The `proxy` extra hard-depends on `litellm-enterprise==0.1.54`, whose `License-Expression` is `LicenseRef-Proprietary` and whose LICENSE.md is the BerriAI Enterprise License. Production use of the enterprise package requires a BerriAI subscription / valid enterprise license. It also pulls `litellm-proxy-extras==0.4.84` (MIT).
- **Conclusion:** `pip install litellm[proxy]` drags proprietary code into the dependency tree. The MIT core alone is not what the proxy extra installs. Any future integration must scope to the MIT-only core and must not pull the `proxy` extra.

### Container / proxy verification status

**BLOCKED.** Neither rootful nor rootless Docker is functional in the test environment:

- **Rootful Docker:** `dockerd` fails at startup with `chmod /media/nasser/NewVolume/Docker Data: read-only file system` because `/etc/docker/daemon.json` sets `"data-root"` to a read-only NTFS mount. Starting `dockerd` requires root, and `sudo -n` fails (no passwordless sudo available).
- **Rootless Docker:** Blocked by Ubuntu 24.04 AppArmor unprivileged-userns restriction (`kernel.apparmor_restrict_unprivileged_userns = 1`); `unshare --user --map-root-user` fails with "Operation not permitted".
- **Direct (non-container) proxy start:** Failed at runtime with `ImportError: cannot import name 'get_flat_dependant' from 'fastapi.dependencies.utils'` (installed fastapi 0.141.1), followed by `ModuleNotFoundError: No module named 'proxy_server'`.

As a result, the following verification items from `phases/01-research/01_LITELLM_DECISION.md` could **not** be completed:

- Start a known-good LiteLLM proxy container
- Verify `/v1/models` through the proxy
- Verify `/v1/chat/completions` through the proxy
- Verify streaming through the proxy
- Identify routing and authentication boundaries at runtime

License inspection and dependency-tree analysis were completed without a running container.

### Evaluation against criteria (phases/01-research/01_LITELLM_DECISION.md)

| Criterion | Score (1-5) | Notes |
|---|---|---|
| Implementation speed | 2 | Could not start the proxy; runtime incompatibilities with current Python/FastAPI stack |
| Maintenance burden | 2 | Proxy extra drags proprietary enterprise dependency; FastAPI version coupling fragile |
| Compatibility with adapter contract | 3 | Core library could theoretically map to HarnessEvent, but proxy overhead is unnecessary for our CLI-spawn model |
| Dependency stability | 2 | Enterprise license requirement, FastAPI import breakage, deep dependency tree |
| Licensing clarity | 2 | Core is MIT, but proxy extra is proprietary — easy to cross the boundary accidentally |
| Ability to keep Afaq core independent | 4 | Achievable only if scoped to MIT core with no proxy extra; proxy itself is architecturally redundant for Afaq |

**Overall:** The proxy is architecturally redundant for Afaq (which spawns CLI harnesses, not API calls), the proxy extra is proprietary, and the runtime could not be verified. The MIT core alone offers limited value over direct OpenAI-compatible HTTP calls.

## Migration / reversal plan

1. **If reconsidered later:** Any future LiteLLM integration must use only the MIT-licensed core package (`pip install litellm` without the `proxy` extra). The integration must live behind an optional, separately-importable module boundary — never in the gateway core.
2. **Reversal:** Since LiteLLM is not adopted, there is nothing to reverse. The gateway's own adapter contract (`contracts/HARNESS_ADAPTER.md`) and direct OpenAI-compatible HTTP calls (verified against Ollama) remain the integration paths.
3. **Trigger to reconsider:** If Afaq needs to support dozens of provider-specific API formats (beyond OpenAI-compatible) and the MIT-only LiteLLM core stabilizes its interface, a lightweight "provider router" utility could be evaluated. This would require: (a) the proxy extra removed from the dependency tree, (b) license audit of transitive dependencies at that future version, (c) a working container/runtime test.
