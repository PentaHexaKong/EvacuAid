"""Valhalla 3.9.0 tile addressing; native routing compatibility remains unverified."""
from pathlib import Path


SIZES = {0: 4.0, 1: 1.0, 2: 0.25}


def tile_bounds(relative: Path) -> tuple[float, float, float, float]:
    parts = relative.with_suffix('').parts
    if len(parts) < 2 or parts[0] not in {'0', '1', '2'} or any(not p.isdigit() for p in parts[1:]):
        raise ValueError('Unexpected Valhalla tile path')
    size = SIZES[int(parts[0])]
    tile_id = int(''.join(parts[1:]))
    columns = int(360 / size)
    if not 0 <= tile_id < columns * int(180 / size):
        raise ValueError('Invalid Valhalla tile ID')
    west, south = -180 + (tile_id % columns) * size, -90 + (tile_id // columns) * size
    return west, south, west + size, south + size


def regional_tiles(directory: Path, bbox) -> list[Path]:
    selected = []
    for path in sorted(directory.rglob('*.gph')):
        bounds = tile_bounds(path.relative_to(directory))
        if bounds[0] <= bbox[2] and bounds[2] >= bbox[0] and bounds[1] <= bbox[3] and bounds[3] >= bbox[1]:
            # Version field is fixed at bytes 16..31 in the inspected 3.9.0 header.
            with path.open('rb') as stream:
                header = stream.read(32)
            if len(header) != 32 or header[16:32].split(b'\0', 1)[0] != b'3.9.0':
                raise ValueError('Incompatible graph tile header; expected Valhalla 3.9.0')
            selected.append(path)
    if not any(p.relative_to(directory).parts[0] == '2' for p in selected):
        raise ValueError('No local pedestrian graph tiles cover this region')
    return selected
