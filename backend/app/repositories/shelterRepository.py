import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from geoalchemy2 import Geography

from app.db.models import Shelter


async def getShelter(session: AsyncSession, shelterId: uuid.UUID) -> Shelter | None:
    return (await session.execute(select(Shelter).where(Shelter.id == shelterId))).scalar_one_or_none()


async def nearbyShelters(session: AsyncSession, latitude: float, longitude: float, radiusM: float, limit: int) -> list[tuple[Shelter, float]]:
    point = func.ST_SetSRID(func.ST_MakePoint(longitude, latitude), 4326).cast(Geography(geometry_type='POINT', srid=4326))
    distance = func.ST_Distance(Shelter.location, point).label('distanceM')
    query = select(Shelter, distance).where(func.ST_DWithin(Shelter.location, point, radiusM)).order_by(distance).limit(limit)
    return [(shelter, float(distanceM)) for shelter, distanceM in (await session.execute(query)).all()]
