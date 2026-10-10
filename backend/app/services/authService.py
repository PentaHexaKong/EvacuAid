"""Account credentials and refresh sessions share the existing User identity."""
import asyncio
import hashlib
import secrets
import uuid
import weakref
from datetime import datetime, timedelta, timezone
import jwt
from argon2 import PasswordHasher, Type
from argon2.exceptions import VerificationError
from fastapi import HTTPException
from sqlalchemy import select, update, text
from sqlalchemy.exc import IntegrityError
from app.authConfig import validate_startup
from app.db.models import User, GuestSession
from app.db.models.auth import RefreshToken
from app.models.auth import AuthUser, Tokens
from app.repositories import users as users_repository
from app.services import user_service

hasher = PasswordHasher(type=Type.ID)
dummy_hash = hasher.hash(secrets.token_urlsafe(32))
limiters = weakref.WeakKeyDictionary()


async def password_work(function, *args):
    loop = asyncio.get_running_loop()
    limiter = limiters.setdefault(loop, asyncio.Semaphore(2))
    async with limiter:
        return await asyncio.to_thread(function, *args)


def unauthorized():
    return HTTPException(401, 'Invalid credentials', headers={'WWW-Authenticate': 'Bearer'})


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def configuration():
    try:
        return validate_startup()
    except ValueError:
        raise HTTPException(503, 'Authentication is not configured') from None


def access_token(user):
    cfg = configuration()
    now = datetime.now(timezone.utc)
    return jwt.encode({'sub': str(user.id), 'iss': cfg.issuer, 'aud': cfg.audience,
        'iat': now, 'nbf': now, 'exp': now + timedelta(seconds=cfg.access_seconds),
        'jti': str(uuid.uuid4()), 'type': 'access'}, cfg.secret, algorithm='HS256')


async def authenticate(session, raw):
    cfg = configuration()
    try:
        claims = jwt.decode(raw, cfg.secret, algorithms=['HS256'], issuer=cfg.issuer, audience=cfg.audience,
            options={'require': ['sub','iss','aud','exp','iat','nbf','jti','type'], 'strict_aud': True})
        if claims['type'] != 'access' or not isinstance(claims['jti'], str):
            raise ValueError()
        identity = uuid.UUID(claims['sub'])
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise unauthorized() from None
    user = await session.get(User, identity)
    if user is None or user.email is None or user.password_hash is None:
        raise unauthorized()
    return user


async def legacy_guest(session, raw):
    return (await session.execute(select(User).join(GuestSession).where(
        GuestSession.token_hash == digest(raw), GuestSession.expires_at > datetime.now(timezone.utc),
        User.email.is_(None), User.role == 'CITIZEN').with_for_update(of=User))).scalar_one_or_none()


def issue(session, user, *, family=None, expires=None):
    cfg = configuration()
    now = datetime.now(timezone.utc)
    raw = secrets.token_urlsafe(48)
    expires = expires or now + timedelta(days=cfg.refresh_days)
    session.add(RefreshToken(user_id=user.id, family_id=family or uuid.uuid4(), token_hash=digest(raw), expires_at=expires))
    return Tokens(access_token=access_token(user), expires_in=cfg.access_seconds, refresh_token=raw,
        refresh_expires_in=max(0, int((expires-now).total_seconds())),
        user=AuthUser(id=user.id, email=user.email, name=user.name, role=user.role))


async def register(session, payload, guest_token=None):
    password_hash = await password_work(hasher.hash, payload.password.get_secret_value())
    user = await legacy_guest(session, guest_token) if guest_token else await user_service.create_guest(session)
    if user is None:
        raise unauthorized()
    user.email, user.password_hash, user.role = payload.email, password_hash, 'CITIZEN'
    if 'name' in payload.model_fields_set:
        user.name = payload.name
    if 'accessibility' in payload.model_fields_set:
        await session.refresh(user, ['accessibility'])
        await users_repository.replace_accessibility(session, user, [(item.type.value,item.severity) for item in payload.accessibility])
    if guest_token:
        guest = await session.get(GuestSession, user.id)
        await session.delete(guest)
    result = issue(session, user)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, 'Unable to register with these credentials') from None
    return result


async def login(session, payload):
    user = (await session.execute(select(User).where(User.email == payload.email))).scalar_one_or_none()
    try:
        await password_work(hasher.verify, user.password_hash if user and user.password_hash else dummy_hash,
            payload.password.get_secret_value())
    except VerificationError:
        raise unauthorized() from None
    if user is None or user.password_hash is None:
        raise unauthorized()
    if hasher.check_needs_rehash(user.password_hash):
        user.password_hash = await password_work(hasher.hash, payload.password.get_secret_value())
    result = issue(session, user)
    await session.commit()
    return result


async def lock_family(session, family):
    await session.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': family.int & ((1 << 63)-1)})


async def revoke_family(session, family):
    await session.execute(update(RefreshToken).where(RefreshToken.family_id == family).values(revoked_at=datetime.now(timezone.utc)))


async def refresh(session, raw):
    token = (await session.execute(select(RefreshToken).where(RefreshToken.token_hash == digest(raw)))).scalar_one_or_none()
    if token is None:
        raise unauthorized()
    await lock_family(session, token.family_id)
    await session.refresh(token, with_for_update=True)
    now = datetime.now(timezone.utc)
    if token.consumed_at or token.revoked_at:
        await revoke_family(session, token.family_id)
        await session.commit()
        raise unauthorized()
    if token.expires_at <= now:
        raise unauthorized()
    user = await session.get(User, token.user_id)
    if user is None or user.email is None:
        raise unauthorized()
    token.consumed_at = now
    result = issue(session, user, family=token.family_id, expires=token.expires_at)
    await session.commit()
    return result


async def logout(session, raw):
    token = (await session.execute(select(RefreshToken).where(RefreshToken.token_hash == digest(raw)))).scalar_one_or_none()
    if token:
        await lock_family(session, token.family_id)
        await revoke_family(session, token.family_id)
        await session.commit()
