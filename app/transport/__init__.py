"""Transport layer — SSE, heartbeat, history, wire mechanics.

This package owns how bytes move (SSE envelope, heartbeats, reconnect),
not what the business decides. Services and controllers depend on it only
for streaming mechanics.
"""
