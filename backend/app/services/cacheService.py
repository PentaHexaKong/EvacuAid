import json
from typing import Any

from redis.asyncio import Redis
from redis.exceptions import RedisError
from fastapi import Request


class CacheService:
    def __init__(self, client: Redis | None):
        self.client = client

    async def getJson(self, key: str) -> dict[str, Any] | None:
        if self.client is None:
            return None
        try:
            payload = await self.client.get(key)
            return json.loads(payload) if payload else None
        except (RedisError, TypeError, ValueError):
            return None

    async def setJson(self, key: str, value: dict[str, Any], ttlSeconds: int) -> bool:
        if self.client is None:
            return False
        try:
            await self.client.set(key, json.dumps(value), ex=ttlSeconds)
            return True
        except RedisError:
            return False

    async def healthy(self) -> bool:
        if self.client is None:
            return False
        try:
            return bool(await self.client.ping())
        except RedisError:
            return False


def getCache(request: Request) -> CacheService:
    return CacheService(getattr(request.app.state, 'redisClient', None))
