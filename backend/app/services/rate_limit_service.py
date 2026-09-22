from __future__ import annotations

import hashlib

from fastapi import HTTPException, status
from redis.asyncio import Redis


async def enforce_rate_limit(redis_client: Redis | None, *, scope: str, ip: str, identity: str, limit: int = 5, window_seconds: int = 900) -> None:
    if redis_client is None:
        return
    digest = hashlib.sha256(f'{ip}:{identity}'.encode()).hexdigest()
    key = f'auth-rate:{scope}:{digest}'
    try:
        current = await redis_client.incr(key)
        if current == 1:
            await redis_client.expire(key, window_seconds)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail='rate limit unavailable') from exc
    if current > limit:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail='too many attempts')
