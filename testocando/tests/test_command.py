import copy
import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy import text, select

from app.db.models import AssistanceRequest, HazardRecord, Shelter, User, UserAccessibility
from app.db.session import get_session
from app.models.hazard import HazardEvidence
from command.aggregation import classifyEvidence, exposureEstimate, operationalSignal, priorityKey, refreshSnapshots
from command.api import readProjection
from command.importer import importRegions, validateFeatures
from command.main import app
from command.models import RegionalOperationalSnapshot, Region


def regionDocument(mode='REFERENCE', population=1000):
    return {'type':'FeatureCollection','features':[
        {'type':'Feature','geometry':{'type':'Polygon','coordinates':[[[0,0],[.02,0],[.02,.02],[0,.02],[0,0]]]},
         'properties':{'code':f'{mode}-{i}','name':f'{mode} Region {i}','administrativeLevel':level,
            'parentCode':None if i==0 else f'{mode}-{i-1}','dataMode':mode,'boundarySource':'SIMULATION TEST' if mode=='SIMULATION' else 'Test boundary reference',
            'population':population,'populationReferenceYear':2025 if population is not None else None,'populationSource':'SIMULATION TEST' if mode=='SIMULATION' else 'Test population reference'}}
        for i,level in enumerate(['PROVINCE','CITY_REGENCY','DISTRICT','VILLAGE'])]}


def hazard(kind='ACTIVE_WARNING',geometry=None,**kwargs):
    return HazardEvidence(sourceId=uuid.uuid4().hex,source='TEST_REFERENCE',hazardType='FLOOD',authority='OFFICIAL',evidenceType=kind,
        geometry=geometry or {'type':'Polygon','coordinates':[[[0,0],[.01,0],[.01,.02],[0,.02],[0,0]]]},
        observedAt=datetime.now(timezone.utc),validUntil=datetime.now(timezone.utc)+timedelta(hours=1),**kwargs)


async def addHazard(session,item):
    from shapely.geometry import shape
    session.add(HazardRecord(sourceId=item.sourceId,source=item.source,hazardType=item.hazardType.value,authority=item.authority.value,
        evidenceType=item.evidenceType.value,geometry=from_shape(shape(item.geometry),srid=4326),severity=item.severity,confidence=item.confidence,
        observedAt=item.observedAt,validFrom=item.validFrom,validUntil=item.validUntil,evidenceMetadata=item.metadata))
    await session.flush()


async def snapshot(session,mode='REFERENCE'):
    from sqlalchemy import select
    from command.models import Region
    row=(await session.execute(select(RegionalOperationalSnapshot).join(Region,Region.id==RegionalOperationalSnapshot.regionId)
        .where(Region.code==f'{mode}-3'))).scalar_one()
    return row.payload


def testPopulationProvenanceAndUnknown():
    assert exposureEstimate(None,.5)==(None,'UNKNOWN')
    assert exposureEstimate(1000,None)==(None,'UNKNOWN')
    assert exposureEstimate(1000,1.2)==(1000,'AREA_WEIGHTED_ESTIMATE')
    assert exposureEstimate(1000,-.3)==(0,'AREA_WEIGHTED_ESTIMATE')
    document=regionDocument()
    document['features'][0]['properties']['populationSource']=None
    with pytest.raises(ValueError,match='population requires'):
        validateFeatures(document)
    assert len(validateFeatures(regionDocument(population=None)))==4


def testCommandRoutesShareCitizenBackend():
    from app.main import app as citizenApp
    assert app is citizenApp
    paths=app.openapi()['paths']
    assert '/v1/command/regions' in paths
    assert '/health' in paths
    assert '/api/risk' in paths
    assert any(path.startswith('/v1/navigation') for path in paths)


@pytest.mark.asyncio
async def testCommandCachingDoesNotChangeCitizenResponses():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        response=await client.get('/')
        assert response.status_code==200
        assert response.json()['service']=='EvacuAid Backend'
        assert response.headers.get('cache-control') != 'no-store'


def testSimulationMustDeclareSource():
    document=regionDocument('SIMULATION')
    document['features'][0]['properties']['populationSource']='BPS'
    with pytest.raises(ValueError,match='simulation population source'):
        validateFeatures(document)
    item=hazard(metadata={'simulation':True})
    assert classifyEvidence(item,datetime.now(timezone.utc))[0]=='SIMULATION'


def testBaselineActiveAndExpiredAreDistinct():
    now=datetime.now(timezone.utc)
    baseline=hazard('BASELINE_HAZARD')
    assert classifyEvidence(baseline,now)[0]=='OFFICIAL_BASELINE'
    assert operationalSignal([(baseline,'REFERENCE')])==('WATCH',False)
    assert operationalSignal([(hazard(),'FRESH')])==('ELEVATED',False)
    assert operationalSignal([(hazard('CRITICAL_HAZARD'),'FRESH')])==('CRITICAL',True)
    assert operationalSignal([])==('UNKNOWN',False)
    item=hazard(); item.validUntil=now-timedelta(seconds=1)
    assert classifyEvidence(item,now)[1]=='EXPIRED'
    assert operationalSignal([(item,'EXPIRED')])==('UNKNOWN',False)


