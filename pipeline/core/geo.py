"""State geography: tracts, places and county subdivisions, with fast point lookups."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Sequence

import numpy as np
import shapely
from shapely import STRtree
from shapely.geometry import MultiPolygon, Polygon

from pipeline.connectors import tiger


def as_multi(g) -> MultiPolygon:
    if isinstance(g, Polygon):
        return MultiPolygon([g])
    if isinstance(g, MultiPolygon):
        return g
    polys = [p for p in getattr(g, "geoms", []) if isinstance(p, (Polygon, MultiPolygon))]
    return MultiPolygon([q for p in polys for q in (p.geoms if isinstance(p, MultiPolygon) else [p])])


def inner_point(g):
    """The centroid if it falls inside the shape, else a point guaranteed inside."""
    c = g.centroid
    return c if g.contains(c) else g.representative_point()


@dataclass
class Areas:
    """A set of polygons with ids, indexed for point-in-polygon lookups."""

    ids: list[str]
    names: list[str]
    geoms: list
    tree: STRtree = field(init=False)

    def __post_init__(self):
        self.tree = STRtree(self.geoms)

    def locate(self, lats: Sequence[Optional[float]], lngs: Sequence[Optional[float]]) -> list[Optional[str]]:
        """Id of the polygon containing each point (None if outside all or no point)."""
        out: list[Optional[str]] = [None] * len(lats)
        idx = [i for i in range(len(lats)) if lats[i] is not None and lngs[i] is not None]
        if not idx:
            return out
        pts = shapely.points(np.array([lngs[i] for i in idx]), np.array([lats[i] for i in idx]))
        src, hit = self.tree.query(pts, predicate="intersects")
        for s, h in zip(src, hit):
            j = idx[s]
            if out[j] is None:
                out[j] = self.ids[h]
        return out

    def locate_points(self, points) -> list[Optional[str]]:
        return self.locate([p.y for p in points], [p.x for p in points])


@dataclass
class StateGeography:
    tracts: Areas
    tract_county: dict[str, str]
    tract_number: dict[str, str]  # Census tract NAME, e.g. "8391" or "2405.02"
    county_name: dict[str, str]  # county FIPS -> "<Name> County"
    tract_point: dict[str, object]  # inner point per tract
    places: Areas  # incorporated places and CDPs, ids = 7-digit GEOID
    cousubs: Areas  # ids = 10-digit GEOID


def load(geo_src, *, state: str, refresh: bool = False) -> StateGeography:
    tr = tiger.layer(geo_src.url, state=state, refresh=refresh)
    pl = tiger.layer(geo_src.places_url, state=state, refresh=refresh)
    cs = tiger.layer(geo_src.cousub_url, state=state, refresh=refresh)
    t_ids = [r["GEOID"] for r in tr]
    t_geoms = [as_multi(r["geometry"]) for r in tr]
    return StateGeography(
        tracts=Areas(t_ids, [r["NAME"] for r in tr], t_geoms),
        tract_county={r["GEOID"]: r["GEOID"][:5] for r in tr},
        tract_number={r["GEOID"]: str(r["NAME"]) for r in tr},
        county_name={r["GEOID"][:5]: str(r["NAMELSADCO"]) for r in tr},
        tract_point={g: inner_point(geom) for g, geom in zip(t_ids, t_geoms)},
        places=Areas([r["GEOID"] for r in pl], [r["NAME"] for r in pl], [as_multi(r["geometry"]) for r in pl]),
        cousubs=Areas([r["GEOID"] for r in cs], [r["NAME"] for r in cs], [as_multi(r["geometry"]) for r in cs]),
    )
