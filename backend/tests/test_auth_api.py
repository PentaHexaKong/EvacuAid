from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db.session import get_session
from app.db.models.auth import AuthAccount, AuthSession, PasswordResetToken
from app.routers import auth as auth_router
from app.services import auth_service


@pytest.fixture(autouse=True)
def authConfig(monkeypatch):
    monkeypatch.setattr(auth_service, 'AUTH_JWT_SECRET', 'test-secret-that-is-longer-than-thirty-two-bytes')
    monkeypatch.setattr(auth_service, 'AUTH_ACCESS_TOKEN_MINUTES', 15)
    monkeypatch.setattr(auth_service, 'AUTH_REFRESH_DAYS', 30)
    monkeypatch.setattr(auth_service, 'AUTH_SHORT_REFRESH_DAYS', 7)


@pytest.fixture
def authApi(dbSession):
    app = FastAPI()
    app.include_router(auth_router.router)
    app.state.redisClient = MemoryRedis()

    async def getTestSession():
        yield dbSession

    app.dependency_overrides[get_session] = getTestSession
    return app


class MemoryRedis:
    def __init__(self):
        self.values: dict[str, int] = {}

    async def incr(self, key: str) -> int:
        self.values[key] = self.values.get(key, 0) + 1
        return self.values[key]

    async def expire(self, key: str, seconds: int) -> bool:
        return True


@pytest.mark.asyncio
async def test_register_login_refresh_logout(authApi, dbSession):
    transport = ASGITransport(app=authApi)
    async with AsyncClient(transport=transport, base_url='http://test') as client:
        registered = await client.post('/v1/auth/register', json={
            'name': 'Dewi', 'email': 'dewi@example.com', 'password': 'a-long-test-password', 'rememberMe': True,
        })
        assert registered.status_code == 201
        body = registered.json()
        assert body['profile']['name'] == 'Dewi'
        assert body['refreshToken']
        assert 'password' not in body
        account = await dbSession.scalar(select(AuthAccount))
        stored_session = await dbSession.scalar(select(AuthSession))
        assert account is not None and account.password_hash != 'a-long-test-password'
        assert stored_session is not None and body['refreshToken'] not in stored_session.refresh_token_hash

        login = await client.post('/v1/auth/login', json={
            'email': 'dewi@example.com', 'password': 'a-long-test-password', 'rememberMe': False,
        })
        assert login.status_code == 200

        refreshed = await client.post('/v1/auth/refresh', json={'refreshToken': login.json()['refreshToken']})
        assert refreshed.status_code == 200
        assert refreshed.json()['refreshToken'] != login.json()['refreshToken']

        logged_out = await client.post('/v1/auth/logout', json={'refreshToken': refreshed.json()['refreshToken']})
        assert logged_out.status_code == 204
        rejected = await client.post('/v1/auth/refresh', json={'refreshToken': refreshed.json()['refreshToken']})
        assert rejected.status_code == 401


@pytest.mark.asyncio
async def test_invalid_password_and_expired_refresh_are_rejected(authApi, dbSession):
    transport = ASGITransport(app=authApi)
    async with AsyncClient(transport=transport, base_url='http://test') as client:
        created = await client.post('/v1/auth/register', json={
            'name': 'Dewi', 'email': 'dewi@example.com', 'password': 'a-long-test-password', 'rememberMe': False,
        })
        assert (await client.post('/v1/auth/login', json={
            'email': 'dewi@example.com', 'password': 'wrong-long-password', 'rememberMe': False,
        })).status_code == 401
        active_session = await dbSession.scalar(select(AuthSession))
        assert active_session is not None
        active_session.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await dbSession.commit()
        assert (await client.post('/v1/auth/refresh', json={'refreshToken': created.json()['refreshToken']})).status_code == 401


@pytest.mark.asyncio
async def test_profile_requires_access_token_and_updates_owner_only(authApi):
    transport = ASGITransport(app=authApi)
    async with AsyncClient(transport=transport, base_url='http://test') as client:
        missing = await client.get('/v1/me/profile')
        assert missing.status_code == 401
        created = await client.post('/v1/auth/register', json={
            'name': 'Dewi', 'email': 'dewi@example.com', 'password': 'a-long-test-password', 'rememberMe': False,
        })
        token = created.json()['accessToken']
        updated = await client.patch('/v1/me/profile', headers={'Authorization': f'Bearer {token}'}, json={
            'name': 'Dewi Baru', 'preferences': {'language': 'en', 'largerText': True, 'onboardingCompleted': True},
        })
        assert updated.status_code == 200
        assert updated.json()['name'] == 'Dewi Baru'
        assert updated.json()['preferences']['language'] == 'en'
        assert updated.json()['preferences']['largerText'] is True