def testUndatedStaticBaselineRemainsReferenceNotActiveWarning():
    now=datetime.now(timezone.utc)
    item=hazard('BASELINE_HAZARD')
    item.observedAt=None
    item.validUntil=None
    provenance,freshness=classifyEvidence(item,now)
    assert (provenance,freshness)==('OFFICIAL_BASELINE','REFERENCE')
    assert item.observedAt is None
    assert operationalSignal([(item,freshness)])==('WATCH',False)
    item=hazard()
    item.observedAt=None
    assert classifyEvidence(item,now)[1]=='UNKNOWN'


def testJakartaAdapterKeepsRealNamesHierarchyAndUnknownPopulation():
    from command.jakartaBoundaries import prepareBoundaries
    source={'type':'FeatureCollection','features':[{'type':'Feature','geometry':regionDocument()['features'][0]['geometry'],
        'properties':{'kdepum':'3171031003','kdcpum':'317103','kdpkab':'3171','wadmkd':'HARAPAN MULIA','wadmkc':'KEMAYORAN','wadmkk':'JAKARTA PUSAT'}}]}
    document,repairs=prepareBoundaries(source)
    assert repairs==[]
    assert len(validateFeatures(document))==4
    assert [f['properties']['code'] for f in document['features']]==['31','3171','317103','3171031003']
    assert document['features'][-1]['properties']['name']=='HARAPAN MULIA'
    assert all(f['properties']['population'] is None and f['properties']['dataMode']=='REFERENCE' for f in document['features'])


def testPriorityIsExplainableAndDeterministic():
    def row(code,level='ELEVATED',population=None,critical=False):
        return SimpleNamespace(code=code,signalLevel=level,authoritativeCriticalHazard=critical,estimatedExposedPopulation=population,
            activeAssistanceCount=None,shelterPressure=None,evidenceFreshness='UNKNOWN')
    rows=[row('unknown','UNKNOWN'),row('normal','NORMAL'),row('small',population=10),row('large',population=100),row('critical','CRITICAL'),row('missing')]
    assert [r.code for r in sorted(rows,key=priorityKey)]==['critical','large','small','missing','unknown','normal']


@pytest.mark.asyncio
async def testHierarchySpatialExposureAndUnion(commandSession):
    await importRegions(commandSession,regionDocument())
    await addHazard(commandSession,hazard())
    await addHazard(commandSession,hazard())
    # An unrelated polygon and a baseline full-region polygon must not inflate exposure.
    await addHazard(commandSession,hazard(geometry={'type':'Polygon','coordinates':[[[1,1],[2,1],[2,2],[1,2],[1,1]]]}))
    await addHazard(commandSession,hazard('BASELINE_HAZARD',geometry=regionDocument()['features'][0]['geometry']))
    assert await refreshSnapshots(commandSession)==4
    result=await snapshot(commandSession)
    assert [r['administrativeLevel'] for r in result['hierarchy']]==['PROVINCE','CITY_REGENCY','DISTRICT']
    assert len(result['hazards'])==3
    assert result['exposureFraction']==pytest.approx(.5,abs=.001)
    assert result['estimatedExposedPopulation']==500
    assert result['exposureEstimationMethod']=='AREA_WEIGHTED_ESTIMATE'
    assert result['populationSource']=='Test population reference'
    assert result['availableResponderCount'] is None
    assert result['feasibleRouteCount'] == 0


@pytest.mark.asyncio
async def testSnapshotsExcludeRegionAndHazardGeometry(commandSession):
    await importRegions(commandSession,regionDocument())
    item=hazard()
    await addHazard(commandSession,item)
    await refreshSnapshots(commandSession)
    payloads=(await commandSession.execute(select(RegionalOperationalSnapshot.payload))).scalars().all()
    assert len(payloads)==4
    for payload in payloads:
        assert 'geometry' not in payload
        assert 'centroid' not in payload
        assert len(payload['hazards'])==1
        assert payload['hazards'][0]['geometry'] is None
        assert payload['hazards'][0]['sourceId']==item.sourceId


