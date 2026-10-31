"""HTTP GET with retries and an on-disk cache of raw responses under data/raw/."""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any, Optional

import requests

from pipeline.core.env import REPO_ROOT

RAW_DIR = REPO_ROOT / "data" / "raw"
_session = requests.Session()
_session.headers["User-Agent"] = "emris-pipeline/2 (+https://github.com/renee-stack/Emris)"


def cache_key(*parts: Any) -> str:
    return hashlib.sha1(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:16]


def get(
    url: str,
    params: Optional[dict] = None,
    *,
    cache: Optional[Path] = None,
    refresh: bool = False,
    headers: Optional[dict] = None,
    timeout: int = 180,
    retries: int = 4,
) -> bytes:
    """GET url. With `cache`, a saved response is reused unless refresh=True.
    Only successful responses are cached."""
    if cache is not None and cache.is_file() and not refresh:
        return cache.read_bytes()
    last: Optional[Exception] = None
    for attempt in range(retries):
        try:
            r = _session.get(url, params=params, headers=headers, timeout=timeout)
            if r.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(f"{r.status_code} from {r.url}")
            r.raise_for_status()
            if cache is not None:
                cache.parent.mkdir(parents=True, exist_ok=True)
                tmp = cache.with_suffix(cache.suffix + ".part")
                tmp.write_bytes(r.content)
                tmp.replace(cache)
            return r.content
        except (requests.ConnectionError, requests.Timeout, requests.HTTPError) as e:
            last = e
            if isinstance(e, requests.HTTPError) and e.response is not None and e.response.status_code < 500 \
                    and e.response.status_code != 429:
                raise
            time.sleep(2 ** attempt * 2)
    raise RuntimeError(f"GET failed after {retries} tries: {url}: {last}")


def get_json(url: str, params: Optional[dict] = None, **kw) -> Any:
    return json.loads(get(url, params, **kw))


def download(url: str, dest: Path, *, refresh: bool = False) -> Path:
    """Download a file once (e.g. a shapefile zip) and return its path."""
    get(url, cache=dest, refresh=refresh, timeout=600)
    return dest
