"""Dummy official warnings for testing the app's alert flow.

    python scripts/simulate_alerts.py siaga                 # centred on the most recently located user
    python scripts/simulate_alerts.py awas --hazard EARTHQUAKE --lat -6.2 --lon 106.8 --radius-km 2
    python scripts/simulate_alerts.py clear

Steps are waspada -> siaga -> awas; each one upserts the same warning, so running them in order escalates it.
Every step also resets answers and push deliveries for the warning, so the emergency pop-up and push fire again.
Rows use source DEMO_SIMULATION and an ACTIVE_WARNING record (what /v1/alerts reads); `clear` removes only those.
"""
import argparse
import asyncio

from app.db.session import SessionLocal, engine
from app.models.hazard import HazardType
from app.services.alertService import alertKey
from app.services.alertSimulation import SEVERITY, apply, clear


async def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('step', choices=[*SEVERITY, 'clear'])
    parser.add_argument('--hazard', choices=[value.value for value in HazardType], default='FLOOD')
    parser.add_argument('--lat', type=float)
    parser.add_argument('--lon', type=float)
    parser.add_argument('--radius-km', type=float, default=3.0)
    parser.add_argument('--hours', type=float, default=2.0, help='how long the warning stays active')
    parser.add_argument('--area')
    args = parser.parse_args()
    if (args.lat is None) != (args.lon is None):
        parser.error('--lat and --lon go together')
    async with SessionLocal() as session:
        if args.step == 'clear':
            print(f'removed {await clear(session)} simulated warning(s)')
        else:
            row, (latitude, longitude) = await apply(session, args.step, args.hazard, (args.lat, args.lon) if args.lat is not None else None, args.radius_km, args.hours, args.area)
            print(f'{args.step.upper()} {args.hazard} around {latitude:.5f},{longitude:.5f} (+/-{args.radius_km} km) for {args.hours} h; alert id {alertKey(row)}')
    await engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
