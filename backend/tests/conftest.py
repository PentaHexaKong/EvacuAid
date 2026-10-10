import os
os.environ['APP_ENV'] = 'test'
os.environ['AUTH_ALLOW_GUEST_SESSIONS'] = 'true'
os.environ.setdefault('AUTH_JWT_SECRET', 'isolated-test-only-signing-secret-at-least-32-bytes')
import pytest_asyncio
from sqlalchemy import text

from app.db.session import SessionLocal, engine


@pytest_asyncio.fixture
async def dbSession():
    if not engine.url.database.endswith('_test'):
        raise RuntimeError('Database tests require a dedicated database ending in _test')
    async with engine.begin() as connection:
        await connection.execute(text('TRUNCATE auth_rate_limits, alert_responses, alert_deliveries, hazard_evidence, external_data_snapshots, shelters, assistance_requests, buddy_relationships, user_accessibility, user_preferences, users CASCADE'))
    async with SessionLocal() as session:
        yield session
    async with engine.begin() as connection:
        await connection.execute(text('TRUNCATE auth_rate_limits, alert_responses, alert_deliveries, hazard_evidence, external_data_snapshots, shelters, assistance_requests, buddy_relationships, user_accessibility, user_preferences, users CASCADE'))
    await engine.dispose()
