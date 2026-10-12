import asyncio
import uuid
from datetime import datetime, timedelta, timezone
import httpx
import jwt
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select, func
from app.authConfig import settings, validate_startup
from app.db.models import User, UserPreference, GuestSession
from app.db.models.auth import RefreshToken
from app.db.models.buddySession import BuddyRequest
from app.db.session import get_session, SessionLocal
from app.routers import auth, users, sessions, buddy, context, externalData
from app.services import authService

PASSWORD = 'a-long-test-password'


@pytest_asyncio.fixture
async def client(dbSession):
    app = FastAPI()
    for router in (auth.router, users.router, sessions.router, context.router, externalData.router):
        app.include_router(router)
    app.include_router(buddy.router, prefix='/v1/buddy')
    async def database():
        yield dbSession
    app.dependency_overrides[get_session] = database
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as result:
        yield result


async def account(client, email='citizen@example.com', **extra):
    response = await client.post('/v1/auth/register', json={'email':email, 'password':PASSWORD, **extra})
    assert response.status_code == 201, response.text
    return response.json()


def headers(tokens):
    return {'Authorization':'Bearer '+tokens['access_token']}


@pytest.mark.asyncio
async def test_registration_login_hashes_and_atomic_duplicate(client, dbSession):
    tokens = await account(client, ' Citizen@Example.com ', name='Citizen', accessibility=[{'type':'BLIND'},{'type':'IMMOBILE'},{'type':'DEAF'}])
    user = await dbSession.get(User, uuid.UUID(tokens['user']['id']))
    assert user.email == 'citizen@example.com' and user.role == 'CITIZEN'
    assert user.password_hash.startswith('$argon2id$') and PASSWORD not in user.password_hash
    assert await dbSession.scalar(select(func.count()).select_from(UserPreference)) == 1
    rows = (await client.get(f'/v1/users/{user.id}/accessibility', headers=headers(tokens))).json()
    assert {row['type'] for row in rows} == {'VISUAL_IMPAIRMENT','MOBILITY_LIMITATION','HEARING_IMPAIRMENT'}
    duplicate = await client.post('/v1/auth/register', json={'email':'CITIZEN@example.com','password':PASSWORD, 'accessibility':[{'type':'BLIND'}]})
    assert duplicate.status_code == 409
    assert await dbSession.scalar(select(func.count()).select_from(User)) == 1
    assert await dbSession.scalar(select(func.count()).select_from(UserPreference)) == 1
    logged = await client.post('/v1/auth/login', json={'email':'CITIZEN@example.com','password':PASSWORD})
    assert logged.status_code == 200 and logged.json()['user']['id'] == str(user.id)
    assert logged.headers['cache-control'] == 'no-store'
    assert (await client.get('/v1/auth/me', headers=headers(logged.json()))).json()['role'] == 'CITIZEN'
    persisted = (await dbSession.execute(select(RefreshToken))).scalars().all()
    assert all(record.token_hash != tokens['refresh_token'] for record in persisted)


@pytest.mark.asyncio
async def test_wrong_password_and_unknown_email_are_identical(client):
    await account(client)
    results = [await client.post('/v1/auth/login', json={'email':email,'password':'wrong-password'})
        for email in ('citizen@example.com','unknown@example.com')]
    assert [r.status_code for r in results] == [401,401]
    assert results[0].json() == results[1].json() == {'detail':'Invalid credentials'}


@pytest.mark.asyncio
@pytest.mark.parametrize('extra', [{'role':'ADMIN'},{'role':'GOVERNMENT'},{'id':str(uuid.uuid4())},{'password':'short'},{'password':'x'*129},{'email':'invalid'}, {'accessibility':[{'type':'BLIND'},{'type':'VISUAL_IMPAIRMENT'}]}])
async def test_registration_rejects_unsafe_inputs_without_echo(client, extra):
    response = await client.post('/v1/auth/register', json={'email':'citizen@example.com','password':PASSWORD, **extra})
    assert response.status_code == 422
    assert PASSWORD not in response.text and '"input"' not in response.text


