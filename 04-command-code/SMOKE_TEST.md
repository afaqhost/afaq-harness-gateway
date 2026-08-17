# Command-Code Smoke Test

Run the real Command-Code CLI against the gateway with a tiny prompt. Requires `cmd` installed locally and authenticated.

```
RUN_REAL_HARNESS=1 npx vitest run src/server.test.ts -t "runs the real cmd CLI"
```

This test is skipped by default and never runs in CI. Set `RUN_REAL_HARNESS=1` to opt in.
