from shapely.geometry import Point

from app.models.hazard import Authority, EvidenceType
from app.models.risk import OfficialWarningContext
from app.repositories import hazardRepository
from app.utils.hazardGeometry import validGeometry


async def officialWarningForLocation(session, latitude: float, longitude: float) -> OfficialWarningContext | None:
    evidence = await hazardRepository.activeEvidence(session, (latitude, longitude), 1)
    point = Point(longitude, latitude)
    warnings = []
    for item in evidence:
        zone = validGeometry(item.geometry)
        status = item.metadata.get('officialStatus')
        if item.authority == Authority.OFFICIAL and item.evidenceType in {EvidenceType.ACTIVE_WARNING, EvidenceType.CRITICAL_HAZARD} and status in {'AWAS', 'SIAGA'} and zone is not None and zone.covers(point):
            warnings.append(OfficialWarningContext(status=status, hazardType=item.hazardType.value, source=item.source))
    return min(warnings, key=lambda item: item.status.value != 'AWAS') if warnings else None
