from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Boolean, Float, Integer, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models.hazard import HazardType
from command.access import requireCommandKey
from command.models import Region, RegionalOperationalSnapshot
from command.schemas import AdministrativeLevel, AssistanceAggregate, HazardSummary, RegionDetail, RegionSummary, ShelterSummary, SignalLevel

router = APIRouter(prefix='/v1/command',tags=['Command center'],dependencies=[Depends(requireCommandKey)])


def readProjection(region, payload, geometry, centroid):
    if payload is None:
        return RegionDetail(id=region.id,code=region.code,name=region.name,administrativeLevel=region.administrativeLevel,
            parentRegionId=region.parentId,geometry=geometry,centroid=centroid,population=region.population,
            populationReferenceYear=region.populationReferenceYear,populationSource=region.populationSource,
            boundarySource=region.boundarySource,dataMode=region.dataMode,limitations=['Regional projection has not been refreshed.'])
    # Accept stored projections from before occupancy tracking was removed.
    payload = {key:value for key,value in payload.items() if key not in {'availableShelterCount','shelterPressure','knownShelterOccupancy','unknownShelterOccupancyCount'}}
    payload['shelters'] = [{key:value for key,value in shelter.items() if key not in {'currentOccupancy','capacityStatus'}} for shelter in payload.get('shelters', [])]
    for shelter in payload['shelters']:
        if shelter.get('status') == 'FULL':
            shelter['status'] = 'UNKNOWN'
    detail = RegionDetail.model_validate(payload)
    now = datetime.now(timezone.utc)
    if detail.snapshotExpiresAt is None or detail.snapshotExpiresAt <= now:
        detail.snapshotStale = True
        detail.signalLevel = 'UNKNOWN'
        detail.authoritativeCriticalHazard = False
        detail.evidenceFreshness = 'STALE'
        detail.estimatedExposedPopulation = None
        detail.exposureFraction = None
        detail.exposureEstimationMethod = 'UNKNOWN'
        detail.hazardTypes = []
        detail.activeAssistanceCount = None
        detail.assistance = AssistanceAggregate()
        detail.registeredUserCount = None
    for hazard in detail.hazards:
        if hazard.expiresAt is not None and hazard.expiresAt <= now:
            hazard.active = False
            hazard.freshness = 'EXPIRED'
    return detail


def projectionQuery():
    return select(Region,RegionalOperationalSnapshot.payload,
        func.ST_AsGeoJSON(Region.geometry),func.ST_AsGeoJSON(Region.centroid)).outerjoin(
        RegionalOperationalSnapshot,Region.id==RegionalOperationalSnapshot.regionId)


def projectRow(row):
    import json
    return readProjection(row[0],row[1],json.loads(row[2]),json.loads(row[3]))


async def detailFor(session,regionId):
    row = (await session.execute(projectionQuery().where(Region.id==regionId))).first()
    if row is None:
        raise HTTPException(404,'Region not found')
    return projectRow(row)


@router.get('/regions',response_model=list[RegionSummary])
async def listRegions(administrativeLevel: AdministrativeLevel | None = None,parentRegionId: UUID | None = None,
    hazardType: HazardType | None = None,signalLevel: SignalLevel | None = None,
    dataMode: str = Query('REFERENCE',pattern='^(REFERENCE|SIMULATION)$'),
    limit: int = Query(200,ge=1,le=1000),offset: int = Query(0,ge=0),session: AsyncSession = Depends(get_session)):
    query = projectionQuery().where(Region.dataMode==dataMode)
    if administrativeLevel:
        query=query.where(Region.administrativeLevel==administrativeLevel)
    if parentRegionId:
        query=query.where(Region.parentId==parentRegionId)
    # Filters are evaluated after masking stale snapshots, before pagination.
    if hazardType:
        query=query.where(RegionalOperationalSnapshot.payload['hazardTypes'].contains([hazardType.value]),RegionalOperationalSnapshot.expiresAt > func.now())
    payload=RegionalOperationalSnapshot.payload
    current=RegionalOperationalSnapshot.expiresAt > func.now()
    effective=case((current,payload['signalLevel'].astext),else_='UNKNOWN')
    if signalLevel:
        query=query.where(effective==signalLevel)
    ranking=case({'CRITICAL':0,'ELEVATED':1,'WATCH':2,'UNKNOWN':3,'NORMAL':4},value=effective,else_=3)
    critical=func.coalesce(case((current,payload['authoritativeCriticalHazard'].astext.cast(Boolean)),else_=False),False)
    exposed=case((current,payload['estimatedExposedPopulation'].astext.cast(Integer)),else_=None)
    assistance=case((current,payload['activeAssistanceCount'].astext.cast(Integer)),else_=None)
    fresh=func.coalesce(case((current,payload['evidenceFreshness'].astext=='FRESH'),else_=False),False)
    rows=(await session.execute(query.order_by(ranking,critical.desc().nullslast(),exposed.desc().nullslast(),
        assistance.desc().nullslast(),fresh,Region.code).limit(limit).offset(offset))).all()
    details=[projectRow(row) for row in rows]
    return [RegionSummary.model_validate({key:value for key,value in d.model_dump().items() if key in RegionSummary.model_fields}) for d in details]


@router.get('/regions/{regionId}',response_model=RegionDetail)
async def regionDetail(regionId: UUID,session: AsyncSession = Depends(get_session)):
    return await detailFor(session,regionId)


@router.get('/regions/{regionId}/hazards',response_model=list[HazardSummary])
async def regionHazards(regionId: UUID,session: AsyncSession = Depends(get_session)):
    return (await detailFor(session,regionId)).hazards


@router.get('/regions/{regionId}/shelters',response_model=list[ShelterSummary])
async def regionShelters(regionId: UUID,session: AsyncSession = Depends(get_session)):
    return (await detailFor(session,regionId)).shelters


@router.get('/regions/{regionId}/assistance',response_model=AssistanceAggregate)
async def regionAssistance(regionId: UUID,session: AsyncSession = Depends(get_session)):
    return (await detailFor(session,regionId)).assistance
