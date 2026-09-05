import time

import pytest
from app.middleware.rate_limit import InMemoryRateLimiter

pytestmark = pytest.mark.unit


def test_allow_within_limit_returns_true():
    limiter = InMemoryRateLimiter()
    assert limiter.allow("user1", limit=5, window_s=60)[0] is True
    assert limiter.allow("user1", limit=5, window_s=60)[0] is True
    assert limiter._size("user1") == 2


def test_allow_exceeds_limit_returns_false_and_retry_after():
    limiter = InMemoryRateLimiter()
    # fill up to limit
    for _ in range(3):
        allowed, _ = limiter.allow("key1", limit=3, window_s=60)
        assert allowed is True
    # next should be blocked
    allowed, retry = limiter.allow("key1", limit=3, window_s=60)
    assert allowed is False
    assert retry >= 1
    assert retry <= 60


def test_window_slides_after_expiry():
    limiter = InMemoryRateLimiter()
    # limit 2 per 1 second
    assert limiter.allow("k", limit=2, window_s=1)[0] is True
    assert limiter.allow("k", limit=2, window_s=1)[0] is True
    assert limiter.allow("k", limit=2, window_s=1)[0] is False
    time.sleep(1.1)
    # window should have slid, allow again
    assert limiter.allow("k", limit=2, window_s=1)[0] is True
    assert limiter.allow("k", limit=2, window_s=1)[0] is True
    assert limiter.allow("k", limit=2, window_s=1)[0] is False


def test_different_buckets_isolated():
    limiter = InMemoryRateLimiter()
    limiter.allow("a", limit=1, window_s=60)
    assert limiter.allow("a", limit=1, window_s=60)[0] is False
    # different bucket should still allow
    assert limiter.allow("b", limit=1, window_s=60)[0] is True


def test_reset_clears_all():
    limiter = InMemoryRateLimiter()
    limiter.allow("x", limit=5, window_s=60)
    limiter.allow("x", limit=5, window_s=60)
    limiter.reset()
    assert limiter._size("x") == 0
    assert limiter.allow("x", limit=1, window_s=60)[0] is True


@pytest.mark.parametrize("limit,window", [(2, 60), (5, 60), (10, 60)])
def test_parametrized_limits(limit, window):
    limiter = InMemoryRateLimiter()
    for _ in range(limit):
        assert limiter.allow("p", limit=limit, window_s=window)[0] is True
    assert limiter.allow("p", limit=limit, window_s=window)[0] is False
