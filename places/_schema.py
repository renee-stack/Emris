"""Schema for every YAML file under places/ (docs/contract.md section 1).

These models are the source of truth for config keys. Two kinds of files:
- `_state.yaml`: one per state folder, state defaults + baseline sources (StateConfig)
- `<place>.yaml`: one per city, county or county remainder (PlaceConfig)

A scalar may be the string "TODO" (optionally "TODO <note>"). `check_file` reports
TODOs separately from errors, and schema errors caused by a TODO are not counted.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Any, Literal, Optional, Union

import yaml
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    field_validator,
    model_validator,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
PLACES_DIR = REPO_ROOT / "places"
CUSTOM_DIR = REPO_ROOT / "pipeline" / "custom"
TODO_RE = re.compile(r"^TODO\b")

# ---------- shared types ----------

Usps = Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}$")]
StateFips = Annotated[str, StringConstraints(pattern=r"^\d{2}$")]
CountyFips = Annotated[str, StringConstraints(pattern=r"^\d{5}$")]
CensusPlace = Annotated[str, StringConstraints(pattern=r"^\d{7}$")]
PlaceId = Annotated[str, StringConstraints(pattern=r"^[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$")]
PeerGroup = Annotated[str, StringConstraints(pattern=r"^(?:cbsa:\d{5}|state:\d{2})$")]
Name = Annotated[str, StringConstraints(min_length=1)]
Column = Annotated[str, StringConstraints(min_length=1)]
# A source column, or several joined with spaces (e.g. an address split over 3 columns).
ColumnRef = Union[Column, Annotated[list[Column], Field(min_length=1)]]

CoverageTier = Literal["parcel", "parcel_partial", "county_gis", "baseline"]
PermitClass = Literal["new_mf", "alteration", "demolition", "roof", "major_mep", "other"]
Connector = Literal["socrata", "arcgis", "csv", "shovels", "census_bps", "acs", "tiger", "firecrawl"]

CLASS_ORDER: tuple[PermitClass, ...] = ("new_mf", "demolition", "alteration", "roof", "major_mep", "other")


class Strict(BaseModel):
    """Unknown keys are errors, so a typo fails loudly instead of being ignored."""

    model_config = ConfigDict(extra="forbid")


class Hook(Strict):
    """`{ hook: custom.<module>.<function> }` -> <function> in pipeline/custom/<module>.py.
    `{ hook: custom.<module> }` calls the module's `run` function."""

    hook: Annotated[str, StringConstraints(pattern=r"^custom\.[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$")]

    @field_validator("hook")
    @classmethod
    def _module_exists(cls, v: str) -> str:
        path = CUSTOM_DIR / f"{v.split('.')[1]}.py"
        if not path.is_file():
            raise ValueError(f"no such hook module: {path.relative_to(REPO_ROOT)}")
        fn = v.split(".")[2] if v.count(".") == 2 else "run"
        if not re.search(rf"^def {fn}\(", path.read_text(), re.M):
            raise ValueError(f"{path.relative_to(REPO_ROOT)} has no function {fn}()")
        return v

    @property
    def module(self) -> str:
        return self.hook.split(".")[1]

    @property
    def function(self) -> str:
        return self.hook.split(".")[2] if self.hook.count(".") == 2 else "run"


def _decay(v: list[float]) -> list[float]:
    if len(v) != 2 or not (0 <= v[0] < v[1]):
        raise ValueError("must be [full_weight_mi, zero_weight_mi] with 0 <= full < zero")
    return v


class Located(Strict):
    """Where a source lives. Which keys are needed depends on the connector."""

    connector: Connector
    domain: Optional[str] = None
    dataset: Optional[str] = None
    url: Optional[str] = None
    path: Optional[str] = None

    @model_validator(mode="after")
    def _location(self):
        c = self.connector
        if c == "socrata" and not (self.domain and self.dataset):
            raise ValueError("socrata sources need domain and dataset")
        if c == "arcgis" and not self.url:
            raise ValueError("arcgis sources need url (the feature layer endpoint)")
        if c == "csv" and not (self.url or self.path):
            raise ValueError("csv sources need url or path")
        return self


