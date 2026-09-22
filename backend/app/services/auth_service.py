from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token as google_id_token
from jwt import InvalidTokenError
from pwdlib import PasswordHash
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import AUTH_ACCESS_TOKEN_MINUTES, AUTH_JWT_SECRET, AUTH_REFRESH_DAYS, AUTH_SHORT_REFRESH_DAYS, GOOGLE_CLIENT_IDS
from app.db.models.auth import AuthAccount, AuthSession, PasswordResetToken
from app.db.models.preference import UserPreference
from app.db.models.user import User
from app.models.auth import AuthResponse, GoogleLoginRequest, PasswordCredentials, ProfilePreferences, ProfileResponse, ProfileUpdate, RegisterRequest


password_hasher = PasswordHash.recommended()


def now() -> datetime:
    return datetime.now(timezone.utc)


def token_hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_secret() -> str:
    return secrets.token_urlsafe(48)


def access_token(account_id: uuid.UUID) -> str:
    if not AUTH_JWT_SECRET:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail='auth is not configured')
    expiry = now() + timedelta(minutes=AUTH_ACCESS_TOKEN_MINUTES)
    return jwt.encode({'sub': str(account_id), 'exp': expiry, 'type': 'access'}, AUTH_JWT_SECRET, algorithm='HS256')


def profile_response(user: User) -> ProfileResponse:
    preferences = user.preferences or UserPreference(user_id=user.id)
    return ProfileResponse(
        id=user.id,
        name=user.name or None,
        preferences=ProfilePreferences(
            language=preferences.language,
            largerText=preferences.larger_text,
            strongerContrast=preferences.stronger_contrast,
            onboardingCompleted=preferences.onboarding_completed,
        ),
    )


async def load_account(session: AsyncSession, account_id: uuid.UUID) -> AuthAccount | None:
    result = await session.execute(
        select(AuthAccount)
        .where(AuthAccount.id == account_id)
        .options(selectinload(AuthAccount.user).selectinload(User.preferences))
    )
    return result.scalar_one_or_none()


async def issue_session(session: AsyncSession, account: AuthAccount, remember_me: bool) -> AuthResponse:
    refresh_token = new_secret()
    days = AUTH_REFRESH_DAYS if remember_me else AUTH_SHORT_REFRESH_DAYS
    session.add(AuthSession(
        account_id=account.id,
        refresh_token_hash=token_hash(refresh_token),
        remember_me=remember_me,
        expires_at=now() + timedelta(days=days),
    ))
    await session.commit()
    if account.user is None:
        account = await require_account(session, account.id)
    return AuthResponse(
        accessToken=access_token(account.id),
        refreshToken=refresh_token,
        expiresIn=AUTH_ACCESS_TOKEN_MINUTES * 60,
        profile=profile_response(account.user),
    )


async def require_account(session: AsyncSession, account_id: uuid.UUID) -> AuthAccount:
    account = await load_account(session, account_id)
    if account is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid credentials')
    return account


async def register(session: AsyncSession, payload: RegisterRequest) -> AuthResponse:
    existing = await session.scalar(select(AuthAccount.id).where(AuthAccount.email == payload.email))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='email already has an account')
    user = User(name=payload.name)
    session.add(user)
    await session.flush()
    session.add(UserPreference(user_id=user.id))
    account = AuthAccount(user_id=user.id, email=payload.email, password_hash=password_hasher.hash(payload.password))
    session.add(account)
    await session.flush()
    account = await require_account(session, account.id)
    return await issue_session(session, account, payload.remember_me)


