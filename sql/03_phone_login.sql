-- ============================================================
-- altayar-ledger — Migration 03: تسجيل الدخول برقم التليفون
-- قابل لإعادة التشغيل بأمان
-- ============================================================

-- منع تكرار نفس رقم التليفون بين أكتر من مندوب (عشان البحث يرجع نتيجة واحدة مضمونة)
drop index if exists profiles_phone_unique_idx;
create unique index profiles_phone_unique_idx on public.profiles (phone) where phone is not null;

-- دالة بترجع الإيميل المرتبط برقم تليفون معين، عشان نستخدمه في تسجيل الدخول
-- SECURITY DEFINER عشان تقدر توصل لجدول auth.users حتى قبل تسجيل الدخول
create or replace function public.email_for_phone(p_phone text)
returns text
language sql
security definer
set search_path = public, auth
as $$
  select u.email::text
  from auth.users u
  join public.profiles pr on pr.id = u.id
  where pr.phone = p_phone
  limit 1;
$$;

-- السماح لأي حد (حتى قبل تسجيل الدخول) بمناداة الدالة دي بس، مفيش أي صلاحية تانية
grant execute on function public.email_for_phone(text) to anon, authenticated;
