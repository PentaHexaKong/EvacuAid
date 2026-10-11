import json
import os
import uuid
from pathlib import Path

from app.config import DATA_DIR
from app.offline.manifest import canonical


def root() -> Path:
    return Path(os.environ.get('OFFLINE_PACKAGE_DIR', str(DATA_DIR / 'offline-packages')))


def write_json(path: Path, document: dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('wb') as stream:
            stream.write(canonical(document))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def enqueue(region_id: str) -> dict:
    region_id = str(uuid.UUID(region_id))
    job = {'jobId': uuid.uuid4().hex, 'regionId': region_id, 'status': 'QUEUED'}
    write_json(root() / 'jobs' / (job['jobId'] + '.json'), job)
    return job


def latest(region_id: str) -> dict | None:
    pointer = root() / 'regions' / str(uuid.UUID(region_id)) / 'latest.json'
    if not pointer.exists():
        return None
    package_id = json.loads(pointer.read_text())['packageId']
    return json.loads((root() / 'packages' / package_id / 'manifest.json').read_text())