async def login(session: AsyncSession, payload: PasswordCredentials) -> AuthResponse:
    account = await session.scalar(
        select(AuthAccount)
        .where(AuthAccount.email == payload.email)
        .options(selectinload(AuthAccount.user).selectinload(User.preferences))
    )
    if account is None or account.password_hash is None or not password_hasher.verify(payload.password, account.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid email or password')
    return await issue_session(session, account, payload.remember_me)


async def login_google(session: AsyncSession, payload: GoogleLoginRequest) -> AuthResponse:
    if not GOOGLE_CLIENT_IDS:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail='google sign-in is not configured')
    try:
        claims = google_id_token.verify_oauth2_token(payload.id_token, GoogleRequest(), audience=None)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid Google token') from exc
    if claims.get('aud') not in GOOGLE_CLIENT_IDS or claims.get('iss') not in {'accounts.google.com', 'https://accounts.google.com'}:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid Google token')
    if claims.get('email_verified') is not True or not isinstance(claims.get('email'), str) or not isinstance(claims.get('sub'), str):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Google email is not verified')
    email = claims['email'].strip().lower()
    subject = claims['sub']
    account = await session.scalar(
        select(AuthAccount)
        .where(AuthAccount.google_subject == subject)
        .options(selectinload(AuthAccount.user).selectinload(User.preferences))
    )
    if account is None:
        existing_email = await session.scalar(select(AuthAccount).where(AuthAccount.email == email))
        if existing_email is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='email already has a password account')
        name = str(claims.get('name') or email.split('@', 1)[0]).strip()[:60] or 'EvacuAid user'
        user = User(name=name)
        session.add(user)
        await session.flush()
        session.add(UserPreference(user_id=user.id))
        account = AuthAccount(user_id=user.id, email=email, google_subject=subject, google_email_verified=True)
        session.add(account)
        await session.flush()
        account = await require_account(session, account.id)
    return await issue_session(session, account, payload.remember_me)


async def refresh(session: AsyncSession, raw_token: str) -> AuthResponse:
    auth_session = await session.scalar(
        select(AuthSession)
        .where(AuthSession.refresh_token_hash == token_hash(raw_token))
        .options(selectinload(AuthSession.account).selectinload(AuthAccount.user).selectinload(User.preferences))
    )
    if auth_session is None or auth_session.revoked_at is not None or auth_session.expires_at <= now():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid refresh token')
    auth_session.revoked_at = now()
    return await issue_session(session, auth_session.account, auth_session.remember_me)


async def logout(session: AsyncSession, raw_token: str) -> None:
    auth_session = await session.scalar(select(AuthSession).where(AuthSession.refresh_token_hash == token_hash(raw_token)))
    if auth_session is not None and auth_session.revoked_at is None:
        auth_session.revoked_at = now()
        await session.commit()


async def current_account(session: AsyncSession, credentials: HTTPAuthorizationCredentials) -> AuthAccount:
    try:
        payload = jwt.decode(credentials.credentials, AUTH_JWT_SECRET, algorithms=['HS256'])
        account_id = uuid.UUID(str(payload.get('sub')))
        if payload.get('type') != 'access':
            raise ValueError('wrong token')
    except (InvalidTokenError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid access token') from exc
    return await require_account(session, account_id)


async def update_profile(session: AsyncSession, account: AuthAccount, payload: ProfileUpdate) -> ProfileResponse:
    account = await require_account(session, account.id)
    if payload.name is not None:
        account.user.name = payload.name
    if payload.preferences is not None:
        preferences = account.user.preferences
        for field, value in payload.preferences.model_dump(exclude_unset=True).items():
            setattr(preferences, field, value)
    await session.commit()
    await session.refresh(account.user)
    return profile_response(account.user)


async def create_password_reset(session: AsyncSession, email: str) -> str | None:
    account = await session.scalar(select(AuthAccount).where(AuthAccount.email == email))
    if account is None or account.password_hash is None:
        return None
    token = new_secret()
    session.add(PasswordResetToken(account_id=account.id, token_hash=token_hash(token), expires_at=now() + timedelta(minutes=30)))
    await session.commit()
    return token


async def reset_password(session: AsyncSession, raw_token: str, password: str) -> None:
    reset_token = await session.scalar(
        select(PasswordResetToken)
        .where(PasswordResetToken.token_hash == token_hash(raw_token))
        .options(selectinload(PasswordResetToken.account))
    )
    if reset_token is None or reset_token.used_at is not None or reset_token.expires_at <= now():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='invalid or expired reset token')
    reset_token.account.password_hash = password_hasher.hash(password)
    reset_token.used_at = now()
    await session.execute(
        update(AuthSession)
        .where(AuthSession.account_id == reset_token.account_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now())
    )
    await session.commit()
