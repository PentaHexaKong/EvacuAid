from datetime import datetime, timedelta, timezone
from uuid import UUID
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select, func, text
from app.auth import current_user
from app.db.session import get_session
from app.db.models.operations import FieldReport, EvacuationCheckIn, OperationalRoute, GovernmentCase
from app.db.models.buddy import AssistanceRequest
from app.models.operations import ReportCreate, CheckInCreate, Review, RouteSet, CaseUpdate
from app.services import operationsService as service

router = APIRouter(tags=['Field operations'])


@router.post('/v1/field-reports', status_code=201)
async def submit_report(payload: ReportCreate, actor=Depends(current_user), session=Depends(get_session)):
    return service.report_response(await service.submit(session, FieldReport, payload, actor.id))


@router.get('/v1/field-reports/mine')
async def my_reports(actor=Depends(current_user), session=Depends(get_session), limit: int=Query(50, ge=1, le=200), offset: int=Query(0, ge=0)):
    rows = (await session.execute(select(FieldReport).where(FieldReport.userId==actor.id).order_by(FieldReport.createdAt.desc()).limit(limit).offset(offset))).scalars()
    return [service.report_response(row) for row in rows]


@router.post('/v1/evacuation-check-ins', status_code=201)
async def check_in(payload: CheckInCreate, actor=Depends(current_user), session=Depends(get_session)):
    row = await service.submit(session, EvacuationCheckIn, payload, actor.id)
    return {'id': row.id, **row.payload, 'receivedAt': row.createdAt}


@router.get('/v1/command/operations/reports')
async def reports(session=Depends(get_session), limit: int=Query(50, ge=1, le=200), offset: int=Query(0, ge=0)):
    rows = (await session.execute(select(FieldReport).order_by(FieldReport.updatedAt.desc(), FieldReport.id).limit(limit).offset(offset))).scalars()
    return [service.report_response(row) for row in rows]


@router.patch('/v1/command/operations/reports/{report_id}')
async def review(report_id: UUID, payload: Review, session=Depends(get_session)):
    return await service.review_report(session, report_id, payload)


@router.get('/v1/command/operations/check-ins')
async def check_ins(session=Depends(get_session)):
    # Latest observation per citizen, including delayed offline uploads; reception time is not observation time.
    rows = (await session.execute(text('''WITH latest AS (
        SELECT DISTINCT ON (user_id) payload, created_at FROM evacuation_check_ins
        ORDER BY user_id, (payload->>'observedAt')::timestamptz DESC, created_at DESC)
        SELECT payload->>'regionId' AS "regionId", payload->>'status' AS status,
        count(*) AS count, max((payload->>'observedAt')::timestamptz) AS "lastObservedAt"
        FROM latest WHERE (payload->>'observedAt')::timestamptz >= now()-interval '24 hours'
        GROUP BY payload->>'regionId', payload->>'status' ORDER BY 1,2'''))).mappings().all()
    return {'scope': 'Self-reported check-ins observed within 24 hours; not all affected people or independently verified safety.', 'regions': rows}


@router.get('/v1/command/operations/assistance')
async def assistance(session=Depends(get_session), limit: int=Query(50, ge=1, le=200), offset: int=Query(0, ge=0)):
    rows = (await session.execute(select(AssistanceRequest, GovernmentCase).outerjoin(GovernmentCase, GovernmentCase.requestId==AssistanceRequest.id)
        .order_by(AssistanceRequest.updatedAt.desc(), AssistanceRequest.id).limit(limit).offset(offset))).all()
    return [{'requestId': request.id, 'status': request.status, 'supportNeeds': request.support_needs,
             'requestedAt': request.requestedAt, 'observedAt': request.updatedAt,
             'stale': request.updatedAt < datetime.now(timezone.utc)-timedelta(hours=24),
             'government': case.payload if case else None, 'caseUpdatedAt': case.updatedAt if case else None} for request,case in rows]


@router.get('/v1/operations/my-assistance')
async def my_assistance(actor=Depends(current_user), session=Depends(get_session), limit: int=Query(50, ge=1, le=200), offset: int=Query(0, ge=0)):
    rows = (await session.execute(select(AssistanceRequest, GovernmentCase).outerjoin(GovernmentCase, GovernmentCase.requestId==AssistanceRequest.id)
        .where(AssistanceRequest.userId==actor.id).order_by(AssistanceRequest.updatedAt.desc(), AssistanceRequest.id).limit(limit).offset(offset))).all()
    route_ids = {UUID(case.payload['assignedRouteId']) for _,case in rows if case and case.payload.get('assignedRouteId')}
    assigned = {str(route.id):service.route_response(route) for route in (await session.execute(select(OperationalRoute).where(OperationalRoute.id.in_(route_ids)))).scalars()} if route_ids else {}
    return [{'requestId':request.id, 'status':request.status, 'government':case.payload if case else None,
             'assignedRoute':assigned.get(case.payload.get('assignedRouteId')) if case else None} for request,case in rows]


@router.patch('/v1/command/operations/assistance/{request_id}')
async def case_update(request_id: UUID, payload: CaseUpdate, session=Depends(get_session)):
    await session.execute(select(func.pg_advisory_xact_lock(172512)))
    await session.execute(select(func.pg_advisory_xact_lock(request_id.int & ((1 << 63)-1))))
    if not await session.get(AssistanceRequest, request_id):
        raise HTTPException(404, 'Assistance request not found')
    row = await session.get(GovernmentCase, request_id)
    if (row.updatedAt if row else None) != payload.expectedUpdatedAt:
        raise HTTPException(409, 'Case changed; refresh before updating')
    if payload.assignedRouteId:
        route = await session.get(OperationalRoute, payload.assignedRouteId)
        if route is None or not service.route_response(route)['usable']:
            raise HTTPException(409, 'Assigned route must be a current published route')
    if row is None:
        row = GovernmentCase(requestId=request_id)
        session.add(row)
    # Dispatch bookkeeping never asserts citizen safety or completes a Buddy session.
    row.payload = payload.model_dump(mode='json', exclude={'expectedUpdatedAt'})
    await session.commit()
    await session.refresh(row)
    return {'requestId': row.requestId, **row.payload, 'updatedAt': row.updatedAt}


@router.post('/v1/command/operations/routes', status_code=201)
async def set_route(payload: RouteSet, session=Depends(get_session)):
    return await service.save_route(session, payload)


@router.get('/v1/command/operations/routes')
async def routes(session=Depends(get_session), limit: int=Query(50, ge=1, le=200), offset: int=Query(0, ge=0)):
    rows = (await session.execute(select(OperationalRoute).order_by(OperationalRoute.updatedAt.desc(), OperationalRoute.id).limit(limit).offset(offset))).scalars()
    return [service.route_response(row) for row in rows]


@router.post('/v1/command/operations/routes/{route_id}/publish')
async def publish(route_id: UUID, session=Depends(get_session)):
    row = await session.get(OperationalRoute, route_id)
    if row is None:
        raise HTTPException(404, 'Route not found')
    return await service.save_route(session, RouteSet(id=route_id, **row.payload), publish=True)


@router.post('/v1/command/operations/routes/{route_id}/withdraw')
async def withdraw(route_id: UUID, session=Depends(get_session)):
    await session.execute(select(func.pg_advisory_xact_lock(172512)))
    row = await session.get(OperationalRoute, route_id, with_for_update=True)
    if row is None:
        raise HTTPException(404, 'Route not found')
    row.status='WITHDRAWN'
    await session.commit()
    await session.refresh(row)
    return service.route_response(row)
