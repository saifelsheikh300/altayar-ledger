-- ============================================================
-- altayar-ledger — Master Database Setup
-- نظام دائن/مدين بين الأدمن والمناديب - الطيار ديليفري
-- قابل لإعادة التشغيل بأمان: ينفع تشغله أكتر من مرة من غير مشاكل
-- ============================================================

-- تفعيل إضافة توليد الـ UUID
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1) profiles: بروفايل لكل مستخدم (أدمن أو مندوب)، مرتبط بـ auth.users
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  role text not null default 'driver' check (role in ('admin', 'driver')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2) transaction_types: أنواع العمليات (سلف، تحويلات، مرتب...) الأدمن بيديرها
-- ------------------------------------------------------------
create table if not exists public.transaction_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text default '#FD5003',
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3) transactions: سجل الحركات المالية لكل مندوب
--    amount موجب = المندوب مديون (عليه فلوس للأدمن)
--    amount سالب = المندوب دائن (له فلوس عند الأدمن)
-- ------------------------------------------------------------
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete cascade,
  type_id uuid references public.transaction_types(id) on delete set null,
  amount numeric(12,2) not null,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_transactions_driver on public.transactions(driver_id);
create index if not exists idx_transactions_created_at on public.transactions(created_at);

-- ------------------------------------------------------------
-- 4) settlement_requests: طلبات تسوية (سددت) من المندوب، الأدمن بيوافق عليها
-- ------------------------------------------------------------
create table if not exists public.settlement_requests (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete cascade,
  requested_amount numeric(12,2) not null,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);

create index if not exists idx_settlement_driver on public.settlement_requests(driver_id);
create index if not exists idx_settlement_status on public.settlement_requests(status);

-- ------------------------------------------------------------
-- 5) دالة مساعدة: هل المستخدم الحالي أدمن؟
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ------------------------------------------------------------
-- 6) تفعيل RLS
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.transaction_types enable row level security;
alter table public.transactions enable row level security;
alter table public.settlement_requests enable row level security;

-- ------------------------------------------------------------
-- 7) Policies — profiles
-- ------------------------------------------------------------
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_insert_admin" on public.profiles;
create policy "profiles_insert_admin"
  on public.profiles for insert
  with check (public.is_admin());

drop policy if exists "profiles_update_admin_or_self" on public.profiles;
create policy "profiles_update_admin_or_self"
  on public.profiles for update
  using (public.is_admin() or id = auth.uid());

-- ------------------------------------------------------------
-- 8) Policies — transaction_types
-- ------------------------------------------------------------
drop policy if exists "types_select_all" on public.transaction_types;
create policy "types_select_all"
  on public.transaction_types for select
  using (auth.uid() is not null);

drop policy if exists "types_write_admin" on public.transaction_types;
create policy "types_write_admin"
  on public.transaction_types for all
  using (public.is_admin())
  with check (public.is_admin());

-- ------------------------------------------------------------
-- 9) Policies — transactions
-- ------------------------------------------------------------
drop policy if exists "transactions_select_own_or_admin" on public.transactions;
create policy "transactions_select_own_or_admin"
  on public.transactions for select
  using (driver_id = auth.uid() or public.is_admin());

drop policy if exists "transactions_write_admin" on public.transactions;
create policy "transactions_write_admin"
  on public.transactions for all
  using (public.is_admin())
  with check (public.is_admin());

-- ------------------------------------------------------------
-- 10) Policies — settlement_requests
-- ------------------------------------------------------------
drop policy if exists "settlement_select_own_or_admin" on public.settlement_requests;
create policy "settlement_select_own_or_admin"
  on public.settlement_requests for select
  using (driver_id = auth.uid() or public.is_admin());

drop policy if exists "settlement_insert_own" on public.settlement_requests;
create policy "settlement_insert_own"
  on public.settlement_requests for insert
  with check (driver_id = auth.uid() and public.is_admin() = false);

drop policy if exists "settlement_update_admin" on public.settlement_requests;
create policy "settlement_update_admin"
  on public.settlement_requests for update
  using (public.is_admin())
  with check (public.is_admin());

-- ------------------------------------------------------------
-- 11) أنواع عمليات افتراضية (تتضاف مرة واحدة بس لو مش موجودة)
-- ------------------------------------------------------------
insert into public.transaction_types (name, color)
values
  ('تحصيل توصيلة', '#FD5003'),
  ('سلفة', '#E63946'),
  ('مرتب', '#2A9D8F'),
  ('تسوية', '#457B9D')
on conflict (name) do nothing;

-- ============================================================
-- تم! بعد تشغيل الملف ده، لازم تعمل أول حساب أدمن يدويًا:
-- 1) من Supabase Dashboard -> Authentication -> Users -> Add User
-- 2) بعد ما تعمل اليوزر، انسخ الـ UID بتاعه
-- 3) شغل السطر ده في SQL Editor (غيّر القيم):
--    insert into public.profiles (id, full_name, role)
--    values ('USER-UID-HERE', 'اسم الأدمن', 'admin');
-- ============================================================
