import logging
from datetime import datetime, timedelta, timezone
from time import perf_counter

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import ROUTE_ACCESSIBILITY_TOLERANCE, ROUTE_CROWDSOURCED_CONFIDENCE, ROUTE_CROWDSOURCED_PROBABILITY, ROUTE_CROWDSOURCED_SEVERITY, ROUTE_RISK_TOLERANCE
from app.models.navigation import HazardStatus, NavigationCreate, NavigationDestination, NavigationEvaluation, NavigationPreviewCreate, NavigationPreviewResponse, NavigationResponse, NavigationRoute, NavigationStatus, RejectedShelter, RouteEvidence, RouteEvidenceKind
from app.repositories import shelterRepository
from app.services import externalDataService, shelterService, user_service
from app.services.routeEvaluationService import EvaluatedRoute, applyRanking, candidateResponse, evaluateRoute, rankingKey
from app.services.routeCandidateService import evaluatedCandidates
from app.services.hazardEvaluator import destinationExcluded
from app.models.hazard import HazardEvidence
from app.repositories import hazardRepository
from app.config import HAZARD_SEARCH_METERS, HAZARD_TTLS, HAZARD_UNCERTAINTY_TOLERANCE
from app.services.petabencana_service import fetch_reports
from app.services.valhallaProvider import NoRoute, RoutingUnavailable, ValhallaRoutingProvider, isValidLineString
from app.utils.geo import calculate_distance_meters


logger = logging.getLogger(__name__)


async def authoritativeEvidence(session: AsyncSession, center: tuple[float, float] = (-6.2, 106.8)) -> list[HazardEvidence]:
    return await hazardRepository.activeEvidence(session, center, HAZARD_SEARCH_METERS)


def crowdsourcedEvidence(reports: list[dict] | None, source: str = 'PETABENCANA') -> list[RouteEvidence]:
    evidence = []
    for report in reports or []:
        latitude = report.get('latitude')
        longitude = report.get('longitude')
        if latitude is None or longitude is None:
            continue
        evidence.append(RouteEvidence(
            evidenceKind=RouteEvidenceKind.CROWDSOURCED_REPORT,
            geometry={'type': 'Point', 'coordinates': [longitude, latitude]},
            probability=ROUTE_CROWDSOURCED_PROBABILITY,
            severity=ROUTE_CROWDSOURCED_SEVERITY,
            confidence=ROUTE_CROWDSOURCED_CONFIDENCE,
            source=report.get('source', source),
        ))
    return evidence


async def routeEvidence(session: AsyncSession, scenarioHazards: list | None = None, center: tuple[float, float] = (-6.2, 106.8)) -> list[RouteEvidence | HazardEvidence]:
    reports = await externalDataService.storedReports(session)
    scenarioReports = [
        {'latitude': item.latitude, 'longitude': item.longitude, 'source': 'MAP_SCENARIO'}
        for item in scenarioHazards or []
    ]
    from app.services.hazardProviders import communityEvidence
    from datetime import datetime, timezone
    normalized = await authoritativeEvidence(session, center)
    if not any(item.source == 'PETABENCANA' for item in normalized):
        snapshot = await externalDataService.externalDataRepository.getSnapshot(session, 'PetaBencana', externalDataService.reportsScope())
        if snapshot and (datetime.now(timezone.utc) - snapshot.fetchedAt).total_seconds() > HAZARD_TTLS['PETABENCANA'] * 2:
            reports = []
        normalized += communityEvidence(reports or [], datetime.now(timezone.utc))
    return normalized + crowdsourcedEvidence(scenarioReports, 'MAP_SCENARIO')


def routeResponse(item: EvaluatedRoute) -> tuple[NavigationRoute, NavigationEvaluation]:
    route = NavigationRoute(distanceM=item.route.distanceM, durationSec=item.route.durationSec, geometry=item.route.geometry, routeScore=item.weightedScore or 0)
    evaluation = NavigationEvaluation(safetyStatus=item.hazardStatus, accessibilityStatus=item.accessibilityStatus, reasonCodes=['ROUTE_AVAILABLE'] + item.reasons, closestHazardDistanceM=item.closestHazardDistanceM, hazards=item.hazards)
    return route, evaluation


