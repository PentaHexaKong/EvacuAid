import json
import math
import sys
from collections import Counter
from pathlib import Path

folder = Path(__file__).resolve().parents[1] / 'src/features/route-simulation/data'
source = json.loads((folder / 'osm-source.json').read_text())
selection = json.loads((folder / 'selection.json').read_text())
nodes = {e['id']: e for e in source['elements'] if e['type'] == 'node'}
ways = {e['id']: e for e in source['elements'] if e['type'] == 'way'}
assert source['attribution'] and source['retrievedAt'] and source['license'] == 'ODbL-1.0'
assert source['bounds'] == [-6.276, 106.800, -6.258, 106.820]

def allowed(tags):
    return tags.get('access', 'yes') in ('yes', 'permissive') and tags.get('foot', 'yes') in ('yes', 'designated', 'permissive') and not any(key in tags for key in ('barrier', 'access:conditional', 'foot:conditional', 'foot:forward', 'foot:backward', 'ford', 'construction'))

def coordinate(node_id):
    node = nodes[node_id]
    lon, lat = node['lon'], node['lat']
    assert math.isfinite(lon) and math.isfinite(lat)
    assert 106.800 <= lon <= 106.820 and -6.276 <= lat <= -6.258
    return [lon, lat]

def distance(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, [*a, *b])
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371000 * 2 * math.asin(math.sqrt(min(1, h)))

parts = []
for span in selection['spans']:
    way = ways[span['way']]
    tags = way['tags']
    assert allowed(tags), f"Review pedestrian access: {way['id']}"
    assert tags['highway'] in ('residential', 'living_street', 'tertiary')
    assert tags.get('oneway:foot', 'no') in ('no', 'yes', '-1')
    start, end = way['nodes'].index(span['from']), way['nodes'].index(span['to'])
    assert start < end
    ids = way['nodes'][start:end+1]
    assert all(allowed(nodes[n]['tags']) for n in ids), f"Barrier or uncertain node access: {way['id']}"
    for n in ids:
        coordinate(n)
    parts.append((way, ids))

used = {n for _, ids in parts for n in ids}
for relation in (e for e in source['elements'] if e['type'] == 'relation'):
    tags = relation['tags']
    relevant = any(m['type'] == 'way' and m['ref'] in ways or m['type'] == 'node' and m['ref'] in used for m in relation['members'])
    assert not relevant or (tags.get('type') != 'restriction:foot' and not any(k.startswith('restriction:foot') for k in tags)), f"Review pedestrian restriction: {relation['id']}"

counts = Counter(n for _, ids in parts for n in ids)
vertices = set(selection['endpoints'].values()) | (set(source['junctionNodeIds']) & used)
vertices.update(n for n, count in counts.items() if count > 1)
vertices.update(n for _, ids in parts for n in (ids[0], ids[-1]))
vertices.update(n for n in used if nodes[n]['tags'])
assert vertices <= used
assert len(vertices) <= 500, 'Graph exceeds 500 vertices; review selection instead of truncating'
edges = []
for way, ids in parts:
    start = 0
    for end in range(1, len(ids)):
        if ids[end] not in vertices:
            continue
        geometry = [coordinate(n) for n in ids[start:end+1]]
        length = sum(distance(a, b) for a, b in zip(geometry, geometry[1:]))
        assert math.isfinite(length) and length >= 0
        edge = {'id': f"w{way['id']}:{ids[start]}-{ids[end]}", 'sourceWay': way['id'], 'from': str(ids[start]), 'to': str(ids[end]), 'direction': {'no':'both','yes':'forward','-1':'backward'}[way['tags'].get('oneway:foot','no')], 'geometry': geometry, 'distance': length}
        if way['tags'].get('name'):
            edge['name'] = way['tags']['name']
        edges.append(edge)
        start = end
assert len({e['id'] for e in edges}) == len(edges)
reached, pending = set(), [next(iter(vertices))]
while pending:
    n = pending.pop()
    if n in reached:
        continue
    reached.add(n)
    pending.extend(int(e['to']) if int(e['from']) == n else int(e['from']) for e in edges if str(n) in (e['from'], e['to']))
assert reached == vertices, 'Reviewed selection is disconnected'
graph = {'source': {k: source[k] for k in ('source','retrievedAt','bounds','attribution','license','licenseUrl')}, 'endpoints': {k:str(v) for k,v in selection['endpoints'].items()}, 'nodes': [{'id':str(n),'coordinate':coordinate(n)} for n in sorted(vertices)], 'edges':edges}
output = json.dumps(graph, separators=(',', ':')) + '\n'
if '--check' in sys.argv:
    assert (folder / 'graph.json').read_text() == output, 'Prepared graph is stale'
else:
    (folder / 'graph.json').write_text(output)
print(f"Validated {len(vertices)} vertices, {len(edges)} edges from {len(ways)} reviewed OSM ways")
