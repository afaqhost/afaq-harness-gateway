# API Keys and Authentication

## Key format

```text
ahg_live_<secret>
```

Store only a secure hash plus a display prefix. Show the secret only at creation time.

## Key controls

- enabled/disabled;
- model allowlist;
- RPM limit;
- maximum concurrent runs;
- optional monthly budget;
- optional expiry;
- last-used timestamp.

## Web authentication

Use secure HTTP-only sessions, strong password hashing, and disable open registration by default.

## Logging

Never log Authorization headers or raw API-key values.
