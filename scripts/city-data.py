#!/usr/bin/env python3
"""
Build the lock screen's city maps: real streets, rivers and buildings from
OpenStreetMap (Overpass API) and real elevation from the AWS Terrain Tiles
(Terrarium PNGs), cut to one box per city and written as small JSON files.

    python3 scripts/city-data.py [city ...]      # all cities when none named

Output: scripts/probes/cities/<id>.json, in local metres from the box's
top-left corner (x east, y south). Elevation is a grid of int16 metres.

Map data © OpenStreetMap contributors (ODbL). Elevation: Mapzen / AWS
Terrain Tiles (sources listed at github.com/tilezen/joerd).
"""
import base64, io, json, math, os, sys, time, urllib.parse, urllib.request
import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), 'probes', 'cities')
UA = {'User-Agent': 'nexus-lockscreen-citydata/1.0 (personal project)'}

# centre lat, lon, width and height of the box in metres (16:9-ish, a screen).
CITIES = {
    'buenos-aires': ('BUENOS AIRES', -34.6075, -58.3700, 5200, 2925),
    'medellin': ('MEDELLÍN', 6.2440, -75.5730, 9000, 5060),
    'rio': ('RIO DE JANEIRO', -22.9560, -43.1900, 7400, 4160),
    'san-francisco': ('SAN FRANCISCO', 37.7690, -122.4400, 7600, 4275),
}
ELEV_GRID = (320, 180)
ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street']


def fetch(url, data=None, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=UA)
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except Exception as e:  # Overpass rate-limits; back off and retry.
            print(f'  retry {i + 1}: {e}')
            time.sleep(10 * (i + 1))
    raise RuntimeError(f'failed: {url}')


def bbox(lat, lon, w, h):
    dlat = (h / 2) / 110540
    dlon = (w / 2) / (111320 * math.cos(math.radians(lat)))
    return lat - dlat, lon - dlon, lat + dlat, lon + dlon


def project(lat0, lon0, w, h):
    s, west, n, e = bbox(lat0, lon0, w, h)
    kx = 111320 * math.cos(math.radians(lat0))
    return lambda lat, lon: (round((lon - west) * kx, 1), round((n - lat) * 110540, 1))


def osm(lat, lon, w, h):
    s, west, n, e = bbox(lat, lon, w, h)
    b = f'{s},{west},{n},{e}'
    q = f"""[out:json][timeout:170];
(
  way["highway"~"^({'|'.join(ROAD_CLASSES)})$"]({b});
  way["waterway"~"^(river|canal|stream)$"]({b});
  way["building"]({b});
);
out geom;"""
    raw = fetch('https://overpass-api.de/api/interpreter', urllib.parse.urlencode({'data': q}).encode())
    return json.loads(raw)['elements']


def simplify(points, tol=1.5):
    """Douglas-Peucker, in metres: a street does not need a vertex every metre."""
    if len(points) < 3:
        return points
    a, b = np.array(points[0]), np.array(points[-1])
    ab = b - a
    L = np.hypot(*ab) or 1e-9
    d = [abs(np.cross(ab, np.array(p) - a)) / L for p in points[1:-1]]
    i = int(np.argmax(d))
    if d[i] > tol:
        return simplify(points[: i + 2], tol)[:-1] + simplify(points[i + 1 :], tol)
    return [points[0], points[-1]]


def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def elevation(lat0, lon0, w, h, z=14):
    s, west, n, e = bbox(lat0, lon0, w, h)
    x0, y0 = tile_xy(n, west, z)
    x1, y1 = tile_xy(s, e, z)
    tiles = {}
    for tx in range(int(x0), int(x1) + 1):
        for ty in range(int(y0), int(y1) + 1):
            png = fetch(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{tx}/{ty}.png')
            px = np.asarray(Image.open(io.BytesIO(png)).convert('RGB')).astype(np.float64)
            tiles[(tx, ty)] = px[:, :, 0] * 256 + px[:, :, 1] + px[:, :, 2] / 256 - 32768
    gw, gh = ELEV_GRID
    grid = np.zeros((gh, gw), dtype=np.int16)
    for j in range(gh):
        lat = n - (n - s) * (j + 0.5) / gh
        for i in range(gw):
            lon = west + (e - west) * (i + 0.5) / gw
            fx, fy = tile_xy(lat, lon, z)
            t = tiles[(int(fx), int(fy))]
            grid[j, i] = round(t[min(255, int((fy % 1) * 256)), min(255, int((fx % 1) * 256))])
    return grid


def build(cid):
    name, lat, lon, w, h = CITIES[cid]
    print(f'{name}: OSM')
    elements = osm(lat, lon, w, h)
    to = project(lat, lon, w, h)
    roads, rivers, buildings = [], [], []
    for el in elements:
        if 'geometry' not in el:
            continue
        pts = [to(g['lat'], g['lon']) for g in el['geometry']]
        tags = el.get('tags', {})
        if 'building' in tags:
            if len(pts) >= 4:
                buildings.append([v for p in simplify(pts, 1.0) for v in (round(p[0]), round(p[1]))])
        elif 'waterway' in tags:
            rivers.append([v for p in simplify(pts, 3) for v in (round(p[0]), round(p[1]))])
        else:
            cls = ROAD_CLASSES.index(tags['highway'])
            roads.append([cls] + [v for p in simplify(pts, 2) for v in (round(p[0]), round(p[1]))])
    print(f'  roads {len(roads)}, rivers {len(rivers)}, buildings {len(buildings)}')
    print(f'{name}: elevation')
    grid = elevation(lat, lon, w, h)
    print(f'  elevation {grid.min()}..{grid.max()} m')
    data = {
        'id': cid, 'name': name, 'centre': [lat, lon], 'size': [w, h],
        'elev': {'w': ELEV_GRID[0], 'h': ELEV_GRID[1], 'min': int(grid.min()), 'max': int(grid.max()),
                 'data': base64.b64encode(grid.astype('<i2').tobytes()).decode()},
        'roads': roads, 'rivers': rivers, 'buildings': buildings,
        'credit': '© OpenStreetMap contributors · Terrain Tiles (Mapzen/AWS)',
    }
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{cid}.json')
    with open(path, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    # The same data as a script, so a page opened straight from disk (file://,
    # where fetch is refused) can still load it with a <script> tag.
    with open(os.path.join(OUT, f'{cid}.js'), 'w') as f:
        f.write(f'(window.CITY_DATA = window.CITY_DATA || {{}})[{json.dumps(cid)}] = ')
        json.dump(data, f, separators=(',', ':'))
        f.write(';\n')
    print(f'  wrote {path} ({os.path.getsize(path) // 1024} KB)')


if __name__ == '__main__':
    for cid in sys.argv[1:] or CITIES:
        build(cid)
        time.sleep(5)  # be polite to the public Overpass server