def selectionReasons(selected: EvaluatedRoute, ranked: list[EvaluatedRoute]) -> list[str]:
    if len(ranked) == 1:
        return ['ONLY_FEASIBLE_ROUTE']
    reasons = ['EARLIER_TSUNAMI_ZONE_EXIT', 'LOWER_HAZARD_EXPOSURE_THAN_ALTERNATIVE', 'LOWER_HAZARD_PROXIMITY_THAN_ALTERNATIVE', 'LOWER_ACCESSIBILITY_PENALTY_THAN_ALTERNATIVE', 'LOWER_UNCERTAINTY_THAN_ALTERNATIVE', 'FASTER_AFTER_SAFETY_TIES', 'DETERMINISTIC_ROUTE_ID_TIE_BREAK']
    for selectedValue, otherValue, reason in zip(rankingKey(selected), rankingKey(ranked[1]), reasons):
        if selectedValue < otherValue:
            return ['LOWEST_LEXICOGRAPHIC_SAFETY_RANK', reason]
    return ['LOWEST_LEXICOGRAPHIC_SAFETY_RANK', 'DETERMINISTIC_ROUTE_ID_TIE_BREAK']


def logEvaluation(result: str, startedAt: float, candidates: list[EvaluatedRoute], selected: EvaluatedRoute | None = None) -> None:
    logger.info('routeEvaluation result=%s durationMs=%s candidates=%s feasible=%s hardRejected=%s selectedRouteId=%s selectedExposure=%s selectedUncertainty=%s', result, round((perf_counter() - startedAt) * 1000, 2), len(candidates), sum(item.feasible for item in candidates), sum('ROUTE_REJECTED_CRITICAL_HAZARD' in item.reasons for item in candidates), selected.routeId if selected else None, selected.hazardExposure if selected else None, selected.uncertainty if selected else None)


async def navigationForUser(session: AsyncSession, payload: NavigationCreate, provider: ValhallaRoutingProvider | None = None) -> NavigationResponse:
    startedAt = perf_counter()
    user = await user_service.require_user(session, payload.userId, include_relations=True)
    if payload.origin is not None:
        originLatitude, originLongitude = payload.origin.latitude, payload.origin.longitude
    elif user.latitude is None or user.longitude is None or user.locationObservedAt is None:
        raise HTTPException(status_code=409, detail='user location is required for navigation')
    elif user.locationObservedAt < datetime.now(timezone.utc) - timedelta(minutes=15):
        raise HTTPException(status_code=409, detail='user location is stale; update location')
    else:
        originLatitude, originLongitude = user.latitude, user.longitude
    mobilityRequired = any(item.type == 'MOBILITY_LIMITATION' for item in user.accessibility) or payload.profile == 'WHEELCHAIR'
    rejected: list[RejectedShelter] = []
    if payload.destinationShelterId:
        shelter = await shelterRepository.getShelter(session, payload.destinationShelterId)
        if shelter is None:
            raise HTTPException(status_code=404, detail='shelter not found')
        candidates = [(shelter, 0.0)]
    else:
        candidates = await shelterRepository.nearbyShelters(session, originLatitude, originLongitude, 10000, 10)
    try:
        evidence = await routeEvidence(session, center=(originLatitude, originLongitude))
    except hazardRepository.HazardStateUnavailable as error:
        return NavigationResponse(routeStatus=NavigationStatus.UNAVAILABLE, selectionReasonCodes=['NO_FEASIBLE_ROUTE', str(error)])
    viable = []
    for shelter, distanceM in candidates:
        suitable, reasons = shelterService.suitabilityReasons(shelter, mobilityRequired)
        if suitable and destinationExcluded(shelter.latitude, shelter.longitude, [item for item in evidence if isinstance(item, HazardEvidence)]):
            suitable, reasons = False, ['SHELTER_IN_CRITICAL_HAZARD', 'AUTHORITATIVE_HAZARD_INTERSECTION']
        if suitable:
            viable.append((shelter, distanceM, reasons))
        else:
            rejected.append(RejectedShelter(shelterId=shelter.id, reasonCodes=reasons))
    if not viable:
        logEvaluation('noSuitableShelter', startedAt, [])
        return NavigationResponse(routeStatus=NavigationStatus.UNAVAILABLE, selectionReasonCodes=['NO_SUITABLE_SHELTER'], rejectedCandidates=rejected)
    routing = provider or ValhallaRoutingProvider()
    evaluated: list[tuple[object, list[str], EvaluatedRoute]] = []
    providerFailed = False
    for shelter, _, shelterReasons in viable:
        try:
            routes = await evaluatedCandidates(routing, (originLatitude, originLongitude), (shelter.latitude, shelter.longitude), evidence, mobilityRequired, str(shelter.id), session=session, profile='WHEELCHAIR' if mobilityRequired else payload.profile)
        except RoutingUnavailable:
            providerFailed = True
            rejected.append(RejectedShelter(shelterId=shelter.id, reasonCodes=['ROUTING_PROVIDER_UNAVAILABLE']))
            continue
        except hazardRepository.HazardStateUnavailable as error:
            rejected.append(RejectedShelter(shelterId=shelter.id, reasonCodes=[str(error)]))
            continue
        except NoRoute:
            rejected.append(RejectedShelter(shelterId=shelter.id, reasonCodes=['NO_ROUTE_AVAILABLE']))
            continue
        evaluated.extend((shelter, shelterReasons, item) for item in routes)
    if not evaluated and providerFailed:
        logEvaluation('routingUnavailable', startedAt, [])
        return NavigationResponse(routeStatus=NavigationStatus.UNAVAILABLE, selectionReasonCodes=['ROUTING_PROVIDER_UNAVAILABLE'], rejectedCandidates=rejected)
    evaluations = applyRanking([item[2] for item in evaluated], enforcePreference=False)
    for shelter, _, evaluation in evaluated:
        if not evaluation.feasible:
            rejected.append(RejectedShelter(shelterId=shelter.id, reasonCodes=evaluation.reasons))
    feasible = [item for item in evaluated if item[2].feasible]
    candidateEvaluations = [candidateResponse(item) for item in evaluations]
    if not feasible:
        logEvaluation('noFeasibleRoute', startedAt, evaluations)
        return NavigationResponse(routeStatus=NavigationStatus.UNAVAILABLE, selectionReasonCodes=['NO_FEASIBLE_ROUTE'], rejectedCandidates=rejected, evaluatedCandidates=candidateEvaluations)
    ranked = sorted((item[2] for item in feasible), key=rankingKey)
    selected = ranked[0]
    selectedShelter, shelterReasons, _ = next(item for item in feasible if item[2] is selected)
    route, evaluation = routeResponse(selected)
    route.profile = 'WHEELCHAIR' if mobilityRequired else 'PEDESTRIAN'
    reasons = shelterReasons + evaluation.reasonCodes + selectionReasons(selected, ranked)
    logEvaluation('ready', startedAt, evaluations, selected)
    return NavigationResponse(routeStatus=NavigationStatus.READY, destination=NavigationDestination(shelterId=selectedShelter.id, name=selectedShelter.name, latitude=selectedShelter.latitude, longitude=selectedShelter.longitude), route=route, evaluation=evaluation, selectionReasonCodes=reasons, rejectedCandidates=rejected, evaluatedCandidates=candidateEvaluations)


