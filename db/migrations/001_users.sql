-- Account row created on first sign-in.
-- Row level security is on. No policies: the browser cannot read or write this table.

create table if not exists public.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);

alter table public.users add column if not exists email text;
alter table public.users add column if not exists created_at timestamptz;
update public.users set created_at = now() where created_at is null;
alter table public.users alter column created_at set default now();
alter table public.users alter column created_at set not null;

alter table public.users enable row level security;
