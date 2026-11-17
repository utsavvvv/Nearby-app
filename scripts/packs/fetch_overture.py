"""Fetch Overture Maps places for each city pack area.

Usage: python fetch_overture.py cities.json out_dir
Reads only the parts of Overture's Parquet files that cover each area (row-group filtering on
the bbox columns), so it downloads megabytes, not the whole 12 GB dataset.
Env: OVERTURE_RELEASE to pin a release (default: newest in the bucket).
"""
import json, math, os, re, sys, time, urllib.request

import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as fs

BUCKET = 'overturemaps-us-west-2'
COLUMNS = ['id', 'names', 'basic_category', 'taxonomy', 'operating_status', 'confidence', 'bbox', 'addresses', 'phones', 'brand']


def latest_release():
    url = f'https://{BUCKET}.s3.us-west-2.amazonaws.com/?list-type=2&prefix=release/&delimiter=/'
    xml = urllib.request.urlopen(url, timeout=30).read().decode()
    releases = sorted(re.findall(r'<Prefix>release/(\d{4}-\d{2}-\d{2}\.\d+)/</Prefix>', xml))
    if not releases:
        raise SystemExit('No Overture releases found')
    return releases[-1]


def s3_filesystem():
    kw = dict(anonymous=True, region='us-west-2')
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    if proxy:
        kw['proxy_options'] = proxy
    ca = os.environ.get('OVERTURE_CA_FILE')
    if ca:
        kw['tls_ca_file_path'] = ca
    return fs.S3FileSystem(**kw)


def main():
    cities = json.load(open(sys.argv[1]))
    out_dir = sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    release = os.environ.get('OVERTURE_RELEASE') or latest_release()
    print(f'Overture release {release}', flush=True)
    dataset = ds.dataset(f'{BUCKET}/release/{release}/theme=places/type=place/', filesystem=s3_filesystem(), format='parquet')
    for c in cities:
        t = time.time()
        d_lat = c['radius'] / 111320
        d_lon = c['radius'] / (111320 * math.cos(math.radians(c['lat'])))
        w, e, s, n = c['lon'] - d_lon, c['lon'] + d_lon, c['lat'] - d_lat, c['lat'] + d_lat
        flt = ((pc.field('bbox', 'xmin') > w) & (pc.field('bbox', 'xmax') < e)
               & (pc.field('bbox', 'ymin') > s) & (pc.field('bbox', 'ymax') < n))
        rows = dataset.to_table(filter=flt, columns=COLUMNS).to_pylist()
        with open(os.path.join(out_dir, f"{c['id']}.json"), 'w') as f:
            json.dump({'release': release, 'rows': rows}, f, ensure_ascii=False, default=str)
        print(f"{c['id']}: {len(rows)} places in {time.time() - t:.1f}s", flush=True)


if __name__ == '__main__':
    main()
