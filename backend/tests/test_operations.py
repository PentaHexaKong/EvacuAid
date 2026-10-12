import uuid
from datetime import datetime, timedelta, timezone
import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select, text
from app.db.session import get_session
from app.auth import current_user
from app.db.models import User, AssistanceRequest, Shelter, HazardRecord
from app.db.models.operations import FieldReport, OperationalRoute
from app.routers.operations import router
from app.services import operationsService, shelterService
from app.models.operations import RouteSet
from app.models.navigation import NavigationPreviewResponse, NavigationRoute


@pytest_asyncio.fixture
async def client(dbSession,monkeypatch):
    monkeypatch.setenv('COMMAND_API_KEY','test-command-key')
    # Remove only this suite's own committed region fixtures, including leftovers
    # after interruption. dbSession already enforces a dedicated _test database.
    await dbSession.execute(text("DELETE FROM command_regions WHERE name='Test province' AND boundary_source='TEST'"))
    await dbSession.commit()
    user=User(name='Private citizen', phone='PRIVATE', latitude=0, longitude=0)
    dbSession.add(user); await dbSession.commit()
    app=FastAPI(); app.include_router(router)
    async def database(): yield dbSession
    async def actor(): return user
    app.dependency_overrides[get_session]=database
    app.dependency_overrides[current_user]=actor
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test',headers={'X-Command-Key':'test-command-key'}) as result:
        result.actor=user; result.application=app
        yield result
    await dbSession.execute(text("DELETE FROM command_regions WHERE name='Test province' AND boundary_source='TEST'"))
    await dbSession.commit()


def report(**extra):
    return {'id':str(uuid.uuid4()),'kind':'BLOCKED_ROAD','description':'Bridge has collapsed',
        'latitude':0,'longitude':0,'observedAt':datetime.now(timezone.utc).isoformat(),
        'publicLocationConsent':True, **extra}


async def region(dbSession):
    region_id=uuid.uuid4()
    await dbSession.execute(text("INSERT INTO command_regions(id,code,name,administrative_level,boundary_source,data_mode,geometry,centroid) VALUES (:id,:code,'Test province','PROVINCE','TEST','REFERENCE',ST_GeomFromText('POLYGON((-1 -1,1 -1,1 1,-1 1,-1 -1))',4326),ST_SetSRID(ST_MakePoint(0,0),4326))"),{'id':region_id,'code':str(region_id)})
    await dbSession.commit(); return region_id


@pytest.mark.asyncio
async def test_submission_idempotence_identity_and_privacy(client,dbSession):
    payload=report()
    first=await client.post('/v1/field-reports',json=payload)
    assert first.status_code==201,first.text
    assert first.json()['status']=='UNVERIFIED'
    assert (await client.post('/v1/field-reports',json=payload)).json()['id']==payload['id']
    assert (await client.post('/v1/field-reports',json={**payload,'description':'Different barrier'})).status_code==409
    dbSession.expire_all()
    public=(await client.get('/v1/command/operations/reports')).json()
    assert 'Private citizen' not in str(public) and 'PRIVATE' not in str(public) and 'userId' not in public[0]
    evidence=(await dbSession.execute(select(HazardRecord))).scalar_one()
    assert evidence.authority=='COMMUNITY' and evidence.evidenceType=='OBSERVATION'


@pytest.mark.asyncio
@pytest.mark.parametrize('extra',[{'latitude':91},{'publicLocationConsent':False},{'description':'x'},{'kind':'INVALID'},{'observedAt':'2020-01-01T00:00:00Z'}])
async def test_invalid_reports_rejected(client,extra):
    assert (await client.post('/v1/field-reports',json=report(**extra))).status_code==422


@pytest.mark.asyncio
async def test_authenticated_submission_and_owner_isolation(client,dbSession):
    payload=report(); await client.post('/v1/field-reports',json=payload)
    other=User();dbSession.add(other);await dbSession.commit()
    async def actor(): return other
    client.application.dependency_overrides[current_user]=actor
    assert (await client.get('/v1/field-reports/mine')).json()==[]
    assert (await client.post('/v1/field-reports',json=payload)).status_code==409
    client.application.dependency_overrides.pop(current_user)
    assert (await client.post('/v1/field-reports',json=report())).status_code==401


