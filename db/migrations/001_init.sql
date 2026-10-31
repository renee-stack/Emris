-- 001_init.sql: Emris v2 base schema (docs/contract.md sections 2 and 4).
-- Target: Supabase Postgres 15+ with PostGIS. All geometry is SRID 4326.
-- Migrations are append-only: never edit this file once applied; add 002_*.sql.

begin;

create extension if not exists postgis;

-- ---------- places ----------
-- One row per place config (places/<state>/<place>.yaml), upserted by the pipeline.
create table places (
  place_id       text primary key check (place_id ~ '^[a-z]{2}-[a-z0-9]+(-[a-z0-9]+)*$'),
  name           text not null,
  state          char(2) not null check (state ~ '^[A-Z]{2}$'),
  county_fips    char(5) not null check (county_fips ~ '^\d{5}$'),
  census_place   char(7) check (census_place ~ '^\d{7}$'),
  peer_group     text not null check (peer_group ~ '^(cbsa:\d{5}|state:\d{2})$'),
  coverage_tier  text not null check (coverage_tier in ('parcel', 'parcel_partial', 'county_gis', 'baseline')),
  bounds         geometry(Polygon, 4326),          -- envelope of the place's tracts, for /api/places
  config         jsonb not null,                   -- the validated YAML, for audit
  config_sha256  text not null,
  updated_at     timestamptz not null default now()
);
create index places_state_idx on places (state);
create index places_bounds_gix on places using gist (bounds);

-- ---------- tracts ----------
-- Every 2020 tract in a loaded state, whether or not a place file covers it.
create table tracts (
  geoid          char(11) primary key check (geoid ~ '^\d{11}$'),
  state_fips     char(2) not null,
  county_fips    char(5) not null,
  place_id       text references places (place_id) on delete set null,  -- null = scored at state baseline only
  name           text not null,
  geom           geometry(MultiPolygon, 4326) not null,
  centroid       geometry(Point, 4326) not null,
  housing_units  integer,                          -- ACS B25001_001E
  year_built     jsonb,                            -- ACS B25034 buckets, keyed as in _state.yaml
  acs_year       smallint,
  updated_at     timestamptz not null default now(),
  check (county_fips like state_fips || '%')
);
create index tracts_place_idx on tracts (place_id);
create index tracts_county_idx on tracts (county_fips);
create index tracts_geom_gix on tracts using gist (geom);
create index tracts_centroid_gix on tracts using gist (centroid);

-- ---------- properties (StandardProperty) ----------
create table properties (
  id                 bigint generated always as identity primary key,
  place_id           text not null references places (place_id) on delete cascade,
  parcel_id          text not null,
  address            text,
  geom               geometry(Point, 4326),
  tract_geoid        char(11) references tracts (geoid),
  year_built         smallint check (year_built between 1700 and 2100),
  year_built_source  text check (year_built_source in ('assessor', 'county_gis', 'permit', 'acs_estimate')),
  units              integer check (units >= 0),
  stories            numeric(5, 1) check (stories >= 0),
  land_use           text,
  owner_name         text,                         -- public record only; never contact details
  source             text not null,                -- '<connector>:<dataset or name>'
  updated_at         timestamptz not null default now(),
  unique (place_id, parcel_id),
  check (year_built is null or year_built_source is not null)
);
create index properties_tract_idx on properties (tract_geoid);
create index properties_geom_gix on properties using gist (geom);
-- Wayback + rehab candidates: multifamily stock by age
create index properties_mf_age_idx on properties (place_id, year_built) where units >= 5;

-- ---------- permits (StandardPermit) ----------
create table permits (
  id             bigint generated always as identity primary key,
  place_id       text not null references places (place_id) on delete cascade,
  permit_id      text not null,
  issued_date    date not null,
  address        text,
  geom           geometry(Point, 4326),
  parcel_ids     text[] not null default '{}',
  permit_class   text not null check (permit_class in ('new_mf', 'alteration', 'demolition', 'roof', 'major_mep', 'other')),
  units          integer check (units >= 0),       -- null = unknown, not zero
  cost           numeric(14, 2) check (cost >= 0),
  description    text not null default '',
  source_url     text not null,
  tract_geoid    char(11) references tracts (geoid),
  property_id    bigint references properties (id) on delete set null,  -- set by the link step
  ingested_at    timestamptz not null default now(),
  unique (place_id, permit_id)
);
create index permits_place_date_idx on permits (place_id, issued_date desc);
create index permits_tract_date_idx on permits (tract_geoid, issued_date desc);
create index permits_class_idx on permits (place_id, permit_class, issued_date desc);
create index permits_property_idx on permits (property_id);
create index permits_parcel_ids_gin on permits using gin (parcel_ids);
create index permits_geom_gix on permits using gist (geom);

