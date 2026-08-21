# Backup and Retention Policy

This document describes the operational backup and retention posture for Afaq Harness
Gateway at the MVP stage.

## Store

The gateway uses SQLite (WAL mode) for:

- `runs` and `run_events`
- `api_keys`, `users`, `sessions`
- `conversations` and `messages`
- `model_aliases`

All stores default to file-backed databases in deployment; `:memory:` is used only in
tests. The database file and its `-wal`/`-shm` siblings form a single backup unit.

## Backups

- Back up the SQLite database directory on a schedule appropriate to the operator's
  recovery point objective.
- Prefer `sqlite3 .backup` (or a snapshot of the data directory while writes are briefly
  stopped) to avoid copying a WAL file mid-write.
- Do not commit the database, its WAL, or any credentials to Git.
- Treat the harness account configuration (where stored) as a secret and back it up
  separately in a protected volume or secret store.

## Retention

By default the gateway does not persist full raw tool output. Run events store normalized
`HarnessEvent` payloads, not the complete CLI transcript.

Operators should define retention windows and purge old rows on a schedule, for example:

```sql
-- Delete run events older than N days, then their runs.
DELETE FROM run_events WHERE run_id IN (
  SELECT id FROM runs WHERE created_at < datetime('now', '-30 days')
);
DELETE FROM runs WHERE created_at < datetime('now', '-30 days');
```

Run `PRAGMA wal_checkpoint(TRUNCATE);` after large purges to reclaim space.

## Recovery

- Restore the SQLite database directory from the most recent good backup.
- Re-run `npm test` and `npm run typecheck` to verify the runtime is intact.
- Rotate API keys and user sessions if a database backup may have been exposed.
