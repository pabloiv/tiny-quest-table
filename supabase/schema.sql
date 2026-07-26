create table if not exists public.rooms (
  id text primary key,
  guide_token text not null,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists rooms_expires_at_idx on public.rooms (expires_at);

alter table public.rooms enable row level security;

drop policy if exists "rooms are server managed" on public.rooms;
create policy "rooms are server managed"
  on public.rooms
  for all
  using (false)
  with check (false);
