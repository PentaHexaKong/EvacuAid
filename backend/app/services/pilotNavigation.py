from datetime import timedelta

from fastapi import HTTPException

from app.db.models.pilot import PilotLocation
from app.models.hazard import HazardEvidence
from app.models.navigation import HazardStatus
from app.repositories import hazardRepository, shelterRepository
from app.services import navigationService, pilotService, shelterService, user_service
from app.services.navigationService import routeHazards
from app.services.routeCandidateService import evaluatedCandidates
from app.services.routeEvaluationService import applyRanking, evaluateRoute, rankingKey
from app.services.valhallaProvider import NoRoute, RoutingUnavailable, ValhallaRoutingProvider


async def session_route(db, request, actor, payload):
    requester = await user_service.require_user(db, request.requester_id, include_relations=True)
    if any(item.type == 'MOBILITY_LIMITATION' for item in requester.accessibility):
        payload.profile = 'WHEELCHAIR'
    approach = payload.leg == 'TO_REQUESTER' and actor == request.requester_id
    if payload.leg == 'TO_REQUESTER' and actor != request.helper_id and not approach:
        raise HTTPException(403, 'helper only for requester approach')
    if approach:
        if request.status not in ('ACCEPTED', 'EN_ROUTE'):
            raise HTTPException(409, 'helper is not on the way')
        point = await db.get(PilotLocation, (request.id, request.helper_id))
        if not point or point.observed_at < pilotService.now() - timedelta(seconds=30) or point.accuracy_m > 50:
            raise HTTPException(409, 'helper location unavailable or stale')
        origin = (point.latitude, point.longitude)
    elif payload.origin:
        if payload.origin.observedAt < pilotService.now() - timedelta(seconds=30) or payload.origin.accuracyM is None or payload.origin.accuracyM > 50:
            raise HTTPException(409, 'fresh accurate origin required')
        origin = (payload.origin.latitude, payload.origin.longitude)
    else:
        point = await db.get(PilotLocation, (request.id, actor))
        if not point or point.observed_at < pilotService.now() - timedelta(seconds=30) or point.accuracy_m > 50:
            raise HTTPException(409, 'fresh accurate session location required')
        origin = (point.latitude, point.longitude)
    if payload.leg == 'TO_REQUESTER':
        target = await db.get(PilotLocation, (request.id, request.requester_id))
        if not target or target.observed_at < pilotService.now() - timedelta(seconds=30) or target.accuracy_m > 50:
            raise HTTPException(409, 'requester location unavailable or stale')
        destinations = [(None, (target.latitude, target.longitude), [])]
    else:
        if request.status not in ('ARRIVED', 'EVACUATING', 'COMPLETION_PENDING'):
            raise HTTPException(409, 'meet requester before shelter journey')
        if not request.meeting_confirmed:
            raise HTTPException(409, 'requester meeting confirmation required')
        if payload.destinationShelterId and request.selected_shelter_id and payload.destinationShelterId != request.selected_shelter_id and actor != request.requester_id:
            raise HTTPException(403, 'requester must change shared shelter')
        destination_id = payload.destinationShelterId or request.selected_shelter_id
        if destination_id:
            shelter = await shelterRepository.getShelter(db, destination_id)
            if not shelter:
                raise HTTPException(404, 'shelter not found')
            candidates = [(shelter, 0)]
        else:
            candidates = await shelterRepository.nearbyShelters(db, *origin, 10000, 25)
        destinations = []
        for shelter, distance in candidates:
            suitable, reasons = shelterService.suitabilityReasons(shelter, payload.profile == 'WHEELCHAIR')
            if suitable:
                destination = (shelter.entranceLatitude, shelter.entranceLongitude) if shelter.entranceLatitude is not None and shelter.entranceLongitude is not None else (shelter.latitude, shelter.longitude)
                destinations.append((shelter, destination, reasons))
    try:
        evidence = await navigationService.routeEvidence(db, center=origin)
    except hazardRepository.HazardStateUnavailable:
        evidence = None
    rejection_reasons = []
    if evidence is not None and payload.leg != 'TO_REQUESTER':
        viable = []
        for shelter, destination, reasons in destinations:
            if navigationService.destinationExcluded(shelter.latitude, shelter.longitude, [item for item in evidence if isinstance(item, HazardEvidence)]):
                rejection_reasons.extend(['SHELTER_IN_CRITICAL_HAZARD', 'AUTHORITATIVE_HAZARD_INTERSECTION'])
            else:
                viable.append((shelter, destination, reasons))
        destinations = viable
    request_id = request.id
    prior_selection = request.selected_shelter_id
    await db.commit()
    for shelter, destination, reasons in destinations[:3]:
        try:
            provider = ValhallaRoutingProvider()
            selected = None
            hazard_unavailable = evidence is None
            if evidence is not None:
                try:
                    candidates = await evaluatedCandidates(provider, origin, destination, evidence, payload.profile == 'WHEELCHAIR', str(shelter.id) if shelter else 'requester', session=db, profile=payload.profile)
                except hazardRepository.HazardStateUnavailable:
                    hazard_unavailable = True
                    route = await provider.route(origin, destination, payload.profile)
                    candidates = [evaluateRoute(str(shelter.id) if shelter else 'requester', route, evidence, payload.profile == 'WHEELCHAIR')]
                applyRanking(candidates, enforcePreference=False)
                feasible = sorted((item for item in candidates if item.feasible), key=rankingKey)
                if not feasible:
                    rejection_reasons.append('NO_FEASIBLE_ROUTE')
                    rejection_reasons.extend(reason for item in candidates for reason in item.reasons)
                    continue
                selected = feasible[0]
            route = selected.route if selected else await provider.route(origin, destination, payload.profile)
        except RoutingUnavailable:
            return {'routeStatus': 'UNAVAILABLE', 'selectionReasonCodes': ['ROUTING_PROVIDER_UNAVAILABLE'], 'leg': payload.leg}
        except NoRoute:
            if evidence is not None:
                rejection_reasons.extend(['NO_FEASIBLE_ROUTE', 'NO_ROUTE_AVAILABLE'])
            continue
        if not route.maneuvers:
            return {'routeStatus': 'UNAVAILABLE', 'selectionReasonCodes': ['MANEUVERS_UNAVAILABLE'], 'leg': payload.leg}
        if not hazard_unavailable:
            hazard, hazard_reasons = selected.hazardStatus, selected.reasons
        else:
            hazard, hazard_reasons = await routeHazards(route.geometry)
            if hazard != HazardStatus.POTENTIALLY_EXPOSED:
                hazard = HazardStatus.UNKNOWN
            hazard_reasons = [reason for reason in (selected.reasons if selected else []) + hazard_reasons if reason != 'NO_KNOWN_HAZARD_INTERSECTION'] + ['HAZARD_STATE_UNAVAILABLE']
        wheelchair = payload.profile == 'WHEELCHAIR'
        reasons += hazard_reasons + (['WHEELCHAIR_COSTING', 'OSM_ACCESSIBILITY_UNVERIFIED', 'ROUTE_ACCESSIBILITY_UNKNOWN'] if wheelchair else ['ROUTE_PEDESTRIAN_ACCESS'])
        request = await pilotService.get_request(db, request_id, actor, connected=True)
        if payload.leg == 'TO_REQUESTER':
            target = await db.get(PilotLocation, (request.id, request.requester_id), populate_existing=True)
            if not target or target.observed_at < pilotService.now() - timedelta(seconds=30):
                raise HTTPException(409, 'requester location sharing stopped or stale')
        if shelter:
            if request.selected_shelter_id not in (None, shelter.id, prior_selection):
                raise HTTPException(409, 'shared shelter changed; refresh route')
            changed = request.selected_shelter_id != shelter.id
            request.selected_shelter_id = shelter.id
            if changed:
                await pilotService.session_event(db, request)
        await db.commit()
        return {'routeStatus': 'READY', 'leg': payload.leg, 'destination': {'shelterId': shelter.id if shelter else None, 'name': shelter.name if shelter else 'Requester', 'latitude': destination[0], 'longitude': destination[1], 'source': shelter.source if shelter else 'ACCEPTED_SESSION', 'entranceNote': shelter.entranceNote if shelter else None, 'entranceLatitude': shelter.entranceLatitude if shelter else None, 'entranceLongitude': shelter.entranceLongitude if shelter else None}, 'route': {'distanceM': route.distanceM, 'durationSec': route.durationSec, 'geometry': route.geometry, 'profile': payload.profile, 'maneuvers': route.maneuvers}, 'evaluation': {'safetyStatus': hazard, 'accessibilityStatus': 'UNKNOWN' if wheelchair else 'COMPATIBLE', 'reasonCodes': reasons}, 'selectionReasonCodes': reasons, 'rejectedCandidates': []}
    return {'routeStatus': 'UNAVAILABLE', 'leg': payload.leg, 'selectionReasonCodes': list(dict.fromkeys(['NO_FEASIBLE_ROUTE'] + rejection_reasons)) if rejection_reasons else ['NO_SUITABLE_ROUTE']}
