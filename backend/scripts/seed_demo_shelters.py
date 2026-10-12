import asyncio
import sys

from sqlalchemy import select

from app.db.models import Shelter
from app.db.session import SessionLocal, engine
from app.models.shelter import ShelterCreate
from app.services import shelterService


SHELTERS = [
    ('Titik Kumpul Contoh A', -6.2010, 106.8020, 'OPEN', True, 200, 40),
    ('Titik Kumpul Contoh B', -6.1950, 106.8150, 'OPEN', False, 120, 60),
    ('Titik Kumpul Contoh C', -6.2150, 106.7900, 'OPEN', None, 80, 10),
    ('Titik Kumpul Contoh D', -6.1800, 106.8000, 'FULL', True, 100, 100),
    ('Titik Kumpul Contoh E', -6.2250, 106.8200, 'OPEN', True, 300, 150),
    ('Titik Kumpul Contoh F', -6.2050, 106.7750, 'UNKNOWN', None, None, None),
]

# `python -m scripts.seed_demo_shelters LAT LON` shifts the same six points to be centred on LAT LON ("Dekat" names).
# ponytail: plain degree offsets, fine at city scale; rerunning at the same spot skips, elsewhere adds a new set.
ANCHOR = (-6.2, 106.8)


async def main() -> None:
    dLat = dLon = 0.0
    prefix = 'Contoh'
    if len(sys.argv) == 3:
        dLat, dLon = float(sys.argv[1]) - ANCHOR[0], float(sys.argv[2]) - ANCHOR[1]
        prefix = 'Dekat'
    async with SessionLocal() as session:
        for name, latitude, longitude, status, wheelchairAccessible, capacity, currentOccupancy in SHELTERS:
            isNameA, isNameB = name.endswith('Contoh A'), name.endswith('Contoh B')
            name = name.replace('Contoh', prefix)
            latitude, longitude = round(latitude + dLat, 6), round(longitude + dLon, 6)
            if (await session.execute(select(Shelter.id).where(Shelter.name == name, Shelter.latitude == latitude, Shelter.longitude == longitude))).first() is not None:
                print(f'skip {name}')
                continue
            entrance = {}
            if isNameA:
                entrance = dict(entranceLatitude=round(-6.20095 + dLat, 6), entranceLongitude=round(106.8020 + dLon, 6), entranceNote='North gate, ramp on the left')
            elif isNameB:
                entrance = dict(entranceLatitude=round(-6.1950 + dLat, 6), entranceLongitude=round(106.81505 + dLon, 6), entranceNote='East gate, entrance straight ahead')
            await shelterService.createShelter(session, ShelterCreate(name=name, latitude=latitude, longitude=longitude, shelterType='GATHERING_POINT', status=status, wheelchairAccessible=wheelchairAccessible, capacity=capacity, currentOccupancy=currentOccupancy, source='DEMO_FIXTURE', **entrance))
            print(f'created {name}')
    await engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
