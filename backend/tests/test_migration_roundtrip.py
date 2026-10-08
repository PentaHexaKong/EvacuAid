from pathlib import Path
import asyncio
import uuid

from alembic.config import Config
from alembic.script import ScriptDirectory
import pytest
from sqlalchemy import text

BACKEND = Path(__file__).parents[1]
COMBINED = BACKEND.parent / 'testocando' / 'alembic.ini'


@pytest.mark.asyncio
async def test_direct_invitation_upgrade_downgrade(dbSession):
    from app.db.session import engine

    async with engine.connect() as connection:
        current = set((await connection.execute(text('SELECT version_num FROM alembic_version'))).scalars())
    backend_revisions = {revision.revision for revision in ScriptDirectory.from_config(Config(str(BACKEND / 'alembic.ini'))).walk_revisions()}
    config = BACKEND / 'alembic.ini' if current <= backend_revisions else COMBINED

    async def migrate(revision):
        process = await asyncio.create_subprocess_exec('alembic', '-c', str(config), *revision, cwd=BACKEND, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, stderr = await process.communicate()
        assert process.returncode == 0, (stdout + stderr).decode()

    owner_id, target_id, legacy_id, direct_id = [uuid.uuid4() for _ in range(4)]
    await dbSession.execute(text("INSERT INTO users (id, needs_assistance, share_location_with_buddies, buddy_code) VALUES (:owner, false, false, '2345-6789'), (:target, false, false, NULL)"), {'owner': owner_id, 'target': target_id})
    await dbSession.execute(text("INSERT INTO pilot_invitations (id, owner_id, redeemer_id, code_hash, status, expires_at) VALUES (:legacy, :owner, NULL, :hash, 'PENDING', now() + interval '1 day')"), {'legacy': legacy_id, 'owner': owner_id, 'hash': 'a' * 64})
    await dbSession.execute(text("INSERT INTO pilot_invitations (id, owner_id, redeemer_id, code_hash, status, direction, relation, expires_at) VALUES (:direct, :owner, :target, NULL, 'SENT', 'OFFER_HELP', 'TEMAN', now() + interval '7 days')"), {'direct': direct_id, 'owner': owner_id, 'target': target_id})
    await dbSession.commit()
    try:
        await migrate(('downgrade', '20261005_06'))
        async with engine.connect() as connection:
            rows = (await connection.execute(text('SELECT id FROM pilot_invitations'))).scalars().all()
            assert rows == [legacy_id]
            columns = (await connection.execute(text("SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('users', 'pilot_invitations', 'buddy_relationships')"))).all()
            assert ('pilot_invitations', 'code_hash', 'NO') in columns
            assert not any(name in ('buddy_code', 'direction', 'relation') for table, name, nullable in columns)
    finally:
        await migrate(('upgrade', 'head'))
    async with engine.connect() as connection:
        columns = (await connection.execute(text("SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('users', 'pilot_invitations', 'buddy_relationships')"))).all()
        assert ('users', 'buddy_code', 'YES') in columns
        assert ('pilot_invitations', 'code_hash', 'YES') in columns
        assert ('pilot_invitations', 'direction', 'NO') in columns
        assert ('pilot_invitations', 'relation', 'YES') in columns
        assert ('buddy_relationships', 'relation', 'YES') in columns
        assert (await connection.execute(text('SELECT direction FROM pilot_invitations WHERE id = :id'), {'id': legacy_id})).scalar_one() == 'SEEK_HELP'