# ---------- permits ----------


class PermitFields(Strict):
    permit_id: ColumnRef
    issued: ColumnRef
    status: Optional[ColumnRef] = None
    permit_type: Optional[ColumnRef] = None
    work_type: Optional[ColumnRef] = None
    text: Optional[ColumnRef] = None
    cost: Optional[ColumnRef] = None
    parcel_ids: Optional[ColumnRef] = None
    lat: Optional[ColumnRef] = None
    lng: Optional[ColumnRef] = None
    address: Optional[ColumnRef] = None
    tract_hint: Optional[ColumnRef] = None


class ParcelIdFormat(Strict):
    """How to turn a source's parcel id value into the assessor's format."""

    separator: Optional[str] = None  # one value can hold several ids, e.g. "a | b"
    strip: str = ""  # characters removed first, e.g. "-" for 20-03-111-016-0000
    pad_right: str = ""  # appended while shorter than length
    length: Optional[Annotated[int, Field(gt=0)]] = None  # expected length after padding


class Units(Strict):
    field: Optional[Column] = None
    from_text: Optional[Union[Hook, str]] = None

    @field_validator("from_text")
    @classmethod
    def _regex(cls, v):
        if isinstance(v, str):
            try:
                rx = re.compile(v)
            except re.error as e:
                raise ValueError(f"not a valid regex: {e}") from None
            if rx.groups != 1:
                raise ValueError("regex must have exactly one capture group (the unit count)")
        return v

    @model_validator(mode="after")
    def _some(self):
        if not (self.field or self.from_text):
            raise ValueError("set units.field, units.from_text, or both")
        return self


class ClassRule(Strict):
    permit_type: Optional[Union[str, Annotated[list[str], Field(min_length=1)]]] = None
    work_type: Optional[Annotated[list[str], Field(min_length=1)]] = None
    min_units: Optional[Annotated[int, Field(ge=1)]] = None
    min_cost: Optional[Annotated[float, Field(ge=0)]] = None
    any_of: Optional[Annotated[list["ClassRule"], Field(min_length=1)]] = None
    default: Optional[Literal[True]] = None

    @model_validator(mode="after")
    def _shape(self):
        conds = [k for k in ("permit_type", "work_type", "min_units", "min_cost", "any_of") if getattr(self, k) is not None]
        if self.default and conds:
            raise ValueError("default: true can't be combined with other conditions")
        if not self.default and not conds:
            raise ValueError("a rule needs at least one condition (or default: true)")
        return self

    def uses(self, key: str) -> bool:
        return getattr(self, key) is not None or any(r.uses(key) for r in self.any_of or [])


class Classes(Strict):
    new_mf: Optional[ClassRule] = None
    alteration: Optional[ClassRule] = None
    demolition: Optional[ClassRule] = None
    roof: Optional[ClassRule] = None
    major_mep: Optional[ClassRule] = None
    other: ClassRule

    @model_validator(mode="after")
    def _default_only_on_other(self):
        if not self.other.default:
            raise ValueError("other must be { default: true }")
        for name in CLASS_ORDER[:-1]:
            rule = getattr(self, name)
            if rule is not None and rule.default:
                raise ValueError(f"{name}: only `other` may use default: true")
        return self

    def rules(self) -> list[tuple[PermitClass, ClassRule]]:
        """Rules in matching order (first match wins)."""
        return [(n, r) for n in CLASS_ORDER if (r := getattr(self, n)) is not None]


