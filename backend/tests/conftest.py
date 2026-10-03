import pytest_asyncio
from sqlalchemy import text

from app.db.session import SessionLocal, engine


@pytest_asyncio.fixture
async def dbSession():
    if not engine.url.database.endswith('_test'):
        raise RuntimeError('Database tests require a dedicated database ending in _test')
    async with engine.begin() as connection:
        await connection.execute(text('TRUNCATE hazard_evidence, external_data_snapshots, shelters, assistance_requests, buddy_relationships, user_accessibility, user_preferences, users CASCADE'))
    async with SessionLocal() as session:
        yield session
    async with engine.begin() as connection:
        await connection.execute(text('TRUNCATE hazard_evidence, external_data_snapshots, shelters, assistance_requests, buddy_relationships, user_accessibility, user_preferences, users CASCADE'))
    await engine.dispose()
