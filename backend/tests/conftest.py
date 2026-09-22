import pytest_asyncio
from sqlalchemy import text

from app.db.session import SessionLocal, engine


@pytest_asyncio.fixture
async def dbSession():
    async with engine.begin() as connection:
        await connection.execute(text('TRUNCATE password_reset_tokens, auth_sessions, auth_accounts, assistance_requests, buddy_relationships, user_accessibility, user_preferences, users CASCADE'))
    async with SessionLocal() as session:
        yield session
    async with engine.begin() as connection:
        await connection.execute(text('TRUNCATE password_reset_tokens, auth_sessions, auth_accounts, assistance_requests, buddy_relationships, user_accessibility, user_preferences, users CASCADE'))
    await engine.dispose()