@pytest.mark.asyncio
async def testHazardEndpointsClipGeometryAndKeepPoints(commandSession,monkeypatch):
    monkeypatch.setenv('COMMAND_API_KEY','test-command-key')
    from shapely.geometry import shape
    await importRegions(commandSession,regionDocument())
    polygon=hazard(geometry={'type':'Polygon','coordinates':[[[-.01,-.01],[.01,-.01],[.01,.03],[-.01,.03],[-.01,-.01]]]})
    point=hazard('OBSERVATION',geometry={'type':'Point','coordinates':[.005,.005]})
    await addHazard(commandSession,polygon)
    await addHazard(commandSession,point)
    await refreshSnapshots(commandSession)
    regionId=str((await commandSession.execute(select(Region.id).where(Region.code=='REFERENCE-3'))).scalar_one())
    async def override():
        yield commandSession
    app.dependency_overrides[get_session]=override
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test',headers={'X-Command-Key':'test-command-key'}) as client:
            detail=await client.get('/v1/command/regions/'+regionId)
            hazards=await client.get('/v1/command/regions/'+regionId+'/hazards')
            assert detail.status_code==hazards.status_code==200
            assert detail.json()['hazards']==hazards.json()
            byId={item['sourceId']:item for item in hazards.json()}
            clipped=shape(byId[polygon.sourceId]['geometry'])
            boundary=shape(detail.json()['geometry'])
            assert boundary.covers(clipped)
            assert clipped.equals(shape(polygon.geometry).intersection(boundary))
            assert byId[point.sourceId]['geometry']==point.geometry
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def testListSimplifiesDenseBoundaryAndDetailKeepsResolution(commandSession,monkeypatch):
    monkeypatch.setenv('COMMAND_API_KEY','test-command-key')
    from math import cos, pi, sin
    document=regionDocument()
    ring=[[.01+.009*cos(2*pi*i/360),.01+.009*sin(2*pi*i/360)] for i in range(360)]
    document['features'][-1]['geometry']['coordinates']=[ring+[ring[0]]]
    await importRegions(commandSession,document)
    await refreshSnapshots(commandSession)
    stored=json.loads((await commandSession.execute(text("SELECT ST_AsGeoJSON(geometry) FROM command_regions WHERE code='REFERENCE-3'"))).scalar_one())
    async def override():
        yield commandSession
    app.dependency_overrides[get_session]=override
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test',headers={'X-Command-Key':'test-command-key'}) as client:
            response=await client.get('/v1/command/regions?administrativeLevel=VILLAGE')
            assert response.status_code==200
            summary=response.json()[0]
            assert len(summary['geometry']['coordinates'][0][0]) < len(stored['coordinates'][0][0])
            detail=await client.get('/v1/command/regions/'+summary['id'])
            assert detail.status_code==200
            assert detail.json()['geometry']==stored
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def testInvalidHierarchyRejectedAtomically(commandSession):
    document=regionDocument(); document['features'][3]['properties']['parentCode']='REFERENCE-0'
    with pytest.raises(ValueError,match='parent missing'):
        async with commandSession.begin_nested():
            await importRegions(commandSession,document)
    assert (await commandSession.execute(text('SELECT count(*) FROM command_regions'))).scalar()==0


@pytest.mark.asyncio
async def testMicroscopicBoundaryNoiseAllowedButOutsideVillageRejected(commandSession):
    document=regionDocument()
    coordinates=document['features'][-1]['geometry']['coordinates'][0]
    for coordinate in coordinates:
        if coordinate[0]==.02:
            coordinate[0]+=.000000000001
    await importRegions(commandSession,document)
    with pytest.raises(Exception,match='child boundary outside parent'):
        async with commandSession.begin_nested():
            await commandSession.execute(text("UPDATE command_regions SET geometry=ST_Multi(ST_MakeEnvelope(0,0,.02001,.02,4326)) WHERE code='REFERENCE-3'"))


@pytest.mark.asyncio
async def testDatabaseHierarchyAndProvenanceConstraints(commandSession):
    await importRegions(commandSession,regionDocument())
    for sql in ["UPDATE command_regions SET population_source=NULL WHERE code='REFERENCE-3'",
                "UPDATE command_regions SET parent_id=(SELECT id FROM command_regions WHERE code='REFERENCE-0') WHERE code='REFERENCE-3'",
                "UPDATE command_regions SET data_mode='SIMULATION' WHERE code='REFERENCE-0'"]:
        with pytest.raises(Exception):
            async with commandSession.begin_nested():
                await commandSession.execute(text(sql))


@pytest.mark.asyncio
async def testAssistanceOverlappingNeedsAndShelterUnknown(commandSession):
    await importRegions(commandSession,regionDocument())
    now=datetime.now(timezone.utc)
    user=User(name='PRIVATE CITIZEN',phone='PRIVATE PHONE',location=from_shape(Point(.005,.005),srid=4326),locationObservedAt=now)
    commandSession.add(user); await commandSession.flush()
    for category in ['MOBILITY_LIMITATION','ELDERLY']:
        commandSession.add(UserAccessibility(user_id=user.id,type=category))
    commandSession.add(AssistanceRequest(userId=user.id,status='EVACUATING',updatedAt=now,support_needs=['MOBILITY_LIMITATION','HEARING_IMPAIRMENT']))
    commandSession.add(Shelter(name='Reference shelter',latitude=.005,longitude=.005,location=from_shape(Point(.005,.005),srid=4326),
        shelterType='PUBLIC',status='OPEN',capacity=100,currentOccupancy=None,source='Test shelter reference',verifiedAt=now))
    await commandSession.flush(); await refreshSnapshots(commandSession)
    result=await snapshot(commandSession)
    assert result['registeredUserCount']==1
    assert result['assistance']['activeAssistanceCount']==1
    assert result['assistance']['evacuatingCount']==1
    assert result['assistance']['unknownSafetyCount']==0
    assert result['assistance']['mobilityNeedCount']==1
    assert result['assistance']['elderlyNeedCount']==1
    assert result['assistance']['hearingNeedCount']==1
    assert result['assistance']['categoriesOverlap']
    assert 'knownShelterOccupancy' not in result
    assert 'availableShelterCount' not in result
    assert result['recordedShelterCount']==1
    assert result['totalShelterCapacity']==100
    assert 'capacityStatus' not in result['shelters'][0]
    assert 'PRIVATE' not in json.dumps(result)


