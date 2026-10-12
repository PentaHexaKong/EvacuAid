from geoalchemy2.elements import WKTElement
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Shelter
from app.models.shelter import NearbyShelterResponse, ShelterCreate, ShelterResponse
from app.repositories import shelterRepository


def shelterResponse(shelter: Shelter) -> ShelterResponse:
    return ShelterResponse(id=shelter.id, name=shelter.name, latitude=shelter.latitude, longitude=shelter.longitude, entranceLatitude=shelter.entranceLatitude, entranceLongitude=shelter.entranceLongitude, entranceNote=shelter.entranceNote, status='UNKNOWN' if shelter.status == 'FULL' else shelter.status, wheelchairAccessible=shelter.wheelchairAccessible, capacity=shelter.capacity, source=shelter.source)


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
    if mobilityRequired and shelter.wheelchairAccessible is False:
        return False, ['WHEELCHAIR_INACCESSIBLE']
    reasons = ['SHELTER_OPEN'] if shelter.status == 'OPEN' else ['SHELTER_STATUS_UNKNOWN']
    if mobilityRequired:
        reasons.append('WHEELCHAIR_ACCESSIBLE' if shelter.wheelchairAccessible else 'ACCESSIBILITY_UNKNOWN')
    return True, reasons