-- ---------- catalysts ----------
create table catalysts (
  id                   text not null,
  place_id             text not null references places (place_id) on delete cascade,
  name                 text not null,
  type                 text not null check (type in ('transit', 'park', 'streetscape', 'civic', 'other')),
  status               text not null check (status in ('planned', 'funded', 'under_construction', 'complete')),
  geom                 geometry(Point, 4326) not null,
  budget_usd           bigint check (budget_usd >= 0),
  expected_completion  text,                       -- free text as published ("2029", "Q3 2027")
  description          text not null default '',
  source_url           text,
  source               text not null check (source in ('firecrawl', 'curated')),
  retrieved_at         date,
  primary key (place_id, id)
);
create index catalysts_geom_gix on catalysts using gist (geom);

-- ---------- score_snapshots ----------
-- One row per tract per pipeline run. "Current" = newest as_of per place (view below).
create table score_snapshots (
  geoid              char(11) not null references tracts (geoid) on delete cascade,
  as_of              date not null,
  place_id           text references places (place_id) on delete cascade,  -- null = state baseline
  scoring_version    text not null,
  score              smallint not null check (score between 0 and 100),
  percentile         smallint not null check (percentile between 0 and 100),
  percentile_state   smallint not null check (percentile_state between 0 and 100),
  peer_group         text not null,
  momentum           text not null check (momentum in ('up', 'flat', 'down')),
  momentum_pct       numeric(7, 1) not null,
  mf_permits         smallint check (mf_permits between 0 and 100),          -- null = signal missing
  permit_momentum    smallint check (permit_momentum between 0 and 100),
  infra_proximity    smallint check (infra_proximity between 0 and 100),
  permit_count_24mo  integer,
  units_24mo         integer,
  coverage           jsonb not null,               -- Coverage object, contract section 2.4
  created_at         timestamptz not null default now(),
  primary key (geoid, as_of)
);
create index score_snapshots_place_asof_idx on score_snapshots (place_id, as_of desc);
create index score_snapshots_asof_idx on score_snapshots (as_of desc);

create view current_scores as
select distinct on (s.geoid) s.*
from score_snapshots s
order by s.geoid, s.as_of desc;

-- ---------- users, entitlements, search_usage ----------
-- users mirrors Supabase Auth (auth.users); created on first sign-in.
create table users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  created_at  timestamptz not null default now()
);
create unique index users_email_idx on users (lower(email));

-- One row per paid Stripe Checkout Session. The unique session id makes the webhook idempotent.
create table entitlements (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references users (id) on delete cascade,
  report_type            text not null check (report_type in ('area', 'property')),
  target_id              text not null,
  stripe_session_id      text not null unique,
  stripe_payment_intent  text,
  amount_total           integer check (amount_total >= 0),  -- smallest currency unit
  currency               char(3),
  created_at             timestamptz not null default now()
);
create index entitlements_lookup_idx on entitlements (user_id, report_type, target_id);

-- Free-account searches; /api/near allows 3 per rolling 7 days per user.
create table search_usage (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references users (id) on delete cascade,
  searched_at  timestamptz not null default now(),
  query        text not null,
  place_id     text references places (place_id) on delete set null
);
create index search_usage_user_time_idx on search_usage (user_id, searched_at desc);

-- ---------- row level security ----------
-- Supabase exposes public tables to the browser's anon key. Emris reads and writes only
-- through its own server routes (service role, which bypasses RLS), so every table is
-- locked: RLS on, no policies.
alter table places          enable row level security;
alter table tracts          enable row level security;
alter table properties      enable row level security;
alter table permits         enable row level security;
alter table catalysts       enable row level security;
alter table score_snapshots enable row level security;
alter table users           enable row level security;
alter table entitlements    enable row level security;
alter table search_usage    enable row level security;
-- Views run with their owner's rights by default; make this one respect the caller's RLS.
alter view current_scores set (security_invoker = true);

commit;