@pytest.mark.asyncio
async def test_confirmed_barrier_persists_closure_and_invalidates_routes(client,dbSession):
    item=(await client.post('/v1/field-reports',json=report())).json()
    draft=OperationalRoute(id=uuid.uuid4(),payload={},result={},status='PUBLISHED');dbSession.add(draft);await dbSession.commit()
    review={'status':'CONFIRMED','note':'Responders verified collapsed bridge','barrier':True,'expectedUpdatedAt':item['updatedAt']}
    assert (await client.patch('/v1/command/operations/reports/'+item['id'],json=review)).status_code==422
    await dbSession.rollback()
    review['validUntil']=(datetime.now(timezone.utc)+timedelta(hours=2)).isoformat()
    response=await client.patch('/v1/command/operations/reports/'+item['id'],json=review)
    assert response.status_code==200,response.text
    hazard=(await dbSession.execute(select(HazardRecord))).scalar_one()
    assert hazard.evidenceType=='CONFIRMED_CLOSURE' and hazard.authority=='OFFICIAL'
    await dbSession.refresh(draft);assert draft.status=='DRAFT'
    assert (await client.patch('/v1/command/operations/reports/'+item['id'],json=review)).status_code==409
    await dbSession.rollback()
    resolved={**review,'status':'RESOLVED','barrier':False,'expectedUpdatedAt':response.json()['updatedAt']}
    assert (await client.patch('/v1/command/operations/reports/'+item['id'],json=resolved)).status_code==200
    assert (await dbSession.execute(select(HazardRecord))).scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_crowding_cannot_be_hard_closure(client):
    item=(await client.post('/v1/field-reports',json=report(kind='SHELTER_CROWDING'))).json()
    response=await client.patch('/v1/command/operations/reports/'+item['id'],json={'status':'CONFIRMED','note':'People outside shelter','barrier':True,'expectedUpdatedAt':item['updatedAt'],'validUntil':(datetime.now(timezone.utc)+timedelta(hours=2)).isoformat()})
    assert response.status_code==422


@pytest.mark.asyncio
async def test_delayed_checkin_does_not_replace_newer_observation(client,dbSession):
    region_id=await region(dbSession)
    now=datetime.now(timezone.utc)
    for status,observed in [('EVACUATING',now),('NEEDS_ASSISTANCE',now-timedelta(hours=2))]:
        response=await client.post('/v1/evacuation-check-ins',json={'id':str(uuid.uuid4()),'status':status,'observedAt':observed.isoformat(),'regionId':str(region_id),'shareAggregateConsent':True})
        assert response.status_code==201,response.text
    rows=(await client.get('/v1/command/operations/check-ins')).json()['regions']
    assert rows==[{'regionId':str(region_id),'status':'EVACUATING','count':1,'lastObservedAt':now.isoformat()}]


@pytest.mark.asyncio
async def test_case_dispatch_does_not_assert_citizen_safe(client,dbSession):
    request=AssistanceRequest(userId=client.actor.id,status='EVACUATING',support_needs=['MOBILITY_LIMITATION'])
    dbSession.add(request);await dbSession.commit()
    response=await client.patch(f'/v1/command/operations/assistance/{request.id}',json={'status':'COMPLETED','note':'Responders completed dispatch work'})
    assert response.status_code==200,response.text
    await dbSession.refresh(request);assert request.status=='EVACUATING' and request.safeAt is None
    rows=(await client.get('/v1/command/operations/assistance')).json()
    assert 'phone' not in rows[0] and 'latitude' not in rows[0] and rows[0]['government']['status']=='COMPLETED'
    own=(await client.get('/v1/operations/my-assistance')).json()
    assert own[0]['government']['status']=='COMPLETED'
    other=User();dbSession.add(other);await dbSession.commit()
    async def actor():return other
    client.application.dependency_overrides[current_user]=actor
    assert (await client.get('/v1/operations/my-assistance')).json()==[]


