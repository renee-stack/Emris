"""Census TIGER / cartographic boundary shapefiles (zipped), read without geopandas."""
from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

import pyogrio
import shapely

from pipeline.core.http import RAW_DIR, download

kind = "tiger"


def layer(url: str, *, state: str, refresh: bool = False) -> list[dict]:
    """Every feature of a zipped shapefile as a dict of its attributes plus `geometry`
    (shapely, WGS84). Cached under data/raw/_state/<state>/."""
    dest = RAW_DIR / "_state" / state.lower() / Path(urlparse(url).path).name
    download(url, dest, refresh=refresh)
    meta, _fids, geoms, fields = pyogrio.raw.read(f"/vsizip/{dest}")
    crs = (meta.get("crs") or "").upper()
    if crs and crs not in ("EPSG:4269", "EPSG:4326"):
        raise ValueError(f"{dest.name}: expected NAD83/WGS84 lon/lat, got {crs}")
    names = list(meta["fields"])
    shapes = shapely.from_wkb(geoms)
    return [{**{n: fields[i][j] for i, n in enumerate(names)}, "geometry": shapes[j]} for j in range(len(shapes))]
