-- Apex Vault database setup
-- Paste this into Supabase: SQL Editor > New query > Run

create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brand text not null,
  model text not null,
  colorway text,
  size text,
  condition text,
  cost numeric,
  asking_price numeric,
  upc text,
  sale_channel text,
  purchased_from text,
  notes text,
  photo_url text,
  sold boolean not null default false,
  sold_price numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  description text not null,
  amount numeric not null,
  category text,
  date date,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.statements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text,
  session_name text,
  parsed_data jsonb,
  created_at timestamptz not null default now()
);

-- Each reseller only sees their own data
alter table public.inventory  enable row level security;
alter table public.expenses   enable row level security;
alter table public.statements enable row level security;

create policy "own inventory"  on public.inventory  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own expenses"   on public.expenses   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own statements" on public.statements for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Photo storage bucket (public read, users upload into their own folder)
insert into storage.buckets (id, name, public) values ('shoes', 'shoes', true)
  on conflict (id) do nothing;

create policy "shoe photos upload" on storage.objects for insert
  with check (bucket_id = 'shoes' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "shoe photos read" on storage.objects for select
  using (bucket_id = 'shoes');
