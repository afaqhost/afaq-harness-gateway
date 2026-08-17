# Data Model

MVP entities:

- `users`
- `api_keys`
- `harnesses`
- `models`
- `model_aliases`
- `conversations`
- `messages`
- `runs`
- `run_events`
- `audit_logs`

Use SQLite in WAL mode initially. Keep write transactions short. The storage layer should allow migration to PostgreSQL without changing the runtime or adapter contracts.