class PermitSource(Located):
    since_months: Optional[Annotated[int, Field(ge=1, le=600)]] = None
    fields: PermitFields
    parcel_id_format: Optional[ParcelIdFormat] = None
    normalize_dashes: bool = False
    units: Optional[Units] = None
    classes: Classes
    # Link a human can open for one permit; {column} placeholders are source columns.
    record_url: Optional[str] = None

    @model_validator(mode="after")
    def _rules_have_inputs(self):
        rules = [r for _, r in self.classes.rules()]
        needs = {"min_units": self.units is not None, "min_cost": self.fields.cost is not None,
                 "permit_type": self.fields.permit_type is not None, "work_type": self.fields.work_type is not None}
        for key, ok in needs.items():
            if not ok and any(r.uses(key) for r in rules):
                where = "units" if key == "min_units" else f"fields.{key.replace('min_', '')}"
                raise ValueError(f"classes use {key} but {where} is not set")
        if self.parcel_id_format and self.fields.parcel_ids is None:
            raise ValueError("parcel_id_format is set but fields.parcel_ids is not")
        return self


# ---------- parcels ----------


class ParcelFields(Strict):
    parcel_id: ColumnRef
    year: Optional[ColumnRef] = None
    address: Optional[ColumnRef] = None
    lat: Optional[ColumnRef] = None
    lng: Optional[ColumnRef] = None
    year_built: Optional[ColumnRef] = None
    units: Optional[ColumnRef] = None
    stories: Optional[ColumnRef] = None
    land_use: Optional[ColumnRef] = None
    owner_name: Optional[ColumnRef] = None


Scalar = Union[str, int, float, bool]
PropertyField = Literal["year_built", "units", "stories", "land_use", "owner_name", "address", "lat", "lng"]


class ParcelSource(Located):
    name: Annotated[str, StringConstraints(pattern=r"^[a-z0-9_]+$")]
    role: Literal["characteristics", "geometry"] = "characteristics"
    latest_year_only: bool = False
    # With latest_year_only: read the newest N years in the source, then keep each parcel's
    # newest row. Use the reassessment cycle for sources that only list reassessed parcels.
    years_back: Annotated[int, Field(ge=1, le=20)] = 1
    fields: ParcelFields
    parcel_id_format: Optional[ParcelIdFormat] = None
    # Source-side equality filters (column: value or list of values), applied in the query.
    filter: dict[str, Union[Scalar, list[Scalar]]] = {}
    # Source values that aren't numbers, e.g. { units: { "Two": 2 } }. Unmapped values parse as numbers.
    value_maps: dict[PropertyField, dict[str, Union[int, float, str]]] = {}
    # How to combine several rows for one parcel (e.g. one row per building card). Default first.
    aggregate: dict[PropertyField, Literal["first", "sum", "min", "max"]] = {}
    year_built_source: Literal["assessor", "county_gis"] = "assessor"

    @model_validator(mode="after")
    def _role(self):
        if self.role == "geometry" and not (self.fields.lat and self.fields.lng):
            raise ValueError("role: geometry needs fields.lat and fields.lng")
        if self.latest_year_only and not self.fields.year:
            raise ValueError("latest_year_only needs fields.year")
        if self.years_back > 1 and not self.latest_year_only:
            raise ValueError("years_back needs latest_year_only: true")
        return self


# ---------- catalysts ----------


class CatalystSource(Strict):
    connector: Literal["firecrawl", "csv"]
    urls: list[str] = []
    url: Optional[str] = None
    seed_file: Optional[str] = None

    @field_validator("seed_file")
    @classmethod
    def _seed_exists(cls, v: Optional[str]) -> Optional[str]:
        if v and not TODO_RE.match(v) and not (REPO_ROOT / v).is_file():
            raise ValueError(f"seed_file not found: {v} (paths are relative to the repo root)")
        return v


class Sources(Strict):
    permits: Optional[PermitSource] = None
    parcels: list[ParcelSource] = []
    catalysts: Optional[CatalystSource] = None

    @field_validator("parcels")
    @classmethod
    def _unique_names(cls, v: list[ParcelSource]) -> list[ParcelSource]:
        names = [p.name for p in v]
        dupes = sorted({n for n in names if names.count(n) > 1})
        if dupes:
            raise ValueError(f"duplicate parcel source names: {', '.join(dupes)}")
        return v


# ---------- place file ----------


