import asyncio

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


async def main() -> None:
    async with SessionLocal() as session:
        for name, latitude, longitude, status, wheelchairAccessible, capacity, currentOccupancy in SHELTERS:
            if (await session.execute(select(Shelter.id).where(Shelter.name == name))).first() is not None:
                print(f'skip {name}')
                continue
            entrance = {}
            if name == 'Titik Kumpul Contoh A':
                entrance = dict(entranceLatitude=-6.20095, entranceLongitude=106.8020, entranceNote='North gate, ramp on the left')
            elif name == 'Titik Kumpul Contoh B':
                entrance = dict(entranceLatitude=-6.1950, entranceLongitude=106.81505, entranceNote='East gate, entrance straight ahead')
            await shelterService.createShelter(session, ShelterCreate(name=name, latitude=latitude, longitude=longitude, shelterType='GATHERING_POINT', status=status, wheelchairAccessible=wheelchairAccessible, capacity=capacity, currentOccupancy=currentOccupancy, source='DEMO_FIXTURE', **entrance))
            print(f'created {name}')
    await engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
