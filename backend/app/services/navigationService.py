import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.navigation import AccessibilityStatus, HazardStatus, NavigationCreate, NavigationDestination, NavigationEvaluation, NavigationResponse, NavigationRoute, NavigationStatus, RejectedShelter
from app.repositories import shelterRepository
from app.services import shelterService, user_service
from app.services.petabencana_service import fetch_reports
from app.services.valhallaProvider import NoRoute, RoutingUnavailable, ValhallaRoutingProvider, isValidLineString
from app.utils.geo import calculate_distance_meters


async def navigationForUser(session: AsyncSession, payload: NavigationCreate, provider: ValhallaRoutingProvider | None = None) -> NavigationResponse:
    user = await user_service.require_user(session, payload.userId, include_relations=True)
    if payload.origin is not None:
        originLatitude, originLongitude = payload.origin.latitude, payload.origin.longitude
    elif user.latitude is None or user.longitude is None or user.locationObservedAt is None:
        raise HTTPException(status_code=409, detail='user location is required for navigation')
    elif user.locationObservedAt < datetime.now(timezone.utc) - timedelta(minutes=15):
        raise HTTPException(status_code=409, detail='user location is stale; update location')
    else:
        originLatitude, originLongitude = user.latitude, user.longitude
    mobilityRequired = any(item.type == 'MOBILITY_LIMITATION' for item in user.accessibility)
    rejected: list[RejectedShelter] = []
    if payload.destinationShelterId:
        shelter = await shelterRepository.getShelter(session, payload.destinationShelterId)
        if shelter is None:
            raise HTTPException(status_code=404, detail='shelter not found')
        candidates = [(shelter, 0.0)]
    else:
        candidates = await shelterRepository.nearbyShelters(session, originLatitude, originLongitude, 10000, 25)
    viable = []
    for shelter, distanceM in candidates:
        suitable, reasons = shelterService.suitabilityReasons(shelter, mobilityRequired)
        if suitable:
            viable.append((shelter, distanceM, reasons))
        else:
            rejected.append(RejectedShelter(shelterId=shelter.id, reasonCodes=reasons))
    if not viable:
        return NavigationResponse(routeStatus=NavigationStatus.UNAVAILABLE, selectionReasonCodes=['NO_SUITABLE_SHELTER'], rejectedCandidates=rejected)
    viable.sort(key=lambda candidate: (candidate[1], str(candidate[0].id)))
    routing = provider or ValhallaRoutingProvider()
    for shelter, _, reasons in viable[:3]:
        try:
            route = await routing.route((originLatitude, originLongitude), (shelter.latitude, shelter.longitude))
        except RoutingUnavailable:
            return NavigationResponse(routeStatus=NavigationStatus.UNAVAILABLE, selectionReasonCodes=['ROUTING_PROVIDER_UNAVAILABLE'], rejectedCandidates=rejected)
        except NoRoute:
            rejected.append(RejectedShelter(shelterId=shelter.id, reasonCodes=['NO_ROUTE_AVAILABLE']))
            continue
        accessibilityStatus, accessibilityReasons = routeAccessibility(mobilityRequired)
        hazardStatus, hazardReasons = await routeHazards(route.geometry)
        evaluationReasons = reasons + ['ROUTE_AVAILABLE'] + accessibilityReasons + hazardReasons
        return NavigationResponse(routeStatus=NavigationStatus.READY, destination=NavigationDestination(shelterId=shelter.id, name=shelter.name, latitude=shelter.latitude, longitude=shelter.longitude, source=shelter.source), route=NavigationRoute(distanceM=route.distanceM, durationSec=route.durationSec, geometry=route.geometry), evaluation=NavigationEvaluation(safetyStatus=hazardStatus, accessibilityStatus=accessibilityStatus, reasonCodes=evaluationReasons), selectionReasonCodes=evaluationReasons + ['LOWEST_DISTANCE_AMONG_SUITABLE_SHELTERS'], rejectedCandidates=rejected)
    return NavigationResponse(routeStatus=NavigationStatus.UNAVAILABLE, selectionReasonCodes=['NO_ROUTE_AVAILABLE'], rejectedCandidates=rejected)


def routeAccessibility(mobilityRequired: bool) -> tuple[AccessibilityStatus, list[str]]:
    if mobilityRequired:
        return AccessibilityStatus.UNKNOWN, ['MOBILITY_REQUIREMENT_PRESENT', 'ROUTE_ACCESSIBILITY_UNKNOWN']
    return AccessibilityStatus.COMPATIBLE, ['ROUTE_PEDESTRIAN_ACCESS']


async def routeHazards(geometry: dict) -> tuple[HazardStatus, list[str]]:
    if not isValidLineString(geometry):
        return HazardStatus.UNKNOWN, ['ROUTE_GEOMETRY_INVALID']
    coordinates = geometry['coordinates']
    reportsResult = await fetch_reports()
    if not reportsResult.available:
        return HazardStatus.UNKNOWN, ['HAZARD_DATA_UNAVAILABLE']
    for report in reportsResult.reports or []:
        if report.get('latitude') is None or report.get('longitude') is None:
            continue
        for longitude, latitude, *_ in coordinates:
            if calculate_distance_meters(latitude, longitude, report['latitude'], report['longitude']) <= 100:
                return HazardStatus.POTENTIALLY_EXPOSED, ['POTENTIAL_HAZARD_EXPOSURE', 'CITIZEN_REPORT_SUPPORTING_EVIDENCE']
    return HazardStatus.NO_KNOWN_HAZARD, ['NO_KNOWN_HAZARD_INTERSECTION']
