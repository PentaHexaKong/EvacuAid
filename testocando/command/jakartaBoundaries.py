"""Adapt Jakarta government's public village layer; never infer population."""
import argparse
import hashlib
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

from shapely import make_valid
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

SOURCE = 'https://gis-dpmptsp.jakarta.go.id/arcgis/rest/services/Hosted/Batas_Administrasi_Kelurahan_DKI_Jakarta/FeatureServer/85'


def prepareBoundaries(document):
    if document.get('type') != 'FeatureCollection' or document.get('exceededTransferLimit'):
        raise ValueError('complete GeoJSON FeatureCollection required')
    villages = {}
    repairs = []
    for feature in document['features']:
        props = feature['properties']
        code, district, city = props['kdepum'], props['kdcpum'], props['kdpkab']
        if not all(isinstance(value, str) and value.isdigit() for value in [code,district,city]) or not code.startswith(district) or not district.startswith(city) or not city.startswith('31'):
            raise ValueError('invalid source administrative codes')
        if code in villages:
            raise ValueError('duplicate village code')
        geometry = shape(feature['geometry'])
        if not geometry.is_valid:
            repaired = make_valid(geometry)
            if repaired.geom_type == 'GeometryCollection':
                repaired = unary_union([part for part in repaired.geoms if part.geom_type in {'Polygon','MultiPolygon'}])
            repairs.append({'code':code,'operation':'Shapely make_valid; retain polygon components',
                'originalAreaDegreesSquared':geometry.area,'repairedAreaDegreesSquared':repaired.area})
            geometry = repaired
        if geometry.is_empty or not geometry.is_valid or geometry.geom_type not in {'Polygon','MultiPolygon'}:
            raise ValueError('unusable source village geometry')
        villages[code] = (props,geometry)
    groups = defaultdict(list)
    names = {'31':'DKI Jakarta'}
    parents = {'31':None}
    for code,(props,geometry) in villages.items():
        district, city = props['kdcpum'],props['kdpkab']
        for group in [district,city,'31']:
            groups[group].append(geometry)
        names[district],names[city] = props['wadmkc'],props['wadmkk']
        parents[district],parents[city] = city,'31'
    features = []
    def add(code,name,level,parent,geometry,derived):
        source = 'DKI Jakarta DPMPTSP public village boundary layer 85'
        if derived:
            source += '; parent boundary dissolved from source villages'
        if any(item['code'] == code for item in repairs):
            source += '; polygon topology repaired with make_valid'
        features.append({'type':'Feature','geometry':mapping(geometry),'properties':{
            'code':code,'name':name,'administrativeLevel':level,'parentCode':parent,
            'dataMode':'REFERENCE','boundarySource':source,'population':None,
            'populationReferenceYear':None,'populationSource':None}})
    for code in sorted(groups,key=lambda value:(len(value),value)):
        add(code,names[code],{2:'PROVINCE',4:'CITY_REGENCY',6:'DISTRICT'}[len(code)],parents[code],unary_union(groups[code]),True)
    for code,(props,geometry) in sorted(villages.items()):
        add(code,props['wadmkd'],'VILLAGE',props['kdcpum'],geometry,False)
    return {'type':'FeatureCollection','features':features}, repairs


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-file',type=Path)
    parser.add_argument('--output-dir',type=Path,default=Path(__file__).resolve().parents[1]/'data')
    args=parser.parse_args()
    args.output_dir.mkdir(exist_ok=True,parents=True)
    if args.source_file:
        raw=args.source_file.read_bytes()
    else:
        query=urlencode({'where':'1=1','outFields':'fid,wadmkd,wadmkc,wadmkk,kdepum,kdcpum,kdpkab',
            'returnGeometry':'true','outSR':4326,'f':'geojson','orderByFields':'fid','resultRecordCount':2000})
        with urlopen(SOURCE+'/query?'+query,timeout=90) as response:
            raw=response.read()
    document,repairs=prepareBoundaries(json.loads(raw))
    (args.output_dir/'jakarta-villages.source.geojson').write_bytes(raw)
    (args.output_dir/'jakarta-regions.geojson').write_text(json.dumps(document,ensure_ascii=False),encoding='utf-8')
    provenance={'sourceUrl':SOURCE,'retrievedAt':datetime.now(timezone.utc).isoformat(),'sourceSha256':hashlib.sha256(raw).hexdigest(),
        'sourceVillageCount':len(json.loads(raw)['features']),'importRegionCount':len(document['features']),
        'outputCrs':'EPSG:4326; ArcGIS outSR=4326','parentGeometryMethod':'Dissolved union of source villages',
        'repairs':repairs,'population':'UNKNOWN; no population values supplied by this boundary layer',
        'boundaryReferenceYear':'UNKNOWN; not specified in layer metadata'}
    (args.output_dir/'jakarta-regions.provenance.json').write_text(json.dumps(provenance,indent=2),encoding='utf-8')
    print(f"Prepared {len(document['features'])} real regions; {len(repairs)} topology repairs; population UNKNOWN")


if __name__=='__main__':
    main()