class PlaceConfig(Strict):
    place_id: PlaceId
    name: Name
    state: Usps
    county_fips: CountyFips
    census_place: Optional[CensusPlace] = None
    peer_group: Optional[PeerGroup] = None
    coverage_tier: CoverageTier
    proximity_decay_mi: Optional[list[float]] = None
    sources: Sources = Sources()

    @field_validator("proximity_decay_mi")
    @classmethod
    def _check_decay(cls, v: Optional[list[float]]) -> Optional[list[float]]:
        return v if v is None else _decay(v)

    @model_validator(mode="after")
    def _ids_and_tier(self):
        if not self.place_id.startswith(self.state.lower() + "-"):
            raise ValueError(f"place_id must start with '{self.state.lower()}-'")
        has_parcels = any(p.role == "characteristics" for p in self.sources.parcels)
        if self.coverage_tier == "parcel" and not (self.sources.permits and has_parcels):
            raise ValueError("coverage_tier parcel needs sources.permits and at least one characteristics parcel source")
        if self.coverage_tier in ("parcel_partial", "county_gis") and not has_parcels:
            raise ValueError(f"coverage_tier {self.coverage_tier} needs at least one characteristics parcel source")
        return self


# ---------- state file ----------


class StateDefaults(Strict):
    peer_group: Optional[PeerGroup] = None
    proximity_decay_mi: Optional[list[float]] = None
    coverage_tier: Optional[CoverageTier] = None
    since_months: Optional[Annotated[int, Field(ge=1, le=600)]] = None

    @field_validator("proximity_decay_mi")
    @classmethod
    def _check_decay(cls, v: Optional[list[float]]) -> Optional[list[float]]:
        return v if v is None else _decay(v)


class TigerSource(Strict):
    connector: Literal["tiger"]
    year: Annotated[int, Field(ge=2010)]
    url: str  # tracts
    places_url: str  # incorporated places + CDPs: match baseline permits to the issuing place
    cousub_url: str  # county subdivisions: for township-issued permits


AcsVar = Annotated[str, StringConstraints(pattern=r"^B\d{5}[A-Z]?_\d{3}E$")]


class AcsSource(Strict):
    connector: Literal["acs"]
    dataset: Literal["acs5"] = "acs5"
    year: Annotated[int, Field(ge=2010)]
    variables: dict[Annotated[str, StringConstraints(pattern=r"^[a-z0-9_]+$")], AcsVar]
    # How to approximate the rehab age band from year-built buckets: {variable: weight}.
    rehab_band_weights: dict[AcsVar, Annotated[float, Field(gt=0, le=1)]] = {}

    @model_validator(mode="after")
    def _housing_units(self):
        if "housing_units" not in self.variables:
            raise ValueError("variables must include housing_units (used to allocate baseline permits to tracts)")
        return self


class BpsSource(Strict):
    connector: Literal["census_bps"]
    frequency: Literal["annual", "monthly"] = "annual"
    url: str  # file URL pattern; {year} / {yyyymm} placeholders allowed
    allocate_by: Literal["housing_units"] = "housing_units"
    years: Annotated[int, Field(ge=1, le=10)] = 3  # newest N annual files


class Baseline(Strict):
    permits: BpsSource
    housing: AcsSource


class StateConfig(Strict):
    state: Usps
    state_fips: StateFips
    name: Name
    defaults: StateDefaults = StateDefaults()
    geography: TigerSource
    baseline: Baseline


# ---------- checking files ----------


@dataclass
class FileReport:
    path: Path
    kind: Literal["state", "place"]
    errors: list[str] = field(default_factory=list)  # "dotted.path: message"
    todos: list[str] = field(default_factory=list)  # "dotted.path: TODO note"
    model: Optional[Union[StateConfig, PlaceConfig]] = None
    raw: dict[str, Any] = field(default_factory=dict)


def _walk_todos(node: Any, path: tuple = ()) -> list[tuple[tuple, str]]:
    if isinstance(node, dict):
        return [t for k, v in node.items() for t in _walk_todos(v, path + (k,))]
    if isinstance(node, list):
        return [t for i, v in enumerate(node) for t in _walk_todos(v, path + (i,))]
    if isinstance(node, str) and TODO_RE.match(node.strip()):
        return [(path, node.strip())]
    return []


