import csv
import hashlib
import io
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlparse

import httpx
from defusedxml import ElementTree

from app import config
from app.models.hazard import Authority, EvidenceType, HazardEvidence, HazardType
from app.utils.hazardGeometry import normalizedGeometry


class CredentialFilter(logging.Filter):
    def filter(self, record):
        if config.FIRMS_MAP_KEY:
            message = record.getMessage()
            if config.FIRMS_MAP_KEY in message:
                record.msg = message.replace(config.FIRMS_MAP_KEY, '[REDACTED]')
                record.args = ()
        return True


for loggerName in ('httpx', 'httpcore.http11', 'httpcore.http2', 'httpcore.connection', 'httpcore.proxy'):
    logging.getLogger(loggerName).addFilter(CredentialFilter())


def timestamp(value: str) -> datetime:
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('timestamp has no timezone')
    return result


def stableId(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


async def getData(client, url: str, params=None):
    response = await client.get(url, params=params)
    response.raise_for_status()
    if len(response.content) > 20_000_000:
        raise ValueError('provider response exceeds ingestion bound')
    return response


def parseEarthquakes(payload: dict, now: datetime) -> list[HazardEvidence]:
    events = payload['Infogempa']['gempa']
    events = events if isinstance(events, list) else [events]
    result = []
    for event in events:
        latitude, longitude = [float(value) for value in event['Coordinates'].split(',')]
        observed = timestamp(event['DateTime'])
        expires = observed + timedelta(seconds=config.HAZARD_EVENT_MAX_AGE_SECONDS)
        if observed > now or expires <= now:
            continue
        result.append(HazardEvidence(sourceId=stableId(f'{observed.isoformat()}:{latitude}:{longitude}'), hazardType=HazardType.EARTHQUAKE, source='BMKG_EARTHQUAKE', authority=Authority.OFFICIAL, evidenceType=EvidenceType.OBSERVATION, geometry=normalizedGeometry({'type': 'Point', 'coordinates': [longitude, latitude]}), observedAt=observed, validFrom=observed, validUntil=min(expires, now + timedelta(seconds=config.HAZARD_TTLS['BMKG_EARTHQUAKE'] * 2)), metadata={'attribution': 'BMKG', 'magnitude': event.get('Magnitude'), 'depth': event.get('Kedalaman'), 'tsunamiContext': event.get('Potensi'), 'damageStatus': 'UNKNOWN'}))
    return result


def parseCap(xml: str, now: datetime) -> list[HazardEvidence]:
    root = ElementTree.fromstring(xml)
    ns = {'cap': 'urn:oasis:names:tc:emergency:cap:1.2'}
    if root.findtext('cap:status', namespaces=ns) != 'Actual' or root.findtext('cap:msgType', namespaces=ns) not in {'Alert', 'Update'}:
        return []
    identifier = root.findtext('cap:identifier', namespaces=ns)
    if not identifier:
        raise ValueError('CAP identifier missing')
    result = []
    for infoIndex, info in enumerate(root.findall('cap:info', ns)):
        effective = timestamp(info.findtext('cap:effective', namespaces=ns) or root.findtext('cap:sent', namespaces=ns))
        expires = timestamp(info.findtext('cap:expires', namespaces=ns))
        if expires <= now or effective > now:
            continue
        officialStatus = config.BMKG_CAP_OFFICIAL_STATUS.get(info.findtext('cap:severity', namespaces=ns))
        for index, polygon in enumerate(info.findall('cap:area/cap:polygon', ns)):
            coordinates = []
            for point in (polygon.text or '').split():
                latitude, longitude = [float(value) for value in point.split(',')]
                coordinates.append([longitude, latitude])
            if not coordinates:
                continue
            if coordinates[-1] != coordinates[0]:
                coordinates.append(coordinates[0])
            result.append(HazardEvidence(sourceId=stableId(f'{identifier}:{infoIndex}:{index}'), hazardType=HazardType.EXTREME_WEATHER, source='BMKG_CAP', authority=Authority.OFFICIAL, evidenceType=EvidenceType.ACTIVE_WARNING, geometry=normalizedGeometry({'type': 'Polygon', 'coordinates': [coordinates]}), observedAt=timestamp(root.findtext('cap:sent', namespaces=ns)), validFrom=effective, validUntil=expires, metadata={'attribution': 'BMKG', 'identifier': identifier, 'event': info.findtext('cap:event', namespaces=ns), 'capSeverity': info.findtext('cap:severity', namespaces=ns), 'capCertainty': info.findtext('cap:certainty', namespaces=ns), 'instruction': info.findtext('cap:instruction', namespaces=ns)}))
            if officialStatus:
                result[-1].metadata['officialStatus'] = officialStatus
    return result


def parseFirms(csvText: str, now: datetime) -> list[HazardEvidence]:
    result = []
    reader = csv.DictReader(io.StringIO(csvText))
    if not reader.fieldnames or not {'latitude', 'longitude', 'acq_date', 'acq_time'} <= set(reader.fieldnames):
        raise ValueError('invalid FIRMS CSV')
    for row in reader:
        observed = timestamp(f"{row['acq_date']}T{row['acq_time'].zfill(4)[:2]}:{row['acq_time'].zfill(4)[2:]}:00+00:00")
        if observed > now or observed + timedelta(seconds=config.HAZARD_EVENT_MAX_AGE_SECONDS) <= now:
            continue
        confidence = row.get('confidence', '').lower()
        quality = {'l': 0.2, 'n': 0.5, 'h': 0.8}.get(confidence)
        normalizedConfidence = None
        if quality is None and confidence.replace('.', '', 1).isdigit():
            quality = max(0, min(1, float(confidence) / 100))
            normalizedConfidence = quality
        result.append(HazardEvidence(sourceId=stableId(f"{row['latitude']}:{row['longitude']}:{observed}:{row.get('satellite')}:{row.get('instrument')}"), hazardType=HazardType.WILDFIRE, source='FIRMS', authority=Authority.SATELLITE_OBSERVATION, evidenceType=EvidenceType.OBSERVATION, geometry=normalizedGeometry({'type': 'Point', 'coordinates': [float(row['longitude']), float(row['latitude'])]}), confidence=normalizedConfidence, observedAt=observed, validFrom=observed, validUntil=min(observed + timedelta(seconds=config.HAZARD_EVENT_MAX_AGE_SECONDS), now + timedelta(seconds=config.HAZARD_TTLS['FIRMS'] * 2)), metadata={'attribution': 'NASA FIRMS', 'sensor': config.FIRMS_SOURCE, 'rawConfidence': row.get('confidence'), 'qualityWeight': quality, 'qualityMapping': 'EXPERIMENTAL for categorical values; not probability of fire', 'frp': row.get('frp'), 'perimeter': False}))
    return result


def communityEvidence(reports: list[dict], now: datetime) -> list[HazardEvidence]:
    result = []
    for row in reports:
        if row.get('latitude') is None or row.get('longitude') is None:
            continue
        if str(row.get('disaster_type', 'flood')).lower() != 'flood':
            continue
        observed = timestamp(row['created_at']) if row.get('created_at') else None
        expiry = now + timedelta(seconds=config.HAZARD_TTLS['PETABENCANA'] * 2)
        if observed:
            expiry = min(expiry, observed + timedelta(seconds=config.HAZARD_COMMUNITY_MAX_AGE_SECONDS))
        if expiry <= now:
            continue
        result.append(HazardEvidence(sourceId=str(row.get('report_id') or stableId(str(row))), hazardType=HazardType.FLOOD, source='PETABENCANA', authority=Authority.COMMUNITY, evidenceType=EvidenceType.OBSERVATION, geometry=normalizedGeometry({'type': 'Point', 'coordinates': [row['longitude'], row['latitude']]}), observedAt=observed, validUntil=expiry, metadata={'attribution': 'PetaBencana', 'timestampKnown': observed is not None}))
    return result


async def fetchProvider(source: str, now: datetime) -> list[HazardEvidence]:
    async with httpx.AsyncClient(timeout=config.HTTP_TIMEOUT_SECONDS, headers={'User-Agent': config.USER_AGENT}, follow_redirects=False) as client:
        if source == 'BMKG_EARTHQUAKE':
            return parseEarthquakes((await getData(client, config.BMKG_EARTHQUAKE_URL)).json(), now)
        if source == 'BMKG_CAP':
            feed = ElementTree.fromstring((await getData(client, config.BMKG_CAP_URL)).text)
            links = [node.text for node in feed.findall('.//item/link') if node.text]
            if len(links) > 40:
                raise ValueError('CAP feed exceeds provincial request bound')
            items = []
            for link in dict.fromkeys(links):
                url = urljoin(config.BMKG_CAP_URL, link)
                if urlparse(url).netloc != urlparse(config.BMKG_CAP_URL).netloc or urlparse(url).scheme != 'https':
                    raise ValueError('untrusted CAP detail URL')
                items.extend(parseCap((await getData(client, url)).text, now))
            return items
        if source == 'FIRMS':
            if not config.FIRMS_MAP_KEY:
                raise ValueError('FIRMS_UNCONFIGURED')
            url = f'{config.FIRMS_BASE_URL}/api/area/csv/{config.FIRMS_MAP_KEY}/{config.FIRMS_SOURCE}/{config.HAZARD_AREA}/1'
            return parseFirms((await getData(client, url)).text, now)
        if source == 'PETABENCANA':
            from app.services.petabencana_service import fetch_reports
            response = await fetch_reports()
            if not response.available:
                raise ValueError('PETABENCANA_UNAVAILABLE')
            return communityEvidence(response.reports or [], now)
    raise ValueError('unknown hazard provider')