@pytest.mark.asyncio
async def testSimulationExcludesLiveData(commandSession):
    await importRegions(commandSession,regionDocument('SIMULATION'))
    await addHazard(commandSession,hazard('CRITICAL_HAZARD'))
    await refreshSnapshots(commandSession)
    result=await snapshot(commandSession,'SIMULATION')
    assert result['dataMode']=='SIMULATION'
    assert result['signalLevel']=='UNKNOWN'
    assert result['populationSource']=='SIMULATION TEST'
    assert result['estimatedExposedPopulation'] is None
    assert result['registeredUserCount'] is None
    assert result['assistance']['mobilityNeedCount'] is None
    assert result['hazards']==[]


@pytest.mark.asyncio
async def testAPIRequiresKeyFiltersAndNoPII(commandSession,monkeypatch):
    monkeypatch.setenv('COMMAND_API_KEY','test-command-key')
    await importRegions(commandSession,regionDocument())
    user=User(name='API PRIVATE CITIZEN',phone='API PRIVATE PHONE',location=from_shape(Point(.005,.005),srid=4326),locationObservedAt=datetime.now(timezone.utc))
    commandSession.add(user); await commandSession.flush()
    commandSession.add(AssistanceRequest(userId=user.id,status='REQUESTED',message='API PRIVATE MESSAGE',updatedAt=datetime.now(timezone.utc)))
    await commandSession.flush()
    await refreshSnapshots(commandSession)
    async def override():
        yield commandSession
    app.dependency_overrides[get_session]=override
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
            headers={'X-Command-Key':'test-command-key'}
            assert (await client.get('/v1/command/regions',headers=headers)).status_code==200
            response=await client.get('/v1/command/regions?administrativeLevel=VILLAGE&signalLevel=UNKNOWN',headers=headers)
            assert response.status_code==200
            assert response.headers['cache-control']=='no-store'
            assert len(response.json())==1
            regionId=response.json()[0]['id']
            for suffix in ['', '/hazards','/shelters','/assistance']:
                result=await client.get('/v1/command/regions/'+regionId+suffix,headers=headers)
                assert result.status_code==200
                serialized=json.dumps(result.json())
                assert 'API PRIVATE' not in serialized
                assert str(user.id) not in serialized
                for forbidden in ['userId','buddyUserId','phone','household','latitude','longitude','sharingConsent','support_needs']:
                    assert '"'+forbidden+'"' not in serialized
            assert (await client.get('/v1/command/regions/'+str(uuid.uuid4()),headers=headers)).status_code==404
            assert (await client.get('/v1/command/regions?administrativeLevel=BAD',headers=headers)).status_code==422
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def testCommandKeyIsRequired(commandSession,monkeypatch):
    monkeypatch.setenv('COMMAND_API_KEY','test-command-key')
    async def override():
        yield commandSession
    app.dependency_overrides[get_session]=override
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
            for headers in [{},{'X-Command-Key':'wrong-key'}]:
                response=await client.get('/v1/command/regions',headers=headers)
                assert response.status_code==401
                assert response.json()['detail']=='Command API key required'
            response=await client.post('/v1/command/safe-houses',json={'id':str(uuid.uuid4()),'name':'Government safe house','latitude':.005,'longitude':.005})
            assert response.status_code==401
            assert response.json()['detail']=='Command API key required'
            monkeypatch.delenv('COMMAND_API_KEY',raising=False)
            response=await client.get('/v1/command/regions',headers={'X-Command-Key':'test-command-key'})
            assert response.status_code==503
            assert response.json()['detail']=='Command API is not configured'
            monkeypatch.setenv('COMMAND_API_KEY','')
            assert (await client.get('/v1/command/regions',headers={'X-Command-Key':'test-command-key'})).status_code==503
    finally:
        app.dependency_overrides.clear()


def testForwardHeadersOnlyIncludeCommandKeyForCommandURLs(monkeypatch):
    import importlib.util
    from pathlib import Path
    spec=importlib.util.spec_from_file_location('commandProxy',Path(__file__).parents[1]/'mapshit'/'server.py')
    server=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server)
    monkeypatch.setenv('COMMAND_API_KEY','test-command-key')
    for path in ['/v1/command','/v1/command?limit=1','/v1/command/regions']:
        assert server.forwardHeaders(server.BACKEND_URL+path)=={'Content-Type':'application/json','X-Command-Key':'test-command-key'}
    for targetUrl in [server.BACKEND_URL+path for path in ['/v1/external-data/status','/health','/v1/navigation/context','/v1/command-other']]+[server.VALHALLA_URL+'/route','http://other-backend/v1/command/regions']:
        assert server.forwardHeaders(targetUrl)=={'Content-Type':'application/json'}
    monkeypatch.delenv('COMMAND_API_KEY',raising=False)
    assert server.forwardHeaders(server.BACKEND_URL+'/v1/command/regions')=={'Content-Type':'application/json'}


