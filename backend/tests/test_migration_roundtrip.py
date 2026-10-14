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
    await dbSession.execute(text("UPDATE users SET name = 'Preserved profile', phone = '08123' WHERE id = :id"), {'id':owner_id})
    await dbSession.execute(text("INSERT INTO user_accessibility (id, user_id, type) VALUES (:id, :user, 'VISUAL_IMPAIRMENT')"), {'id':uuid.uuid4(), 'user':owner_id})
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
        assert (await connection.execute(text('SELECT name, phone, role, email FROM users WHERE id = :id'), {'id':owner_id})).one() == ('Preserved profile','08123','CITIZEN',None)
        assert (await connection.execute(text('SELECT type FROM user_accessibility WHERE user_id = :id'), {'id':owner_id})).scalar_one() == 'VISUAL_IMPAIRMENT'
        columns = (await connection.execute(text("SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('users', 'pilot_invitations', 'buddy_relationships')"))).all()
        assert ('users', 'buddy_code', 'YES') in columns
        assert ('pilot_invitations', 'code_hash', 'YES') in columns
        assert ('pilot_invitations', 'direction', 'NO') in columns
        assert ('pilot_invitations', 'relation', 'YES') in columns
        assert ('buddy_relationships', 'relation', 'YES') in columns
        assert (await connection.execute(text('SELECT direction FROM pilot_invitations WHERE id = :id'), {'id': legacy_id})).scalar_one() == 'SEEK_HELP'


@pytest.mark.asyncio
async def test_buddy_beacons_upgrade_downgrade(dbSession):
    from app.db.session import engine

    async with engine.connect() as connection:
        current = set((await connection.execute(text('SELECT version_num FROM alembic_version'))).scalars())
    backend_revisions = {revision.revision for revision in ScriptDirectory.from_config(Config(str(BACKEND / 'alembic.ini'))).walk_revisions()}
    config = BACKEND / 'alembic.ini' if current <= backend_revisions else COMBINED

    async def migrate(revision):
        process = await asyncio.create_subprocess_exec('alembic', '-c', str(config), *revision, cwd=BACKEND, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, stderr = await process.communicate()
        assert process.returncode == 0, (stdout + stderr).decode()

    owner, gps, ble, request, gps_attempt, ble_attempt = [uuid.uuid4() for _ in range(6)]
    await dbSession.execute(text("INSERT INTO users (id, name, needs_assistance, share_location_with_buddies, beacon_id) VALUES (:owner, 'Synthetic beacon profile', false, false, 4294967295), (:gps, NULL, false, false, 1), (:ble, NULL, false, false, NULL)"), {'owner': owner, 'gps': gps, 'ble': ble})
    await dbSession.execute(text("INSERT INTO assistance_requests (id, user_id, status, pilot, nearby, nearby_started_at) VALUES (:request, :owner, 'WAITING', true, true, now())"), {'request': request, 'owner': owner})
    await dbSession.execute(text("INSERT INTO pilot_attempts (id, request_id, helper_id, status, source, expires_at, created_at) VALUES (:gps_attempt, :request, :gps, 'PENDING', 'GPS', now() + interval '1 minute', now() - interval '1 second'), (:ble_attempt, :request, :ble, 'PENDING', 'BLE', now() + interval '1 minute', now())"), {'request': request, 'gps': gps, 'ble': ble, 'gps_attempt': gps_attempt, 'ble_attempt': ble_attempt})
    await dbSession.commit()
    try:
        await migrate(('downgrade', '20261012_16_operations'))
        async with engine.connect() as connection:
            columns = (await connection.execute(text("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('beacon_id','source','nearby_started_at')"))).all()
            assert ('users', 'beacon_id') not in columns
            assert ('pilot_attempts', 'source') not in columns
            assert ('assistance_requests', 'nearby_started_at') not in columns
            attempts = dict((await connection.execute(text('SELECT id, status FROM pilot_attempts WHERE request_id = :request'), {'request': request})).all())
            assert attempts == {gps_attempt: 'PENDING', ble_attempt: 'CANCELLED'}
            assert (await connection.execute(text('SELECT name FROM users WHERE id = :id'), {'id': owner})).scalar_one() == 'Synthetic beacon profile'
    finally:
        await migrate(('upgrade', 'head'))
    async with engine.connect() as connection:
        assert (await connection.execute(text('SELECT source FROM pilot_attempts WHERE id = :id'), {'id': gps_attempt})).scalar_one() == 'GPS'
        assert (await connection.execute(text('SELECT beacon_id FROM users WHERE id = :id'), {'id': owner})).scalar_one() is None
        assert (await connection.execute(text('SELECT nearby_started_at IS NOT NULL FROM assistance_requests WHERE id = :id'), {'id': request})).scalar_one()
        assert (await connection.execute(text("SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_pilot_pending_attempt'"))).scalar_one().endswith("(request_id, helper_id) WHERE ((status)::text = 'PENDING'::text)")