def _dotted(loc: tuple) -> str:
    out = ""
    for p in loc:
        out += f"[{p}]" if isinstance(p, int) else (f".{p}" if out else str(p))
    return out or "(file)"


def _caused_by_todo(loc: tuple, todo_paths: list[tuple]) -> bool:
    """Pydantic inserts union member names into error locations, so match the TODO
    path as an in-order subsequence of the location rather than an exact prefix."""
    for tp in todo_paths:
        it = iter(loc)
        if all(any(seg == x for x in it) for seg in tp):
            return True
    return False


def check_file(path: Path) -> FileReport:
    kind: Literal["state", "place"] = "state" if path.name == "_state.yaml" else "place"
    rep = FileReport(path=path, kind=kind)
    try:
        raw = yaml.safe_load(path.read_text())
    except yaml.YAMLError as e:
        rep.errors.append(f"(file): not valid YAML: {e}")
        return rep
    if not isinstance(raw, dict):
        rep.errors.append("(file): must be a YAML mapping")
        return rep
    rep.raw = raw
    todos = _walk_todos(raw)
    rep.todos = [f"{_dotted(p)}: {note}" for p, note in todos]
    model_cls = StateConfig if kind == "state" else PlaceConfig
    try:
        rep.model = model_cls.model_validate(raw)
    except ValidationError as e:
        for err in e.errors(include_url=False):
            if _caused_by_todo(tuple(err["loc"]), [p for p, _ in todos]):
                continue
            msg = err["msg"].removeprefix("Value error, ")
            rep.errors.append(f"{_dotted(tuple(err['loc']))}: {msg}")
    return rep


def check_tree(paths: list[Path]) -> list[FileReport]:
    """Check files plus the rules that span files (contract section 1.7)."""
    files: list[Path] = []
    for p in paths:
        files += sorted(p.rglob("*.yaml")) if p.is_dir() else [p]
    reports = [check_file(f) for f in files]

    states: dict[Path, FileReport] = {r.path.parent: r for r in reports if r.kind == "state"}
    # A place file anywhere in the tree needs its folder's _state.yaml, even if only one file was passed.
    for folder in {r.path.parent for r in reports if r.kind == "place"} - states.keys():
        sf = folder / "_state.yaml"
        if sf.is_file():
            states[folder] = check_file(sf)

    seen: dict[str, Path] = {}
    for r in reports:
        folder = r.path.parent
        if folder.resolve().parent != PLACES_DIR.resolve():
            r.errors.append("(file): must live in places/<state>/")
        st = states.get(folder)
        code = folder.name.upper()
        if r.raw.get("state") not in (None, code) and not _is_todo(r.raw.get("state")):
            r.errors.append(f"state: is {r.raw.get('state')!r} but the folder is places/{folder.name}/")
        if r.kind == "state":
            continue
        if st is None:
            r.errors.append(f"(file): places/{folder.name}/_state.yaml is missing")
        fips = (st.raw.get("state_fips") if st else None) or ""
        for key in ("county_fips", "census_place"):
            v = r.raw.get(key)
            if isinstance(v, str) and fips and not _is_todo(v) and not v.startswith(str(fips)):
                r.errors.append(f"{key}: {v} does not start with the state FIPS {fips}")
        pid = r.raw.get("place_id")
        if isinstance(pid, str) and not _is_todo(pid):
            if pid != f"{folder.name}-{r.path.stem}":
                r.errors.append(f"place_id: is {pid!r} but the file name means {folder.name + '-' + r.path.stem!r}")
            if pid in seen:
                r.errors.append(f"place_id: {pid!r} is also used by {seen[pid].relative_to(REPO_ROOT)}")
            seen.setdefault(pid, r.path)
    return reports


def _is_todo(v: Any) -> bool:
    return isinstance(v, str) and bool(TODO_RE.match(v.strip()))