@pytest.mark.asyncio
async def testExpiredSnapshotMasksOperationalValues(commandSession):
    await importRegions(commandSession,regionDocument())
    await addHazard(commandSession,hazard('CRITICAL_HAZARD'))
    await refreshSnapshots(commandSession)
    payload=await snapshot(commandSession)
    payload['simulation']={'signalLevel':'CRITICAL','hazardTypes':['FLOOD'],'names':['Expired drill']}
    payload['snapshotExpiresAt']=(datetime.now(timezone.utc)-timedelta(seconds=1)).isoformat()
    result=readProjection(None,payload,regionDocument()['features'][-1]['geometry'],{'type':'Point','coordinates':[.01,.01]})
    assert result.snapshotStale
    assert result.simulation is None
    assert result.signalLevel=='UNKNOWN'
    assert result.estimatedExposedPopulation is None
    assert result.activeAssistanceCount is None
    assert result.assistance.mobilityNeedCount is None


def testImporterRejectsBrokenBoundariesAndDuplicates():
    document=regionDocument()
    document['features'][0]['geometry']={'type':'Point','coordinates':[0,0]}
    with pytest.raises(ValueError,match='polygon'):
        validateFeatures(document)
    document=regionDocument(); document['features'].append(copy.deepcopy(document['features'][0]))
    with pytest.raises(ValueError,match='unique'):
        validateFeatures(document)


@pytest.mark.asyncio
async def testLatestRequestDeterminesUnknownSafety(commandSession):
    await importRegions(commandSession,regionDocument())
    now=datetime.now(timezone.utc)
    user=User(location=from_shape(Point(.005,.005),srid=4326),locationObservedAt=now)
    commandSession.add(user); await commandSession.flush()
    commandSession.add_all([AssistanceRequest(userId=user.id,status='SAFE',updatedAt=now-timedelta(hours=1)),
        AssistanceRequest(userId=user.id,status='REQUESTED',updatedAt=now)])
    await commandSession.flush(); await refreshSnapshots(commandSession)
    result=await snapshot(commandSession)
    assert result['assistance']['unknownSafetyCount']==1
    assert result['assistance']['safeCheckInCount']==1
    assert result['assistance']['activeAssistanceCount']==1


@pytest.mark.asyncio
async def testPointObservationCannotEstimatePopulation(commandSession):
    await importRegions(commandSession,regionDocument())
    item=HazardEvidence(sourceId='point',source='TEST_REFERENCE',hazardType='FLOOD',authority='COMMUNITY',evidenceType='OBSERVATION',
        geometry={'type':'Point','coordinates':[.005,.005]},observedAt=datetime.now(timezone.utc))
    await addHazard(commandSession,item); await refreshSnapshots(commandSession)
    result=await snapshot(commandSession)
    assert result['signalLevel']=='WATCH'
    assert result['estimatedExposedPopulation'] is None
    assert result['exposureFraction'] is None
    assert result['hazards'][0]['provenanceClass']=='COMMUNITY_OBSERVATION'


@pytest.mark.asyncio
async def testStaleShelterAndMissingLocationsStayUnknown(commandSession):
    await importRegions(commandSession,regionDocument())
    commandSession.add(User(location=from_shape(Point(.005,.005),srid=4326),locationObservedAt=datetime.now(timezone.utc)-timedelta(days=2)))
    commandSession.add(Shelter(name='Reference stale shelter',latitude=.005,longitude=.005,location=from_shape(Point(.005,.005),srid=4326),
        shelterType='PUBLIC',status='OPEN',capacity=100,currentOccupancy=0,source='Test shelter reference',verifiedAt=datetime.now(timezone.utc)-timedelta(days=2)))
    await commandSession.flush(); await refreshSnapshots(commandSession)
    result=await snapshot(commandSession)
    assert result['registeredUserCount']==0
    assert 'availableShelterCount' not in result
    assert 'currentOccupancy' not in result['shelters'][0]
    assert result['signalLevel']=='UNKNOWN'


