-- First-run profile. Row level security is on. No policies, matching 001.

create table if not exists public.profiles (
  user_id uuid primary key references public.users (id) on delete cascade,
  role text,
  strategy text,
  focus_areas jsonb not null default '{}'::jsonb,
  onboarded_at timestamptz
);

alter table public.profiles enable row level security;