@pytest.mark.asyncio
@pytest.mark.parametrize('mutation', ['expired','issuer','audience','subject','missing','type','signature','algorithm','malformed','future'])
async def test_jwt_validation(client, mutation):
    tokens = await account(client)
    cfg = settings()
    claims = jwt.decode(tokens['access_token'], cfg.secret, algorithms=['HS256'], audience=cfg.audience, issuer=cfg.issuer)
    secret, algorithm = cfg.secret, 'HS256'
    if mutation == 'expired': claims['exp'] = int((datetime.now(timezone.utc)-timedelta(seconds=1)).timestamp())
    if mutation == 'issuer': claims['iss'] = 'wrong'
    if mutation == 'audience': claims['aud'] = 'wrong'
    if mutation == 'subject': claims['sub'] = 'not-a-uuid'
    if mutation == 'missing': del claims['exp']
    if mutation == 'type': claims['type'] = 'refresh'
    if mutation == 'signature': secret = 'another-key-at-least-thirty-two-bytes'
    if mutation == 'algorithm': algorithm = 'HS384'
    if mutation == 'future': claims['nbf'] += 3600
    raw = 'bad.jwt.token' if mutation == 'malformed' else jwt.encode(claims, secret, algorithm=algorithm)
    response = await client.get('/v1/auth/me', headers={'Authorization':'Bearer '+raw})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_refresh_rotation_replay_revokes_family_and_not_other_login(client):
    original = await account(client)
    separate = (await client.post('/v1/auth/login', json={'email':'citizen@example.com','password':PASSWORD})).json()
    rotated = await client.post('/v1/auth/refresh', json={'refresh_token':original['refresh_token']})
    assert rotated.status_code == 200 and rotated.json()['refresh_token'] != original['refresh_token']
    assert (await client.post('/v1/auth/refresh', json={'refresh_token':original['refresh_token']})).status_code == 401
    assert (await client.post('/v1/auth/refresh', json={'refresh_token':rotated.json()['refresh_token']})).status_code == 401
    assert (await client.post('/v1/auth/refresh', json={'refresh_token':separate['refresh_token']})).status_code == 200


@pytest.mark.asyncio
async def test_logout_revoke_refresh_access_remains_short_lived(client):
    tokens = await account(client)
    assert (await client.post('/v1/auth/logout', json={'refresh_token':tokens['refresh_token']})).status_code == 204
    assert (await client.post('/v1/auth/refresh', json={'refresh_token':tokens['refresh_token']})).status_code == 401
    assert (await client.get('/v1/auth/me', headers=headers(tokens))).status_code == 200
    assert (await client.post('/v1/auth/logout', json={'refresh_token':'unknown'})).status_code == 204
    assert (await client.delete('/v1/guest-sessions/current', headers=headers(tokens))).status_code == 403


@pytest.mark.asyncio
async def test_expired_refresh(client, dbSession):
    tokens = await account(client)
    row = (await dbSession.execute(select(RefreshToken))).scalar_one()
    row.expires_at = datetime.now(timezone.utc)-timedelta(seconds=1)
    await dbSession.commit()
    assert (await client.post('/v1/auth/refresh', json={'refresh_token':tokens['refresh_token']})).status_code == 401


@pytest.mark.asyncio
async def test_concurrent_rotation_detects_replay(client):
    tokens = await account(client)
    async def rotate():
        async with SessionLocal() as session:
            try:
                return await authService.refresh(session, tokens['refresh_token'])
            except Exception as error:
                assert getattr(error, 'status_code', None) == 401
                return None
    results = await asyncio.gather(rotate(), rotate())
    assert sum(result is not None for result in results) == 1
    winner = next(result for result in results if result)
    assert (await client.post('/v1/auth/refresh', json={'refresh_token':winner.refresh_token})).status_code == 401


@pytest.mark.asyncio
async def test_rate_limit_failed_logins_and_cache_headers(client):
    for _ in range(5):
        assert (await client.post('/v1/auth/login', json={'email':'unknown@example.com','password':PASSWORD})).status_code == 401
    response = await client.post('/v1/auth/login', json={'email':'unknown@example.com','password':PASSWORD})
    assert response.status_code == 429 and int(response.headers['retry-after']) > 0
    assert response.headers['cache-control'] == 'no-store'


@pytest.mark.asyncio
async def test_guest_upgrade_preserves_identity_and_production_disables_guest(client, monkeypatch):
    guest = (await client.post('/v1/guest-sessions')).json()
    old_headers = headers(guest)
    identity = guest['user']['id']
    assert (await client.put(f'/v1/users/{identity}/accessibility', headers=old_headers,json={'items':[{'type':'BLIND'},{'type':'DEAF'}]})).status_code == 200
    monkeypatch.setenv('AUTH_ALLOW_GUEST_SESSIONS','false')
    monkeypatch.setenv('APP_ENV','production')
    monkeypatch.delenv('PILOT_DEV_SIMULATION',raising=False)
    assert (await client.post('/v1/guest-sessions')).status_code == 404
    assert (await client.get('/v1/me', headers=old_headers)).status_code == 401
    upgraded = await client.post('/v1/auth/register',headers=old_headers,json={'email':'upgraded@example.com','password':PASSWORD})
    assert upgraded.status_code == 201 and upgraded.json()['user']['id'] == identity
    rows = (await client.get(f'/v1/users/{identity}/accessibility', headers=headers(upgraded.json()))).json()
    assert len(rows) == 2
    assert (await client.get('/v1/me', headers=old_headers)).status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize('role', ['CITIZEN','RESPONDER','GOVERNMENT','ADMIN'])