async def previewNavigation(session: AsyncSession, payload: NavigationPreviewCreate, provider: ValhallaRoutingProvider | None = None) -> NavigationPreviewResponse:
    startedAt = perf_counter()
    routing = provider or ValhallaRoutingProvider()
    try:
        evidence = await routeEvidence(session, payload.scenarioHazards, (payload.originLatitude, payload.originLongitude))
        candidates = await evaluatedCandidates(routing, (payload.originLatitude, payload.originLongitude), (payload.destinationLatitude, payload.destinationLongitude), evidence, payload.mobilityRequired, 'preview', session=session)
    except hazardRepository.HazardStateUnavailable as error:
        return NavigationPreviewResponse(routeStatus=NavigationStatus.UNAVAILABLE, selectionReasonCodes=['NO_FEASIBLE_ROUTE', str(error), 'DESTINATION_UNVERIFIED'])
    except RoutingUnavailable:
        return NavigationPreviewResponse(routeStatus=NavigationStatus.UNAVAILABLE, selectionReasonCodes=['ROUTING_PROVIDER_UNAVAILABLE', 'DESTINATION_UNVERIFIED'])
    except NoRoute:
        return NavigationPreviewResponse(routeStatus=NavigationStatus.UNAVAILABLE, selectionReasonCodes=['NO_ROUTE_AVAILABLE', 'DESTINATION_UNVERIFIED'])
    applyRanking(candidates, enforcePreference=False)
    feasible = sorted((item for item in candidates if item.feasible), key=rankingKey)
    responses = [candidateResponse(item) for item in candidates]
    if not feasible:
        logEvaluation('previewInfeasible', startedAt, candidates)
        return NavigationPreviewResponse(routeStatus=NavigationStatus.UNAVAILABLE, evaluatedCandidates=responses, selectionReasonCodes=['NO_FEASIBLE_ROUTE', 'DESTINATION_UNVERIFIED', 'PREVIEW_ONLY'])
    selected = feasible[0]
    navigationRoute, navigationEvaluation = routeResponse(selected)
    logEvaluation('previewReady', startedAt, candidates, selected)
    return NavigationPreviewResponse(routeStatus=NavigationStatus.READY, route=navigationRoute, evaluation=navigationEvaluation, evaluatedCandidates=responses, selectionReasonCodes=navigationEvaluation.reasonCodes + selectionReasons(selected, feasible) + ['DESTINATION_UNVERIFIED', 'PREVIEW_ONLY'])


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
