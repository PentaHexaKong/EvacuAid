import asyncio
import json
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.auth import require_roles
from app.offline.store import latest, root

router = APIRouter(prefix='/v1/offline', tags=['offline'])


@router.get('/packages/{regionId}/build-status', dependencies=[Depends(require_roles('ADMIN'))])
async def build_status(regionId: uuid.UUID):
    def read():
        jobs = []
        for path in (root() / 'jobs').glob('*.json'):
            document = json.loads(path.read_text())
            if document['regionId'] == str(regionId):
                jobs.append(document)
        return sorted(jobs, key=lambda job: job.get('startedAt', 0), reverse=True)[:20]
    return {'jobs': await asyncio.to_thread(read)}


@router.get('/regions')
async def regions(session: AsyncSession = Depends(get_session), limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    rows = (await session.execute(text("""
        SELECT id, name, code FROM command_regions WHERE data_mode='REFERENCE'
        ORDER BY code LIMIT :limit OFFSET :offset
    """), {'limit': limit, 'offset': offset})).mappings().all()
    async def describe(row):
        manifest = await asyncio.to_thread(latest, str(row['id']))
        return {'regionId': str(row['id']), 'regionName': row['name'], 'code': row['code'],
                'buildStatus': 'READY' if manifest else 'NOT_BUILT', 'manifest': manifest}
    return {'regions': await asyncio.gather(*(describe(row) for row in rows)), 'limit': limit, 'offset': offset}


@router.get('/packages/{regionId}/manifest')
async def manifest(regionId: uuid.UUID):
    document = await asyncio.to_thread(latest, str(regionId))
    if document is None:
        raise HTTPException(404, 'Regional package has not been built')
    return document


@router.get('/packages/{regionId}/download')
async def download(regionId: uuid.UUID):
    document = await manifest(regionId)
    # Starlette streams from disk and handles byte Range requests.
    return FileResponse(root() / 'packages' / document['packageId'] / 'package.zip',
                        media_type='application/zip', filename=f"evacuaid-{regionId}.zip")


@router.get('/packages/{regionId}/assets/{checksum}')
async def asset(regionId: uuid.UUID, checksum: str, packageId: str = Query(pattern=r'^[a-f0-9]{64}$')):
    if not re.fullmatch(r'[a-f0-9]{64}', checksum):
        raise HTTPException(404, 'Asset not found')
    path = root() / 'packages' / packageId / 'manifest.json'
    if not path.exists():
        raise HTTPException(404, 'Package not found')
    document = await asyncio.to_thread(lambda: json.loads(path.read_text()))
    if document['regionId'] != str(regionId) or checksum not in document['contentChecksums'].values():
        raise HTTPException(404, 'Asset not found')
    return FileResponse(root() / 'objects' / checksum, media_type='application/octet-stream',
                        headers={'ETag': '"' + checksum + '"', 'Cache-Control': 'public, max-age=31536000, immutable'})
