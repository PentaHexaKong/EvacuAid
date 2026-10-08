import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal, engine


@pytest_asyncio.fixture
async def commandSession():
    if not engine.url.database.endswith('_test'):
        raise RuntimeError('Command integration tests require dedicated _test database')
    async with engine.connect() as connection:
        transaction = await connection.begin()
        async with AsyncSession(bind=connection, expire_on_commit=False, join_transaction_mode='create_savepoint') as session:
            yield session
        await transaction.rollback()
    await engine.dispose()
