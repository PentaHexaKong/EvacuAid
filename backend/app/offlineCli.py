import argparse
import asyncio
import json
import os
import time
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.offline.builder import build
from app.offline.store import enqueue, root, write_json


async def prepare_map(args):
    import httpx
    from datetime import datetime, timezone
    west, south, east, north = [float(v) for v in args.bbox.split(',')]
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError('Invalid bbox')
    if (east - west) * (north - south) > 0.01:
        raise ValueError('Prepare a smaller map extent (maximum 0.01 square degrees)')
    query = f'[out:json][timeout:60];way["highway"]({south},{west},{north},{east});out geom;'
    data = bytearray()
    async with httpx.AsyncClient(timeout=90) as client:
        async with client.stream('POST', args.source_url, data={'data': query}, headers={'User-Agent': 'EvacuAid-offline-package-builder/1'}) as response:
            response.raise_for_status()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > 16 * 1024 * 1024:
                    raise ValueError('Map export exceeds the region limit')
    document = json.loads(data)
    features = [{'type': 'Feature', 'properties': {},
                 'geometry': {'type': 'LineString', 'coordinates': [[p['lon'], p['lat']] for p in way['geometry']]}}
                for way in document['elements'] if way.get('type') == 'way' and len(way.get('geometry', [])) >= 2]
    if not features or len(features) > 10000:
        raise ValueError('Empty or oversized map export')
    path = Path(args.output)
    if path.exists():
        raise ValueError('Use a new map version path; do not overwrite static input during a build')
    write_json(path, {'type': 'FeatureCollection', 'features': features})
    provenance = {'coverageBbox': [west, south, east, north],
                  'mapSourceUrl': args.source_url,
                  'mapAttribution': '© OpenStreetMap contributors, ODbL 1.0',
                  'mapDatasetGeneratedAt': document.get('osm3s', {}).get('timestamp_osm_base'),
                  'mapDownloadedAt': datetime.now(timezone.utc).isoformat()}
    write_json(path.with_suffix(path.suffix + '.provenance.json'), provenance)
    print(json.dumps(provenance))


async def work(once=False):
    jobs = root() / 'jobs'
    jobs.mkdir(parents=True, exist_ok=True)
    # One worker per package directory. OS lock is released automatically on crash.
    lock = (root() / 'worker.lock').open('a+b')
    try:
        if os.name == 'nt':
            import msvcrt
            lock.write(b'0'); lock.flush(); lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        while True:
            for path in sorted(jobs.glob('*.json')):
                job = json.loads(path.read_text())
                if job['status'] not in {'QUEUED', 'BUILDING'}:
                    continue
                job['status'] = 'BUILDING'
                job['startedAt'] = time.time()
                write_json(path, job)
                try:
                    manifest = await build(job)
                    job.update(status='READY', packageId=manifest['packageId'])
                except Exception:
                    # Detailed diagnostics stay in server logs, never public status.
                    import logging
                    logging.exception('Offline package build failed: %s', job['jobId'])
                    job.update(status='FAILED', error='Package build failed; check worker logs')
                job['finishedAt'] = time.time()
                write_json(path, job)
            if once:
                break
            await asyncio.sleep(5)
    finally:
        lock.close()


def main():
    parser = argparse.ArgumentParser(description='Regional packages: trusted operator build pipeline')
    commands = parser.add_subparsers(dest='command', required=True)
    key = commands.add_parser('keygen')
    key.add_argument('--private', required=True)
    commands.add_parser('enqueue').add_argument('region_id')
    worker = commands.add_parser('worker')
    worker.add_argument('--once', action='store_true')
    prepare = commands.add_parser('prepare-map')
    prepare.add_argument('--bbox', required=True, help='west,south,east,north')
    prepare.add_argument('--output', required=True)
    prepare.add_argument('--source-url', default='https://overpass-api.de/api/interpreter')
    args = parser.parse_args()
    if args.command == 'keygen':
        key = Ed25519PrivateKey.generate()
        path = Path(args.private)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Never replace an existing key; pin the public key in the app build.
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        print(key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex())
    elif args.command == 'enqueue':
        print(json.dumps(enqueue(args.region_id)))
    elif args.command == 'prepare-map':
        asyncio.run(prepare_map(args))
    else:
        asyncio.run(work(args.once))


if __name__ == '__main__':
    main()
