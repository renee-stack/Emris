-- 002_baseline_permits.sql: baseline-tier permit counts per tract.
-- Census Building Permits Survey units for each permit-issuing place, allocated to its
-- tracts by housing-unit share (docs/contract.md section 1.2). Fractional on purpose.

begin;

create table baseline_permits (
  geoid        char(11) not null references tracts (geoid) on delete cascade,
  year         smallint not null check (year between 1980 and 2100),
  units_1      numeric(12, 3) not null default 0,
  units_2      numeric(12, 3) not null default 0,
  units_3_4    numeric(12, 3) not null default 0,
  units_5plus  numeric(12, 3) not null default 0,
  bldgs_5plus  numeric(12, 3) not null default 0,
  issuers      text[] not null,          -- e.g. {place:1714000} or {county_rest:17031}
  source       text not null default 'census_bps',
  primary key (geoid, year)
);
create index baseline_permits_year_idx on baseline_permits (year);

alter table baseline_permits enable row level security;

commit;
