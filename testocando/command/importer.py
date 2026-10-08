import uuid

from geoalchemy2.shape import from_shape
from shapely.geometry import MultiPolygon, shape
from sqlalchemy import select

from command.models import Region

LEVELS = ['PROVINCE', 'CITY_REGENCY', 'DISTRICT', 'VILLAGE']


def validateFeatures(document):
    if document.get('type') != 'FeatureCollection' or not isinstance(document.get('features'), list):
        raise ValueError('expected EPSG:4326 GeoJSON FeatureCollection')
    if 'crs' in document:
        raise ValueError('reproject to RFC 7946 EPSG:4326 GeoJSON and remove legacy crs')
    features = []
    codes = set()
    for feature in document['features']:
        props = feature.get('properties', {})
        code = props.get('code')
        if not isinstance(code,str) or not code.strip() or len(code) > 64 or code in codes:
            raise ValueError('region codes must be unique nonempty strings, at most 64 characters')
        codes.add(code)
        level = props.get('administrativeLevel')
        if level not in LEVELS:
            raise ValueError('invalid administrativeLevel')
        for key,maximum in [('name',200),('boundarySource',256)]:
            if not isinstance(props.get(key),str) or not props[key].strip() or len(props[key]) > maximum:
                raise ValueError(f'{key} is required (max {maximum})')
        mode = props.get('dataMode')
        if mode not in {'REFERENCE','SIMULATION'}:
            raise ValueError('explicit dataMode REFERENCE or SIMULATION required')
        population = props.get('population')
        if population is not None:
            year,source = props.get('populationReferenceYear'),props.get('populationSource')
            if type(population) is not int or not 0 <= population <= 2147483647 or type(year) is not int or not 1900 <= year <= 2200 or not isinstance(source,str) or not source.strip() or len(source)>256:
                raise ValueError('population requires nonnegative integer, reference year and source')
            if mode == 'SIMULATION' and 'SIMULATION' not in source.upper() and 'DEMO' not in source.upper():
                raise ValueError('simulation population source must say SIMULATION or DEMO')
        try:
            geometry = shape(feature.get('geometry'))
        except (AttributeError, TypeError, ValueError) as error:
            raise ValueError('region requires valid polygon GeoJSON geometry') from error
        if geometry.geom_type not in {'Polygon','MultiPolygon'} or not geometry.is_valid or geometry.is_empty:
            raise ValueError('region requires valid nonempty polygon boundary')
        if geometry.bounds[0] < -180 or geometry.bounds[2] > 180 or geometry.bounds[1] < -90 or geometry.bounds[3] > 90:
            raise ValueError('boundary coordinates outside EPSG:4326 range')
        if level == 'PROVINCE' and props.get('parentCode') is not None:
            raise ValueError('province cannot have parent')
        if level != 'PROVINCE' and not isinstance(props.get('parentCode'),str):
            raise ValueError('non-province requires parentCode')
        features.append((props,MultiPolygon([geometry]) if geometry.geom_type=='Polygon' else geometry))
    return sorted(features,key=lambda item: LEVELS.index(item[0]['administrativeLevel']))


async def importRegions(session, document):
    features = validateFeatures(document)
    existing = {row.code: row for row in (await session.execute(select(Region))).scalars()}
    for props,geometry in features:
        if props['code'] in existing:
            raise ValueError(f"region {props['code']} already exists; importer is insert-only")
        parent = existing.get(props.get('parentCode'))
        level = props['administrativeLevel']
        if level != 'PROVINCE' and (parent is None or parent.administrativeLevel != LEVELS[LEVELS.index(level)-1] or parent.dataMode != props['dataMode']):
            raise ValueError('parent missing, wrong level, or incompatible dataMode')
        region = Region(id=uuid.uuid4(),code=props['code'],name=props['name'],administrativeLevel=level,
            parentId=parent.id if parent else None,geometry=from_shape(geometry,srid=4326),centroid=from_shape(geometry.representative_point(),srid=4326),
            population=props.get('population'),populationReferenceYear=props.get('populationReferenceYear'),
            populationSource=props.get('populationSource'),boundarySource=props['boundarySource'],dataMode=props['dataMode'])
        session.add(region)
        await session.flush()
        existing[region.code]=region
    return len(features)