@pytest.mark.asyncio
async def testSafeHouseCreatePersistsRefreshesAndRetries(commandSession,monkeypatch):
    monkeypatch.setenv('COMMAND_API_KEY','test-command-key')
    await importRegions(commandSession,regionDocument())
    async def override():
        yield commandSession
    app.dependency_overrides[get_session]=override
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test',headers={'X-Command-Key':'test-command-key'}) as client:
            payload={'id':str(uuid.uuid4()),'name':' Government safe house ','latitude':.005,'longitude':.005,
                'status':'OPEN','capacity':50,'verifiedNow':True}
            response=await client.post('/v1/command/safe-houses',json=payload)
            assert response.status_code==201, response.text
            assert response.json()['name']=='Government safe house'
            assert response.json()['source']=='GOVERNMENT_DASHBOARD_REPORTED'
            payload['name']='Government safe house'
            replay=await client.post('/v1/command/safe-houses',json=payload)
            assert replay.status_code==201
            assert replay.json()['id']==response.json()['id']
            houses=await client.get('/v1/command/safe-houses')
            assert len(houses.json())==1
            regionId=str((await commandSession.execute(select(Region.id).where(Region.code=='REFERENCE-3'))).scalar_one())
            detail=(await client.get('/v1/command/regions/'+regionId)).json()
            assert detail['recordedShelterCount']==1
            assert 'knownShelterOccupancy' not in detail
            assert 'capacityStatus' not in detail['shelters'][0]
            assert (await client.post('/v1/command/safe-houses',json={**payload,'name':'Changed'})).status_code==409
            assert len((await client.get('/v1/command/safe-houses')).json())==1
            for invalid in [{'latitude':91},{'longitude':-181},{'name':'  '},{'capacity':2,'currentOccupancy':3},{'capacity':-1},{'capacity':1.5},{'mock':True}]:
                assert (await client.post('/v1/command/safe-houses',json={**payload,'id':str(uuid.uuid4()),**invalid})).status_code==422
            assert len((await client.get('/v1/command/safe-houses')).json())==1
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def testUnverifiedSafeHouseRemainsUnknown(commandSession,monkeypatch):
    monkeypatch.setenv('COMMAND_API_KEY','test-command-key')
    await importRegions(commandSession,regionDocument())
    async def override():
        yield commandSession
    app.dependency_overrides[get_session]=override
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test',headers={'X-Command-Key':'test-command-key'}) as client:
            response=await client.post('/v1/command/safe-houses',json={'id':str(uuid.uuid4()),'name':'Unverified place','latitude':.005,'longitude':.005,'status':'OPEN','capacity':20})
            assert response.status_code==201
            result=await snapshot(commandSession)
            assert 'availableShelterCount' not in result
            assert 'capacityStatus' not in result['shelters'][0]
            assert result['shelters'][0]['verifiedAt'] is None
    finally:
        app.dependency_overrides.clear()


def testCommandProxyReturnsJSONOnSaveTimeout(monkeypatch):
    from io import BytesIO
    from mapshit.server import Handler
    statuses=[]
    timeouts=[]
    def timeout(request,timeout):
        timeouts.append(timeout)
        raise TimeoutError('upstream read timed out')
    monkeypatch.setattr('mapshit.server.urlopen',timeout)
    handler=SimpleNamespace(path='/api/command/safe-houses',command='POST',headers={},
        send_response=statuses.append,send_header=lambda *args:None,end_headers=lambda:None,wfile=BytesIO())
    Handler.forward(handler,'http://localhost:8000/v1/command/safe-houses',b'{}')
    assert statuses==[504]
    assert timeouts==[120]
    assert 'Retry the same submission' in json.loads(handler.wfile.getvalue())['detail']


def testDashboardProxyUsesSharedComposeServices(monkeypatch):
    from io import BytesIO
    from mapshit.server import Handler
    monkeypatch.setattr('mapshit.server.BACKEND_URL','http://backend:8000')
    monkeypatch.setattr('mapshit.server.VALHALLA_URL','http://valhalla:8002')
    calls=[]
    handler=SimpleNamespace(path='/api/command/regions?limit=1',forward=lambda *args:calls.append(args))
    Handler.do_GET(handler)
    assert calls.pop()==('http://backend:8000/v1/command/regions?limit=1',)
    handler.path='/health'
    Handler.do_GET(handler)
    assert calls.pop()==('http://backend:8000/health',)
    handler.path='/api/navigation/context?latitude=0'
    assert Handler.navigationUrl(handler)=='http://backend:8000/v1/navigation/context?latitude=0'
    handler.path='/api/external/status'
    assert Handler.externalUrl(handler)=='http://backend:8000/v1/external-data/status'
    handler.path='/api/command/safe-houses'
    handler.headers={'Content-Length':'2'}
    handler.rfile=BytesIO(b'{}')
    Handler.do_POST(handler)
    assert calls.pop()==('http://backend:8000/v1/command/safe-houses',b'{}')
    handler.path='/route'
    handler.rfile=BytesIO(b'{}')
    Handler.do_POST(handler)
    assert calls.pop()==('http://valhalla:8002/route',b'{}')


