"""Standard records every connector's output becomes (docs/contract.md section 2)."""
from __future__ import annotations

from datetime import date
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

PermitClass = Literal["new_mf", "alteration", "demolition", "roof", "major_mep", "other"]
YearBuiltSource = Literal["assessor", "county_gis", "permit", "acs_estimate"]

Lat = Annotated[float, Field(ge=-90, le=90)]
Lng = Annotated[float, Field(ge=-180, le=180)]


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class StandardPermit(Record):
    permit_id: Annotated[str, Field(min_length=1)]
    place_id: str
    issued_date: date
    address: Optional[str]
    lat: Optional[Lat]
    lng: Optional[Lng]
    parcel_ids: tuple[str, ...]
    permit_class: PermitClass
    units: Optional[Annotated[int, Field(ge=0)]]  # None = unknown, not zero
    cost: Optional[Annotated[float, Field(ge=0)]]
    description: str
    source_url: str


class StandardProperty(Record):
    parcel_id: Annotated[str, Field(min_length=1)]
    place_id: str
    address: Optional[str]
    lat: Optional[Lat]
    lng: Optional[Lng]
    year_built: Optional[Annotated[int, Field(ge=1700, le=2100)]]
    year_built_source: Optional[YearBuiltSource]
    units: Optional[Annotated[int, Field(ge=0)]]
    stories: Optional[Annotated[float, Field(ge=0)]]
    land_use: Optional[str]
    owner_name: Optional[str]
    source: str