@pytest.mark.asyncio
async def test_route_publication_rechecks_and_refuses_infeasible(client,dbSession,monkeypatch):
    region_id=await region(dbSession)
    shelter=Shelter(name='Reference shelter',latitude=0,longitude=.01,location='SRID=4326;POINT(.01 0)',shelterType='PUBLIC',status='UNKNOWN',source='TEST')
    dbSession.add(shelter);await dbSession.commit()
    async def calculate(*args):
        return NavigationPreviewResponse(routeStatus='READY',route=NavigationRoute(distanceM=1000,durationSec=800,geometry={'type':'LineString','coordinates':[[0,0],[.01,0]]},routeScore=0))
    monkeypatch.setattr(operationsService.navigationService,'previewNavigation',calculate)
    payload={'id':str(uuid.uuid4()),'name':'Public assembly route','regionId':str(region_id),'shelterId':str(shelter.id),'originLatitude':0,'originLongitude':0}
    draft=await client.post('/v1/command/operations/routes',json=payload); assert draft.status_code==201,draft.text
    assert not draft.json()['usable']
    published=await client.post('/v1/command/operations/routes/'+payload['id']+'/publish')
    assert published.status_code==200 and published.json()['usable'] and not published.json()['result']['safetyVerified']
    request=AssistanceRequest(userId=client.actor.id,status='EVACUATING')
    dbSession.add(request);await dbSession.commit()
    action={'status':'DISPATCHED','note':'Assembly route assigned','assignedRouteId':payload['id']}
    assigned=await client.patch(f'/v1/command/operations/assistance/{request.id}',json=action)
    assert assigned.status_code==200,assigned.text
    own=(await client.get('/v1/operations/my-assistance')).json()
    assert own[0]['assignedRoute']['id']==payload['id']
    async def infeasible(*args): return NavigationPreviewResponse(routeStatus='UNAVAILABLE',selectionReasonCodes=['NO_FEASIBLE_ROUTE'])
    monkeypatch.setattr(operationsService.navigationService,'previewNavigation',infeasible)
    assert (await client.post('/v1/command/operations/routes/'+payload['id']+'/publish')).status_code==409
    await dbSession.rollback()
    withdrawn=await client.post('/v1/command/operations/routes/'+payload['id']+'/withdraw')
    assert withdrawn.status_code==200 and not withdrawn.json()['usable']
    action['expectedUpdatedAt']=assigned.json()['updatedAt']
    assert (await client.patch(f"/v1/command/operations/assistance/{own[0]['requestId']}",json=action)).status_code==409


def test_legacy_occupancy_never_filters_shelter():
    shelter=Shelter(status='FULL',capacity=20,currentOccupancy=20,wheelchairAccessible=True)
    suitable,reasons=shelterService.suitabilityReasons(shelter,True)
    assert suitable and not any('CAPACITY' in reason or 'FULL' in reason for reason in reasons)


@pytest.mark.asyncio
async def test_evidence_revision_during_calculation_rejects_stale_publication(client,dbSession,monkeypatch):
    region_id=await region(dbSession)
    shelter=Shelter(name='Reference shelter',latitude=0,longitude=.01,location='SRID=4326;POINT(.01 0)',shelterType='PUBLIC',status='UNKNOWN',source='TEST')
    dbSession.add(shelter);await dbSession.commit()
    async def changing_evidence(session,payload):
        record=HazardRecord(sourceId='changed-during-calculation',source='TEST',hazardType='EARTHQUAKE',authority='COMMUNITY',evidenceType='OBSERVATION',geometry='SRID=4326;POINT(0 0)',evidenceMetadata={})
        session.add(record);await session.flush()
        return NavigationPreviewResponse(routeStatus='READY',route=NavigationRoute(distanceM=1000,durationSec=800,geometry={'type':'LineString','coordinates':[[0,0],[.01,0]]},routeScore=0))
    monkeypatch.setattr(operationsService.navigationService,'previewNavigation',changing_evidence)
    payload={'id':str(uuid.uuid4()),'name':'Assembly route','regionId':str(region_id),'shelterId':str(shelter.id),'originLatitude':0,'originLongitude':0}
    response=await client.post('/v1/command/operations/routes',json=payload)
    assert response.status_code==409 and 'Evidence changed' in response.text
    await dbSession.rollback()
    assert (await dbSession.execute(select(OperationalRoute))).scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_command_operations_require_the_dashboard_key(client):
    for method,path in [('get','/v1/command/operations/reports'),('get','/v1/command/operations/check-ins'),('get','/v1/command/operations/assistance'),('get','/v1/command/operations/routes')]:
        assert (await getattr(client,method)(path,headers={'X-Command-Key':'wrong'})).status_code==401
    # Citizen routes still use the signed-in user, not the dashboard key.
    assert (await client.get('/v1/field-reports/mine',headers={'X-Command-Key':'wrong'})).status_code==200
