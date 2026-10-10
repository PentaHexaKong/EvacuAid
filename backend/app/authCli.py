"""Operator-only, one-time promotion of an existing account. No default credentials."""
import argparse
import asyncio
from sqlalchemy import select, text
from app.authConfig import validate_startup
from app.db.models import User
from app.db.session import SessionLocal, engine
from app.models.auth import normalize_email


async def bootstrap(email):
    validate_startup()
    try:
        async with SessionLocal() as session:
            await session.execute(text('SELECT pg_advisory_xact_lock(734191102)'))
            if (await session.execute(select(User.id).where(User.role == 'ADMIN').limit(1))).scalar_one_or_none():
                raise RuntimeError('An administrator already exists; use the authenticated role assignment endpoint')
            user = (await session.execute(select(User).where(User.email == normalize_email(email)).with_for_update())).scalar_one_or_none()
            if user is None or not user.password_hash:
                raise RuntimeError('Register the intended operator account first')
            user.role = 'ADMIN'
            await session.commit()
            print('Administrator account promoted')
    finally:
        await engine.dispose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['bootstrap-admin'])
    parser.add_argument('--email', required=True)
    args = parser.parse_args()
    asyncio.run(bootstrap(args.email))
