-- 003_billing.sql: subscriptions, founding seats, team invites, webhook idempotency.
-- Applies after 001_init.sql. Does not depend on 002_baseline_permits.sql.
-- Append-only: don't edit this file once it has been applied.

begin;

alter table users
  add column stripe_customer_id text,
  add column stripe_subscription_id text,
  add column plan text not null default 'free',
  add column subscription_status text not null default 'none',
  add column billing_interval text,
  add column founding_member boolean not null default false,
  add column seats integer not null default 1,
  add column current_period_end timestamptz,
  add column grace_until timestamptz,
  add column trial_used boolean not null default false,
  add column cancel_at_period_end boolean not null default false;

alter table users
  add constraint users_plan_chk check (plan in ('free', 'pro', 'team', 'founding')),
  add constraint users_subscription_status_chk check (
    subscription_status in ('none', 'trialing', 'active', 'past_due', 'canceled', 'incomplete', 'unpaid')
  ),
  add constraint users_billing_interval_chk check (
    billing_interval is null or billing_interval in ('month', 'year')
  ),
  add constraint users_seats_chk check (seats >= 1);

create unique index users_stripe_customer_idx on users (stripe_customer_id)
  where stripe_customer_id is not null;
create unique index users_stripe_subscription_idx on users (stripe_subscription_id)
  where stripe_subscription_id is not null;
create index users_founding_active_idx on users (plan, subscription_status)
  where founding_member;

-- One team per paying owner. Members reference the team, not a second subscription.
create table teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table team_members (
  team_id uuid not null references teams (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
-- A person belongs to one team.
create unique index team_members_user_idx on team_members (user_id);

create table team_invites (
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
create index team_invites_team_idx on team_invites (team_id, expires_at);

-- Stripe event ids. A repeat delivery hits the primary key and is skipped.
create table stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

alter table teams enable row level security;
alter table team_members enable row level security;
alter table team_invites enable row level security;
alter table stripe_events enable row level security;

commit;