@pytest.mark.asyncio
async def test_reset_request_is_generic_and_reset_revokes_sessions(authApi, monkeypatch):
    delivered: list[tuple[str, str]] = []

    async def sent(recipient: str, token: str) -> None:
        delivered.append((recipient, token))

    monkeypatch.setattr(auth_router, 'mail_configured', lambda: True)
    monkeypatch.setattr(auth_router, 'send_password_reset_email', sent)
    transport = ASGITransport(app=authApi)
    async with AsyncClient(transport=transport, base_url='http://test') as client:
        created = await client.post('/v1/auth/register', json={
            'name': 'Dewi', 'email': 'dewi@example.com', 'password': 'a-long-test-password', 'rememberMe': True,
        })
        old_refresh = created.json()['refreshToken']
        unknown = await client.post('/v1/auth/password/reset-request', json={'email': 'unknown@example.com'})
        known = await client.post('/v1/auth/password/reset-request', json={'email': 'dewi@example.com'})
        assert unknown.status_code == known.status_code == 202
        assert delivered[0][0] == 'dewi@example.com'
        reset = await client.post('/v1/auth/password/reset', json={'token': delivered[0][1], 'password': 'another-long-password'})
        assert reset.status_code == 204
        assert (await client.post('/v1/auth/password/reset', json={'token': delivered[0][1], 'password': 'another-long-password'})).status_code == 400
        assert (await client.post('/v1/auth/refresh', json={'refreshToken': old_refresh})).status_code == 401
        assert (await client.post('/v1/auth/login', json={'email': 'dewi@example.com', 'password': 'another-long-password', 'rememberMe': False})).status_code == 200


@pytest.mark.asyncio
async def test_expired_reset_token_and_rate_limit_are_rejected(authApi, dbSession, monkeypatch):
    delivered: list[tuple[str, str]] = []

    async def sent(recipient: str, token: str) -> None:
        delivered.append((recipient, token))

    monkeypatch.setattr(auth_router, 'mail_configured', lambda: True)
    monkeypatch.setattr(auth_router, 'send_password_reset_email', sent)
    transport = ASGITransport(app=authApi)
    async with AsyncClient(transport=transport, base_url='http://test') as client:
        await client.post('/v1/auth/register', json={
            'name': 'Dewi', 'email': 'dewi@example.com', 'password': 'a-long-test-password', 'rememberMe': False,
        })
        assert (await client.post('/v1/auth/password/reset-request', json={'email': 'dewi@example.com'})).status_code == 202
        stored_token = await dbSession.scalar(select(PasswordResetToken))
        assert stored_token is not None
        stored_token.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await dbSession.commit()
        assert (await client.post('/v1/auth/password/reset', json={'token': delivered[0][1], 'password': 'another-long-password'})).status_code == 400
        statuses = []
        for _ in range(6):
            response = await client.post('/v1/auth/login', json={
                'email': 'unknown@example.com', 'password': 'a-long-test-password', 'rememberMe': False,
            })
            statuses.append(response.status_code)
        assert statuses == [401, 401, 401, 401, 401, 429]


@pytest.mark.asyncio
async def test_google_token_valid_invalid_and_password_email_conflict(authApi, dbSession, monkeypatch):
    monkeypatch.setattr(auth_service, 'GOOGLE_CLIENT_IDS', ['web-client-id'])
    transport = ASGITransport(app=authApi)
    async with AsyncClient(transport=transport, base_url='http://test') as client:
        def invalid_token(*args, **kwargs):
            raise ValueError('invalid')

        monkeypatch.setattr(auth_service.google_id_token, 'verify_oauth2_token', invalid_token)
        assert (await client.post('/v1/auth/google', json={'idToken': 'bad-token', 'rememberMe': False})).status_code == 401

        claims = {
            'aud': 'web-client-id', 'iss': 'https://accounts.google.com', 'email_verified': True,
            'email': 'google@example.com', 'sub': 'google-subject', 'name': 'Google Dewi',
        }
        monkeypatch.setattr(auth_service.google_id_token, 'verify_oauth2_token', lambda *args, **kwargs: claims)
        success = await client.post('/v1/auth/google', json={'idToken': 'valid-token', 'rememberMe': True})
        assert success.status_code == 200
        assert success.json()['profile']['name'] == 'Google Dewi'
        stored_session = await dbSession.scalar(select(AuthSession))
        assert stored_session is not None and stored_session.remember_me is True

        await client.post('/v1/auth/register', json={
            'name': 'Password Dewi', 'email': 'password@example.com', 'password': 'a-long-test-password', 'rememberMe': False,
        })
        claims.update({'email': 'password@example.com', 'sub': 'different-google-subject'})
        conflict = await client.post('/v1/auth/google', json={'idToken': 'another-token', 'rememberMe': False})
        assert conflict.status_code == 409
