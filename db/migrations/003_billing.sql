-- 003_billing.sql: subscriptions, founding seats, team invites, entitlements, webhook idempotency.
-- Applies after 001_users.sql and 002_profiles.sql.
-- Append-only: don't edit this file once it has been applied.

begin;

alter table users
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists plan text not null default 'free',
  add column if not exists subscription_status text not null default 'none',
  add column if not exists billing_interval text,
  add column if not exists founding_member boolean not null default false,
  add column if not exists seats integer not null default 1,
  add column if not exists current_period_end timestamptz,
  add column if not exists grace_until timestamptz,
  add column if not exists trial_used boolean not null default false,
  add column if not exists cancel_at_period_end boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_plan_chk') then
    alter table users
      add constraint users_plan_chk check (plan in ('free', 'pro', 'team', 'founding'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_subscription_status_chk') then
    alter table users
      add constraint users_subscription_status_chk check (
        subscription_status in ('none', 'trialing', 'active', 'past_due', 'canceled', 'incomplete', 'unpaid')
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_billing_interval_chk') then
    alter table users
      add constraint users_billing_interval_chk check (
        billing_interval is null or billing_interval in ('month', 'year')
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_seats_chk') then
    alter table users
      add constraint users_seats_chk check (seats >= 1);
  end if;
end $$;

create unique index if not exists users_stripe_customer_idx on users (stripe_customer_id)
  where stripe_customer_id is not null;
create unique index if not exists users_stripe_subscription_idx on users (stripe_subscription_id)
  where stripe_subscription_id is not null;
create index if not exists users_founding_active_idx on users (plan, subscription_status)
  where founding_member;

-- One team per paying owner. Members reference the team, not a second subscription.
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists team_members (
  team_id uuid not null references teams (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create unique index if not exists team_members_user_idx on team_members (user_id);

create table if not exists team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  email text not null,
  token text not null unique,
  invited_by uuid not null references users (id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists team_invites_team_idx on team_invites (team_id, expires_at);

-- One-off area and property report purchases.
create table if not exists entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  report_type text not null check (report_type in ('area', 'property')),
  target_id text not null,
  stripe_session_id text not null unique,
  stripe_payment_intent text,
  amount_total integer,
  currency text,
  created_at timestamptz not null default now(),
  unique (user_id, report_type, target_id)
);
create index if not exists entitlements_user_idx on entitlements (user_id, created_at desc);

-- Stripe event ids. A repeat delivery hits the primary key and is skipped.
create table if not exists stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

alter table teams enable row level security;
alter table team_members enable row level security;
alter table team_invites enable row level security;
alter table entitlements enable row level security;
alter table stripe_events enable row level security;

commit;
