-- ============================================================
-- altayar-ledger — Migration 02: last_seen_at للإشعارات
-- قابل لإعادة التشغيل بأمان
-- ============================================================

alter table public.profiles
  add column if not exists last_seen_at timestamptz not null default now();
