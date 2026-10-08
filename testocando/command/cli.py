import argparse
import asyncio
import json
from pathlib import Path

from app.db.session import SessionLocal, engine
from command.aggregation import refreshSnapshots
from command.importer import importRegions


async def run(args):
    try:
        async with SessionLocal() as session,session.begin():
            if args.action=='import':
                document=json.loads(Path(args.path).read_text(encoding='utf-8'))
                print(f'Imported {await importRegions(session,document)} regions')
            print(f'Refreshed {await refreshSnapshots(session)} regional snapshots')
    finally:
        await engine.dispose()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description='Import reference regions or refresh command projections')
    subparsers=parser.add_subparsers(dest='action',required=True)
    subparsers.add_parser('import').add_argument('path')
    subparsers.add_parser('refresh')
    asyncio.run(run(parser.parse_args()))