@pytest.mark.asyncio
async def testMockDisastersReachPhonesAndStaySeparate(commandSession,monkeypatch):
    import math
    from geoalchemy2.shape import to_shape
    from app.services import alertService, alertSimulation
    monkeypatch.setenv('COMMAND_API_KEY','test-command-key')
    monkeypatch.setenv('COMMAND_MOCK_ALERTS_ENABLED','1')
    document=regionDocument()
    other=copy.deepcopy(document['features'][-1])
    other['properties'].update(code='REFERENCE-2-other',name='Other village')
    # Split the fixture village into west and east halves so both stay inside their district.
    document['features'][-1]['geometry']['coordinates']=[[[0,0],[.01,0],[.01,.02],[0,.02],[0,0]]]
    other['geometry']['coordinates']=[[[.01,0],[.02,0],[.02,.02],[.01,.02],[.01,0]]]
    document['features'].append(other)
    await importRegions(commandSession,document)
    await refreshSnapshots(commandSession)
    now=datetime.now(timezone.utc)
    inside=User(latitude=.005,longitude=.005,location=from_shape(Point(.005,.005),srid=4326),locationObservedAt=now)
    outside=User(latitude=.005,longitude=.015,location=from_shape(Point(.015,.005),srid=4326),locationObservedAt=now)
    commandSession.add_all([inside,outside]); await commandSession.flush()
    async def override():
        yield commandSession
    app.dependency_overrides[get_session]=override
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test',headers={'X-Command-Key':'test-command-key'}) as client:
            url='/v1/command/mock-disasters'
            regionsUrl='/v1/command/regions?administrativeLevel=VILLAGE'
            before=(await client.get(regionsUrl)).json()
            village=next(row for row in before if row['code']=='REFERENCE-3')
            assert before[0]['id']!=village['id']
            payload={'id':str(uuid.uuid4()),'name':' Flood drill ','hazardType':'FLOOD','latitude':.005,'longitude':.005,'radiusM':300,'severity':'CRITICAL'}
            response=await client.post(url,json=payload)
            assert response.status_code==201, response.text
            assert response.json()['name']=='Flood drill'
            listed=(await client.get(url)).json()
            assert len(listed)==1
            assert listed[0]['radiusM']==300
            assert datetime.fromisoformat(listed[0]['expiresAt'].replace('Z','+00:00'))>now
            regions=(await client.get(regionsUrl)).json()
            assert regions[0]['id']==village['id']
            region=regions[0]
            assert region['simulation']=={'signalLevel':'CRITICAL','hazardTypes':['FLOOD'],'names':['Flood drill']}
            for key in ['signalLevel','hazardTypes','authoritativeCriticalHazard','estimatedExposedPopulation','exposureFraction']:
                assert region[key]==village[key]
            detail=(await client.get('/v1/command/regions/'+village['id'])).json()
            assert detail['hazards']==[]
            alerts=await alertService.listAlerts(commandSession,inside)
            assert len(alerts.items)==1
            assert alerts.items[0].level=='awas'
            assert not (await alertService.listAlerts(commandSession,outside)).items
            row=(await commandSession.execute(select(HazardRecord).where(HazardRecord.sourceId=='command-mock-'+payload['id']))).scalar_one()
            assert row.evidenceMetadata['officialStatus']=='AWAS'
            points=list(to_shape(row.geometry).exterior.coords)
            assert len(points)==65 and points[0]==points[-1]
            for longitude,latitude in points:
                lat1,lat2=map(math.radians,[payload['latitude'],latitude])
                dLat=lat2-lat1
                dLon=math.radians(longitude-payload['longitude'])
                distance=6371000*2*math.asin(math.sqrt(math.sin(dLat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dLon/2)**2))
                assert abs(distance-payload['radiusM'])<payload['radiusM']*.01
            expiresAt=datetime.now(timezone.utc)+timedelta(seconds=30)
            row.validUntil=expiresAt
            await commandSession.flush()
            await refreshSnapshots(commandSession)
            snapshot=(await client.get('/v1/command/regions/'+village['id'])).json()
            assert datetime.fromisoformat(snapshot['snapshotExpiresAt'].replace('Z','+00:00'))<=expiresAt
            replay=await client.post(url,json={**payload,'name':'Updated drill','radiusM':350})
            assert replay.status_code==201
            assert len((await client.get(url)).json())==1
            assert (await client.get(url)).json()[0]['radiusM']==350
            assert (await client.delete(url+'/'+payload['id'])).status_code==204
            assert (await client.get(url)).json()==[]
            assert next(row for row in (await client.get(regionsUrl)).json() if row['id']==village['id'])['simulation'] is None
            assert not (await alertService.listAlerts(commandSession,inside)).items
            assert (await client.delete(url+'/'+str(uuid.uuid4()))).status_code==404
            cliRow,_=await alertSimulation.apply(commandSession,'awas',center=(.005,.005))
            cliId=cliRow.id
            assert (await client.post(url,json=payload)).status_code==201
            assert (await client.delete(url)).status_code==204
            assert (await client.get(url)).json()==[]
            assert (await commandSession.execute(select(HazardRecord.id).where(HazardRecord.source==alertSimulation.SOURCE))).scalars().all()==[cliId]
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def testMockDisasterCountsFreshUsersWithoutIdentifiers(commandSession,monkeypatch):
    monkeypatch.setenv('COMMAND_API_KEY','test-command-key')
    monkeypatch.setenv('COMMAND_MOCK_ALERTS_ENABLED','1')
    now=datetime.now(timezone.utc)
    inside=User(name='PRIVATE INSIDE',latitude=.005,longitude=.005,location=from_shape(Point(.005,.005),srid=4326),locationObservedAt=now-timedelta(hours=1))
    commandSession.add(inside); await commandSession.flush()
    async def override():
        yield commandSession
    app.dependency_overrides[get_session]=override
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test',headers={'X-Command-Key':'test-command-key'}) as client:
            url='/v1/command/mock-disasters'
            payload={'id':str(uuid.uuid4()),'name':'Drill','hazardType':'FLOOD','latitude':.005,'longitude':.005,'radiusM':300,'severity':'CRITICAL'}
            expectedKeys={'id','name','hazardType','latitude','longitude','radiusM','severity','expiresAt','usersInArea'}
            response=await client.post(url,json=payload)
            assert response.status_code==201, response.text
            assert response.json()['usersInArea'] is None
            assert set(response.json())==expectedKeys
            others=[User(name='PRIVATE INSIDE',latitude=.005,longitude=.005,location=from_shape(Point(.005,.005),srid=4326),locationObservedAt=now-timedelta(hours=1)) for _ in range(4)]
            outside=User(name='PRIVATE OUTSIDE',latitude=.005,longitude=.015,location=from_shape(Point(.015,.005),srid=4326),locationObservedAt=now-timedelta(hours=1))
            stale=User(name='PRIVATE STALE',latitude=.005,longitude=.005,location=from_shape(Point(.005,.005),srid=4326),locationObservedAt=now-timedelta(hours=30))
            commandSession.add_all([*others,outside,stale]); await commandSession.flush()
            response=await client.post(url,json=payload)
            assert response.status_code==201, response.text
            assert response.json()['usersInArea']==5
            assert set(response.json())==expectedKeys
            listed=await client.get(url)
            assert listed.status_code==200, listed.text
            assert len(listed.json())==1
            assert listed.json()[0]['usersInArea']==5
            assert set(listed.json()[0])==expectedKeys
            for body in [response.json(),listed.json()[0]]:
                encoded=json.dumps(body)
                assert 'PRIVATE' not in encoded
                assert all(str(user.id) not in encoded for user in [inside,*others,outside,stale])
            far={**payload,'id':str(uuid.uuid4()),'name':'Far drill','latitude':.5,'longitude':.5}
            assert (await client.post(url,json=far)).status_code==201
            overlapping={**payload,'id':str(uuid.uuid4()),'name':'Overlapping drill'}
            assert (await client.post(url,json=overlapping)).status_code==201
            with monkeypatch.context() as patch:
                execute=AsyncMock(wraps=commandSession.execute)
                patch.setattr(commandSession,'execute',execute)
                listed=await client.get(url)
                assert listed.status_code==200, listed.text
                counts={row['name']:row['usersInArea'] for row in listed.json()}
                assert counts=={'Drill':5,'Far drill':None,'Overlapping drill':5}
                assert execute.await_count==2
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def testMockDisasterValidationAndKey(commandSession,monkeypatch):
    monkeypatch.setenv('COMMAND_API_KEY','test-command-key')
    monkeypatch.setenv('COMMAND_MOCK_ALERTS_ENABLED','1')
    async def override():
        yield commandSession
    app.dependency_overrides[get_session]=override
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
            url='/v1/command/mock-disasters'
            payload={'id':str(uuid.uuid4()),'name':'Drill','hazardType':'FLOOD','latitude':.005,'longitude':.005,'radiusM':300,'severity':'CRITICAL'}
            for method,path in [('POST',url),('GET',url),('DELETE',url),('DELETE',url+'/'+payload['id'])]:
                assert (await client.request(method,path,json=payload if method=='POST' else None)).status_code==401
            for invalid in [{'radiusM':49},{'name':'  '},{'radiusM':300.5},{'radiusM':True},{'radiusM':50001},{'latitude':91},{'longitude':181},{'latitude':0,'longitude':179.999,'radiusM':300},{'latitude':89.999,'longitude':0,'radiusM':300},{'extra':True}]:
                response=await client.post(url,json={**payload,**invalid},headers={'X-Command-Key':'test-command-key'})
                assert response.status_code==422, response.text
            monkeypatch.delenv('COMMAND_MOCK_ALERTS_ENABLED',raising=False)
            response=await client.post(url,json=payload,headers={'X-Command-Key':'test-command-key'})
            assert response.status_code==403
            assert response.json()=={'detail':'Mock disasters are disabled on this server. Set COMMAND_MOCK_ALERTS_ENABLED=1 to allow test alerts.'}
            assert (await client.get(url,headers={'X-Command-Key':'test-command-key'})).status_code==200
            assert (await client.delete(url,headers={'X-Command-Key':'test-command-key'})).status_code==204
    finally:
        app.dependency_overrides.clear()



def testMockDisasterDeleteProxy(monkeypatch):
    from mapshit.server import Handler
    monkeypatch.setattr('mapshit.server.BACKEND_URL','http://backend:8000')
    calls=[]
    handler=SimpleNamespace(path='/api/command/mock-disasters',forward=lambda *args:calls.append(args))
    Handler.do_DELETE(handler)
    assert calls.pop()==('http://backend:8000/v1/command/mock-disasters',)
    handler.path='/api/command/mock-disasters/'+str(uuid.uuid4())
    Handler.do_DELETE(handler)
    assert calls.pop()==('http://backend:8000/v1/command'+handler.path.removeprefix('/api/command'),)
