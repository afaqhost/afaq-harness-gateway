# Third-Party Notices

This document lists the licenses of software included in or used to build
Afaq Harness Gateway.

## Runtime dependencies

Afaq Harness Gateway has **zero runtime npm dependencies**. The runtime
uses only Node.js built-in modules:

- `node:http` -- HTTP server
- `node:sqlite` -- embedded database
- `node:crypto` -- hashing and key generation
- `node:child_process` -- spawning harness CLIs
- `node:fs`, `node:path`, `node:url`, `node:os`, `node:events`, `node:stream`, `node:util`, `node:timers`

No third-party code is bundled into the production runtime.

## Direct devDependencies

| Package | Version | License |
|---------|---------|---------|
| `@types/node` | ^22.20.1 | MIT |
| `typescript` | ^7.0.2 | Apache-2.0 |
| `vitest` | ^4.1.10 | MIT |

These are used for type-checking, compilation, and testing only. They do
not ship in the production artifact.

## Key transitive dependencies

The full transitive dependency tree is recorded in `package-lock.json`.
Below are representative packages grouped by license.

### MIT

- `vite` -- dev server and bundler (used by vitest)
- `vitest` -- test runner
- `@types/node` -- Node.js type definitions
- `tinyglobby` -- fast glob matching
- `pathe` -- cross-platform path utilities
- `std-env` -- environment detection
- `chai` -- assertion library
- `@vitest/runner`, `@vitest/snapshot`, `@vitest/utils` -- vitest internals

### Apache-2.0

- `typescript` -- TypeScript compiler
- `detect-libc` -- libc detection (transitive, dev/test)
- `expect-type` -- type-testing helper (transitive, dev/test)

### ISC

- `picocolors` -- terminal color output
- `siginfo` -- signal info utility

### BSD-3-Clause

- `source-map-js` -- source map support

### MPL-2.0

- `lightningcss` (and platform-specific `lightningcss-*` packages) -- CSS
  parser/minifier used by vite

## MPL-2.0 and BSD-3-Clause scope

MPL-2.0 and BSD-3-Clause licensed packages appear only as transitive
dependencies of the build and test tooling (vite, vitest). They are never
imported into the Afaq runtime. `rolldown` and `vite` themselves are MIT.
MPL-2.0 applies on a per-file basis and does not require the Afaq source
code to be licensed under MPL-2.0.

## External Harness CLIs

The four Harness CLIs are **external tools**, not bundled dependencies:

| CLI | Integration |
|-----|-------------|
| Command-Code | `src/harness/command-code.ts` |
| Codex | `src/harness/codex.ts` |
| Claude Code | `src/harness/claude-code.ts` |
| OpenCode | `src/harness/opencode.ts` |

Afaq ships only adapters that spawn these CLIs as child processes. Users
obtain and license each CLI separately under its vendor's own terms.
Afaq's Apache-2.0 license grants no rights to those third-party services.
