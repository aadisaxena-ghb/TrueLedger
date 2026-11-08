-- ============================================================
-- TRUELEDGER — Supabase Database Schema & Security Policies
-- Run this in your Supabase Project -> SQL Editor
-- ============================================================

-- 1. Enable Required Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- 2. User Profiles Table (Auto-syncs with Supabase Auth)
create table if not exists public.user_profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text,
  full_name text,
  avatar_url text,
  role text default 'user',
  currency text default 'USD',
  monthly_budget numeric default 0,
  pin_configured boolean default false,
  auto_lock_minutes integer default 3,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS) for user_profiles
alter table public.user_profiles enable row level security;

create policy "Users can view their own profile"
  on public.user_profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.user_profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.user_profiles for insert
  with check (auth.uid() = id);

-- Server-side Trigger: Prevent non-admin users from altering their role
create or replace function public.protect_user_role()
returns trigger as $$
begin
  if new.role is distinct from old.role and lower(coalesce(old.email, '')) <> 'saxenaaadi.11@gmail.com' then
    new.role := old.role;
  end if;
  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_user_profile_role_guard on public.user_profiles;
create trigger on_user_profile_role_guard
  before update on public.user_profiles
  for each row execute procedure public.protect_user_role();

-- 3. Encrypted User Vaults (Zero-Knowledge Cloud Backup)
-- The payload is encrypted client-side with AES-256-GCM using the user's PIN/Key before upload.
-- Supabase stores only ciphertext; server & admins cannot read plain financial records.
create table if not exists public.user_vaults (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  encrypted_data jsonb not null default '{}'::jsonb,
  vault_version integer default 2,
  client_updated_at timestamptz default timezone('utc'::text, now()) not null,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- Enable RLS for user_vaults
alter table public.user_vaults enable row level security;

create policy "Users can view only their own encrypted vault"
  on public.user_vaults for select
  using (auth.uid() = user_id);

create policy "Users can insert their own encrypted vault"
  on public.user_vaults for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own encrypted vault"
  on public.user_vaults for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own encrypted vault"
  on public.user_vaults for delete
  using (auth.uid() = user_id);

-- 4. Cloud Transactions Table (Optional Granular Ledger Sync)
create table if not exists public.cloud_transactions (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  type text not null check (type in ('expense', 'income', 'transfer')),
  amount numeric not null,
  description text not null,
  category text default 'Other',
  account_name text default 'Everyday Bank',
  to_account_name text,
  date date not null default current_date,
  upi_ref text,
  payment_app text,
  note text,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- Enable RLS for cloud_transactions
alter table public.cloud_transactions enable row level security;

create policy "Users can view only their own cloud transactions"
  on public.cloud_transactions for select
  using (auth.uid() = user_id);

create policy "Users can insert their own cloud transactions"
  on public.cloud_transactions for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own cloud transactions"
  on public.cloud_transactions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own cloud transactions"
  on public.cloud_transactions for delete
  using (auth.uid() = user_id);

-- 5. Trigger to automatically provision user_profile upon Auth signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.user_profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', ''),
    case when lower(new.email) = 'saxenaaadi.11@gmail.com' then 'admin' else 'user' end
  )
  on conflict (id) do update set
    role = case when lower(excluded.email) = 'saxenaaadi.11@gmail.com' then 'admin' else public.user_profiles.role end;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Elevate saxenaaadi.11@gmail.com if already existing
update public.user_profiles
set role = 'admin'
where lower(email) = 'saxenaaadi.11@gmail.com';

-- 6. High-speed Indexes for lightning fast queries
create index if not exists idx_user_vaults_user_id on public.user_vaults(user_id);
create index if not exists idx_cloud_tx_user_date on public.cloud_transactions(user_id, date desc);
create index if not exists idx_cloud_tx_user_category on public.cloud_transactions(user_id, category);
create index if not exists idx_cloud_tx_user_upiref on public.cloud_transactions(user_id, upi_ref);
