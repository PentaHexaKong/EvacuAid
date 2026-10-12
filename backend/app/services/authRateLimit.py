"""Shared PostgreSQL limiter: failures count across workers and restarts."""
import hashlib
import math
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from sqlalchemy import case, delete
from sqlalchemy.dialects.postgresql import insert
from app.db.models.auth import AuthRateLimit


async def enforce(session, action, ip, email=None):
    now = datetime.now(timezone.utc)
    limits = [(ip, {'register':10, 'login':20, 'refresh':60, 'logout':60, 'delete':20}[action])]
    if email and action in ('login', 'delete'):
        limits.append(('email:'+email, 5))
    blocked = None
    for identity, maximum in limits:
        key = action + ':' + hashlib.sha256(identity.encode()).hexdigest()
        row = insert(AuthRateLimit).values(key=key, attempts=1, expires_at=now+timedelta(seconds=60))
        expired = AuthRateLimit.expires_at <= now
        row = row.on_conflict_do_update(index_elements=[AuthRateLimit.key], set_={
            'attempts':case((expired,1),else_=AuthRateLimit.attempts+1),
            'expires_at':case((expired,now+timedelta(seconds=60)),else_=AuthRateLimit.expires_at)}).returning(AuthRateLimit.attempts, AuthRateLimit.expires_at)
        attempts, expiry = (await session.execute(row)).one()
        if attempts > maximum:
            blocked = max(1,math.ceil((expiry-now).total_seconds()))
    await session.execute(delete(AuthRateLimit).where(AuthRateLimit.expires_at < now-timedelta(days=1)))
    await session.commit()
    if blocked:
        raise HTTPException(429, 'Too many authentication attempts', headers={'Retry-After':str(blocked), 'Cache-Control':'no-store'})