async def test_owner_rules_apply_to_all_roles(client, dbSession, role):
    owner = await account(client, 'owner@example.com')
    stranger = await account(client, 'stranger@example.com')
    user = await dbSession.get(User, uuid.UUID(stranger['user']['id']))
    user.role = role
    await dbSession.commit()
    identity = owner['user']['id']
    for suffix in ('','/accessibility','/preferences'):
        assert (await client.get(f'/v1/users/{identity}{suffix}', headers=headers(stranger))).status_code == 403
    assert (await client.get(f'/v1/users/{identity}')).status_code == 401
    assert (await client.get('/v1/context')).status_code == 401
    assert (await client.get('/v1/buddy/requests/current')).status_code == 401
    # An injected userId query does not change the actor-bound context.
    response = await client.get('/v1/context?userId='+identity, headers=headers(stranger))
    assert response.status_code == 409 and response.json()['detail'] == 'user location is required for context'
    assert (await client.patch(f'/v1/auth/users/{identity}/role', headers=headers(owner), json={'role':'ADMIN'})).status_code == 403


@pytest.mark.asyncio
async def test_admin_assignment_and_database_role_change(client, dbSession):
    admin = await account(client,'admin@example.com')
    citizen = await account(client)
    user = await dbSession.get(User, uuid.UUID(admin['user']['id']))
    user.role = 'ADMIN'  # Trusted database bootstrap, never public registration.
    await dbSession.commit()
    assigned = await client.patch('/v1/auth/users/'+citizen['user']['id']+'/role',headers=headers(admin),json={'role':'GOVERNMENT'})
    assert assigned.status_code == 200 and set(assigned.json()) == {'id','role'}
    assert (await client.get('/v1/auth/me',headers=headers(citizen))).json()['role'] == 'GOVERNMENT'
    assert (await client.patch('/v1/auth/users/'+admin['user']['id']+'/role',headers=headers(admin),json={'role':'CITIZEN'})).status_code == 409
    assert (await client.post('/v1/external-data/sync', headers=headers(citizen))).status_code == 403
    assert (await client.post('/v1/external-data/sync')).status_code == 401


@pytest.mark.parametrize('name,value', [('AUTH_JWT_SECRET','short'),('CORS_ALLOWED_ORIGINS','*'),('AUTH_ACCESS_TOKEN_SECONDS','999999'),('AUTH_REFRESH_TOKEN_DAYS','0')])
def test_configuration_fails_closed(monkeypatch, name, value):
    monkeypatch.setenv(name,value)
    with pytest.raises(ValueError): validate_startup()


def test_production_guest_flag_rejected(monkeypatch):
    monkeypatch.setenv('APP_ENV','production')
    monkeypatch.setenv('AUTH_ALLOW_GUEST_SESSIONS','true')
    with pytest.raises(ValueError): validate_startup()


@pytest.mark.asyncio
async def test_responder_cases_require_assignment_and_government_denied(client, dbSession):
    requester = await account(client, 'requester@example.com')
    assigned = await account(client, 'responder@example.com')
    stranger = await account(client, 'other-responder@example.com')
    government = await account(client, 'government@example.com')
    for tokens, role in ((assigned,'RESPONDER'),(stranger,'RESPONDER'),(government,'GOVERNMENT')):
        user = await dbSession.get(User, uuid.UUID(tokens['user']['id']))
        user.role = role
    case = BuddyRequest(requester_id=uuid.UUID(requester['user']['id']), helper_id=uuid.UUID(assigned['user']['id']),
        status='ACCEPTED', buddy_flow=True, message='Private operational request')
    dbSession.add(case)
    await dbSession.commit()
    for tokens in (requester,assigned):
        assert (await client.get(f'/v1/buddy/requests/{case.id}', headers=headers(tokens))).status_code == 200
        assert (await client.get(f'/v1/buddy/requests/{case.id}/messages', headers=headers(tokens))).status_code == 200
    for tokens in (stranger,government):
        response = await client.get(f'/v1/buddy/requests/{case.id}', headers=headers(tokens))
        assert response.status_code == 403 and case.message not in response.text
        assert (await client.get(f'/v1/buddy/requests/{case.id}/messages', headers=headers(tokens))).status_code == 403
        assert (await client.post(f'/v1/buddy/requests/{case.id}/interrupt', headers=headers(tokens))).status_code == 403


