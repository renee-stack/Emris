-- 002_billing.sql: subscriptions, team seats, and watchlists.
-- Access rules in web/lib/access.ts read these tables. Append-only.

begin;

create table subscriptions (
  user_id                 uuid primary key references users (id) on delete cascade,
  plan                    text not null check (plan in ('pro', 'founding', 'team')),
  status                  text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete')),
  role                    text check (role in ('owner', 'member')),
  stripe_customer_id      text,
  stripe_subscription_id  text unique,
  payment_failed_at       timestamptz,
  current_period_end      timestamptz,
  seat_limit              integer check (seat_limit is null or seat_limit > 0),
  updated_at              timestamptz not null default now()
);

create table team_members (
  owner_user_id   uuid not null references users (id) on delete cascade,
  member_user_id  uuid not null references users (id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (owner_user_id, member_user_id),
  check (owner_user_id <> member_user_id)
);
create index team_members_member_idx on team_members (member_user_id);

create table watchlists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  area_id     text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, area_id)
);
create index watchlists_user_idx on watchlists (user_id, created_at desc);

alter table subscriptions enable row level security;
alter table team_members  enable row level security;
alter table watchlists    enable row level security;

commit;
