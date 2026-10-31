"""Load validated place and state configs. The pipeline refuses configs with errors or TODOs."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from places._schema import PLACES_DIR, PlaceConfig, StateConfig, check_tree


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Place:
    config: PlaceConfig
    state: StateConfig
    path: Path

    @property
    def place_id(self) -> str:
        return self.config.place_id

    @property
    def since_months(self) -> int:
        p = self.config.sources.permits
        return (p.since_months if p and p.since_months else None) or self.state.defaults.since_months or 24

    @property
    def peer_group(self) -> str:
        return self.config.peer_group or self.state.defaults.peer_group or f"state:{self.state.state_fips}"

    @property
    def proximity_decay_mi(self) -> list[float]:
        return self.config.proximity_decay_mi or self.state.defaults.proximity_decay_mi or [0.25, 1.0]


def _checked(folder: Path):
    reports = check_tree([folder])
    bad = [f"{r.path.name}: {e}" for r in reports for e in r.errors]
    if bad:
        raise ConfigError("place configs have errors (run python -m pipeline.validate):\n  " + "\n  ".join(bad))
    return reports


def _no_todos(report) -> None:
    if report.todos:
        raise ConfigError(f"{report.path.name} still has TODOs: " + "; ".join(report.todos))


def load_state(state: str) -> tuple[StateConfig, list[Place]]:
    """The state's config plus every place config in its folder."""
    folder = PLACES_DIR / state.lower()
    if not (folder / "_state.yaml").is_file():
        raise ConfigError(f"no places/{state.lower()}/_state.yaml")
    reports = _checked(folder)
    st_rep = next(r for r in reports if r.kind == "state")
    _no_todos(st_rep)
    places = [Place(r.model, st_rep.model, r.path) for r in reports if r.kind == "place"]
    return st_rep.model, places


def load_place(place_id: str) -> Place:
    state = place_id.split("-", 1)[0]
    _, places = load_state(state)
    for p in places:
        if p.place_id == place_id:
            rep = next(r for r in check_tree([p.path]) if r.path == p.path)
            _no_todos(rep)
            return p
    raise ConfigError(f"no place config with place_id {place_id!r} in places/{state}/")