@pytest.mark.asyncio
async def test_expired_development_guest_rejected(client, dbSession):
    tokens = (await client.post('/v1/guest-sessions')).json()
    guest = await dbSession.get(GuestSession, uuid.UUID(tokens['user']['id']))
    guest.expires_at = datetime.now(timezone.utc)-timedelta(seconds=1)
    await dbSession.commit()
    assert (await client.get('/v1/me', headers=headers(tokens))).status_code == 401


@pytest.mark.asyncio
async def test_bootstrap_is_out_of_band_and_only_once(client, dbSession):
    from app.authCli import bootstrap
    tokens = await account(client, 'operator@example.com')
    await bootstrap('operator@example.com')
    user = await dbSession.get(User, uuid.UUID(tokens['user']['id']))
    await dbSession.refresh(user)
    assert user.role == 'ADMIN'
    with pytest.raises(RuntimeError, match='already exists'):
        await bootstrap('operator@example.com')
    assert (await client.get('/v1/auth/me',headers=headers(tokens))).json()['role'] == 'ADMIN'


@pytest.mark.asyncio
@pytest.mark.parametrize('action,count,body', [('refresh',60,{'refresh_token':'not-a-token'}),
    ('register',10,{'email':'citizen@example.com','password':PASSWORD})])
async def test_registration_and_refresh_rate_limits(client, action, count, body):
    options = {'headers':{'Authorization':'Bearer invalid-guest'}} if action == 'register' else {}
    for _ in range(count):
        assert (await client.post('/v1/auth/'+action,json=body,**options)).status_code == 401
    response = await client.post('/v1/auth/'+action,json=body,**options)
    assert response.status_code == 429 and int(response.headers['retry-after']) > 0


@pytest.mark.asyncio
async def test_public_health_reference_and_dashboard_exception(dbSession, client):
    from app.main import app
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as public:
        assert (await public.get('/')).status_code == 200
        preflight = await public.options('/v1/auth/login', headers={'Origin':'https://untrusted.example','Access-Control-Request-Method':'POST'})
        assert 'access-control-allow-origin' not in preflight.headers
    # Combined command API is intentionally public, including for GOVERNMENT.
    from command.api import router as command_router
    gov = await account(client,'government@example.com')
    user = await dbSession.get(User,uuid.UUID(gov['user']['id']))
    user.role = 'GOVERNMENT'
    await dbSession.commit()
    command_app = FastAPI()
    command_app.include_router(command_router)
    async def database():
        yield dbSession
    command_app.dependency_overrides[get_session] = database
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=command_app),base_url='http://test') as public:
        for credential in ({},headers(gov)):
            response = await public.get('/v1/command/regions',headers=credential)
            assert response.status_code == 200
            assert 'password_hash' not in response.text and 'government@example.com' not in response.text


@pytest.mark.asyncio
async def test_delete_account_needs_password_and_removes_everything(client, dbSession):
    tokens = await account(client, 'leaving@example.com')
    user_id = uuid.UUID(tokens['user']['id'])
    wrong = await client.request('DELETE', '/v1/auth/me', headers=headers(tokens), json={'password':'not-the-password'})
    assert wrong.status_code == 403 and await dbSession.get(User, user_id) is not None
    assert (await client.request('DELETE', '/v1/auth/me', json={'password':PASSWORD})).status_code in (401, 403)
    assert (await client.request('DELETE', '/v1/auth/me', headers=headers(tokens), json={'password':PASSWORD})).status_code == 204
    dbSession.expire_all()
    assert await dbSession.get(User, user_id) is None
    assert await dbSession.scalar(select(func.count()).select_from(RefreshToken).where(RefreshToken.user_id == user_id)) == 0
    assert (await client.get('/v1/auth/me', headers=headers(tokens))).status_code == 401
    assert (await client.post('/v1/auth/login', json={'email':'leaving@example.com', 'password':PASSWORD})).status_code == 401
    assert (await client.post('/v1/auth/refresh', json={'refresh_token':tokens['refresh_token']})).status_code == 401


@pytest.mark.asyncio
async def test_last_administrator_cannot_delete_account(client, dbSession):
    tokens = await account(client, 'boss@example.com')
    user = await dbSession.get(User, uuid.UUID(tokens['user']['id']))
    user.role = 'ADMIN'
    await dbSession.commit()
    response = await client.request('DELETE', '/v1/auth/me', headers=headers(tokens), json={'password':PASSWORD})
    assert response.status_code == 409 and await dbSession.get(User, user.id) is not None
