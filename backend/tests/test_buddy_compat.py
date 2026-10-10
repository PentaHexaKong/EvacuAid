import pytest


@pytest.mark.asyncio
async def test_removed_endpoints_and_buddy_compatibility(dbSession):
    import httpx
    from app.db.session import get_session
    from app.main import app

    async def database():
        yield dbSession

    app.dependency_overrides[get_session] = database
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            guest = (await client.post('/v1/guest-sessions')).json()
            headers = {'Authorization': 'Bearer ' + guest['access_token']}
            for endpoint in ('assistance', 'buddies'):
                assert (await client.get('/v1/' + endpoint, headers=headers)).status_code == 404
            for prefix in ('/v1/buddy', '/v1/buddy-pilot'):
                response = await client.get(prefix + '/requests/current', headers=headers)
                assert response.status_code == 200
                assert response.json() is None
            schema = app.openapi()['paths']
            assert '/v1/buddy/requests/current' in schema
            assert not any(path.startswith('/v1/buddy-pilot') for path in schema)
    finally:
        app.dependency_overrides.pop(get_session, None)
