import argparse
import asyncio
from pathlib import Path

from redis.asyncio import Redis

from app import config
from app.db.session import SessionLocal, engine
from app.repositories import externalDataRepository, hazardRepository
from app.services.cacheService import CacheService
from app.services.hazardIngestionService import LIVE_SOURCES, refreshSource
from app.services.inariskProvider import baselineFromGeojson, baselineFromRaster, prepareInarisk


async def run(args):
    client = Redis.from_url(config.REDIS_URL, decode_responses=True)
    cache = CacheService(client)
    try:
        if args.command == 'prepare-inarisk':
            await prepareInarisk(args.hazard, args.bbox, args.output, args.service_url)
            print(f'Prepared {args.output} with provenance manifest')
        elif args.command == 'import-inarisk':
            if Path(args.path).suffix.lower() in {'.tif', '.tiff'}:
                if args.minimum is None:
                    raise ValueError('raster import requires an explicit experimental --minimum source-value threshold')
                items = await asyncio.to_thread(baselineFromRaster, args.path, args.hazard, args.source_url, args.minimum)
            else:
                items = await asyncio.to_thread(baselineFromGeojson, args.path, args.hazard, args.source_url, args.severity_field)
            async with SessionLocal() as session:
                scope = args.scope or f'{args.hazard}:{args.source_url}:{Path(args.path).name}'
                await hazardRepository.replaceStaticScope(session, 'INARISK', scope, items)
                from datetime import datetime, timezone
                counts = await hazardRepository.evidenceCounts(session, 'INARISK')
                await externalDataRepository.saveSnapshot(session, 'HAZARD_INARISK', 'STATUS', {'status': 'available', 'lastSuccessAt': datetime.now(timezone.utc).isoformat(), 'evidenceCount': sum(counts.values()), 'evidenceByHazard': counts, 'sourceUrl': args.source_url})
                await session.commit()
            print(f'Imported {len(items)} baseline geometries; no active disaster inferred')
        elif args.command == 'inspect-dem':
            from app.services.elevationProvider import ElevationProvider
            profile = await asyncio.to_thread(ElevationProvider().sample, [[args.longitude, args.latitude]])
            print(profile)
            if profile.elevations[0] is None:
                raise ValueError('DEM is unconfigured, uncovered or invalid')
        elif args.command == 'prepare-dem':
            from app.services.demPreparation import prepareDem
            await asyncio.to_thread(prepareDem, args.path, args.output, args.source, args.source_url, args.vertical_datum)
            print(f'Prepared {args.output} with provenance manifest; configure DEM_ASSET_PATH, DEM_SOURCE and DEM_VERTICAL_DATUM')
        elif args.command == 'import-evidence':
            import json
            from app.models.hazard import HazardEvidence
            payload = json.loads(Path(args.path).read_text())
            if not isinstance(payload, list) or len(payload) > config.HAZARD_MAX_EVIDENCE:
                raise ValueError('expected a bounded list of normalized evidence')
            items = [HazardEvidence.model_validate(item) for item in payload]
            if any(not item.metadata.get('sourceUrl') or not item.metadata.get('attribution') for item in items):
                raise ValueError('import requires sourceUrl and attribution provenance for every record')
            async with SessionLocal() as session:
                await hazardRepository.saveEvidence(session, items)
                await session.commit()
            print(f'Imported {len(items)} evidence records; source authority must be independently verified')
        else:
            while True:
                for source in LIVE_SOURCES:
                    async with SessionLocal() as session:
                        status = await refreshSource(session, source, cache, force=args.force)
                        print(f"{source}: {status['status']}")
                if not args.loop:
                    break
                await asyncio.sleep(60)
    finally:
        await client.aclose()
        await engine.dispose()


def main():
    from app.utils.observability import configureLogging
    configureLogging()
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='command', required=True)
    prepare = commands.add_parser('prepare-inarisk')
    prepare.add_argument('--hazard', choices=list(config.HAZARD_SIGMAS), required=True)
    prepare.add_argument('--bbox', required=True)
    prepare.add_argument('--output', required=True)
    prepare.add_argument('--service-url')
    ingest = commands.add_parser('import-inarisk')
    ingest.add_argument('--hazard', choices=list(config.HAZARD_SIGMAS), required=True)
    ingest.add_argument('--path', required=True)
    ingest.add_argument('--source-url', required=True)
    ingest.add_argument('--minimum', type=float)
    ingest.add_argument('--severity-field')
    ingest.add_argument('--scope')
    refresh = commands.add_parser('refresh')
    refresh.add_argument('--loop', action='store_true')
    refresh.add_argument('--force', action='store_true')
    evidence = commands.add_parser('import-evidence')
    evidence.add_argument('--path', required=True)
    dem = commands.add_parser('inspect-dem')
    dem.add_argument('--latitude', type=float, required=True)
    dem.add_argument('--longitude', type=float, required=True)
    prepareDem = commands.add_parser('prepare-dem')
    prepareDem.add_argument('--path', required=True)
    prepareDem.add_argument('--output', required=True)
    prepareDem.add_argument('--source', required=True)
    prepareDem.add_argument('--source-url', required=True)
    prepareDem.add_argument('--vertical-datum', required=True)
    args = parser.parse_args()
    try:
        asyncio.run(run(args))
    except Exception as error:
        parser.exit(1, f'{args.command} failed: {type(error).__name__}\n')


if __name__ == '__main__':
    main()
