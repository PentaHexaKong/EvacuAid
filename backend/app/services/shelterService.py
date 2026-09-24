from geoalchemy2.elements import WKTElement
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Shelter
from app.models.shelter import NearbyShelterResponse, ShelterCreate, ShelterResponse
from app.repositories import shelterRepository


def shelterResponse(shelter: Shelter) -> ShelterResponse:
    return ShelterResponse(id=shelter.id, name=shelter.name, latitude=shelter.latitude, longitude=shelter.longitude, status=shelter.status, wheelchairAccessible=shelter.wheelchairAccessible, capacity=shelter.capacity, currentOccupancy=shelter.currentOccupancy, source=shelter.source)


async def createShelter(session: AsyncSession, payload: ShelterCreate) -> Shelter:
    shelter = Shelter(**payload.model_dump(), location=WKTElement(f'POINT({payload.longitude} {payload.latitude})', srid=4326))
    session.add(shelter)
    await session.commit()
    await session.refresh(shelter)
    return shelter


async def nearbyShelters(session: AsyncSession, latitude: float, longitude: float, radiusM: float, limit: int) -> list[NearbyShelterResponse]:
    rows = await shelterRepository.nearbyShelters(session, latitude, longitude, radiusM, limit)
    return [NearbyShelterResponse(**shelterResponse(shelter).model_dump(), distanceM=round(distanceM, 2)) for shelter, distanceM in rows]


def suitabilityReasons(shelter: Shelter, mobilityRequired: bool) -> tuple[bool, list[str]]:
    if shelter.status == 'CLOSED':
        return False, ['SHELTER_CLOSED']
    if shelter.status == 'FULL':
        return False, ['SHELTER_FULL']
    if shelter.capacity is not None and shelter.currentOccupancy is not None and shelter.currentOccupancy >= shelter.capacity:
        return False, ['SHELTER_CAPACITY_EXHAUSTED']
    if mobilityRequired and shelter.wheelchairAccessible is False:
        return False, ['WHEELCHAIR_INACCESSIBLE']
    reasons = ['SHELTER_OPEN'] if shelter.status == 'OPEN' else ['SHELTER_STATUS_UNKNOWN']
    if shelter.capacity is not None and shelter.currentOccupancy is not None:
        reasons.append('SHELTER_CAPACITY_AVAILABLE')
    elif shelter.capacity is None or shelter.currentOccupancy is None:
        reasons.append('CAPACITY_UNKNOWN')
    if mobilityRequired:
        reasons.append('WHEELCHAIR_ACCESSIBLE' if shelter.wheelchairAccessible else 'ACCESSIBILITY_UNKNOWN')
    return True, reasons
