-- ============================================================
-- AIプラ Web版 Supabase スキーマ（profiles / memos / reservations）
-- Supabase ダッシュボード → SQL Editor に貼り付けて実行してください。
-- すべて RLS 有効。ユーザーは自分の行のみ読み書き可能。
-- ============================================================

-- 拡張（UUID生成）
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- profiles：ユーザープロフィール（auth.users と 1:1）
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- 新規ユーザー登録時に profiles を自動作成
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- memos：メモ
-- ------------------------------------------------------------
create table if not exists public.memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  body text not null default '',
  tags text[] not null default '{}',
  -- 将来用（OCR・要約・画像）。P1では未使用でもカラムだけ用意。
  summary text,
  ocr_text text,
  images jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memos_user_id_updated_at_idx
  on public.memos (user_id, updated_at desc);

alter table public.memos enable row level security;

drop policy if exists "memos_select_own" on public.memos;
create policy "memos_select_own" on public.memos
  for select using (auth.uid() = user_id);

drop policy if exists "memos_insert_own" on public.memos;
create policy "memos_insert_own" on public.memos
  for insert with check (auth.uid() = user_id);

drop policy if exists "memos_update_own" on public.memos;
create policy "memos_update_own" on public.memos
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "memos_delete_own" on public.memos;
create policy "memos_delete_own" on public.memos
  for delete using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- reservations：予定（次フェーズ用。テーブルのみ準備）
-- ------------------------------------------------------------
create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  content text not null default '',
  schedule_at timestamptz,
  notification_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reservations_user_id_schedule_at_idx
  on public.reservations (user_id, schedule_at);

alter table public.reservations enable row level security;

drop policy if exists "reservations_select_own" on public.reservations;
create policy "reservations_select_own" on public.reservations
  for select using (auth.uid() = user_id);

drop policy if exists "reservations_insert_own" on public.reservations;
create policy "reservations_insert_own" on public.reservations
  for insert with check (auth.uid() = user_id);

drop policy if exists "reservations_update_own" on public.reservations;
create policy "reservations_update_own" on public.reservations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "reservations_delete_own" on public.reservations;
create policy "reservations_delete_own" on public.reservations
  for delete using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- ロール権限（GRANT）
--   RLS は「行レベル」の制御。これとは別に、テーブルへの基本権限を
--   authenticated（ログイン済みユーザー）ロールへ付与する必要がある。
--   これが無いと permission denied (code=42501) になる。
--   ※ RLS は有効のまま。実際にアクセスできる行は各ポリシーで制限される。
-- ------------------------------------------------------------
-- ------------------------------------------------------------
-- contact_inquiries：お問い合わせ
--   アプリ内お問い合わせフォームの送信内容を保存する。
--   ユーザーは自分のお問い合わせのみ insert / select 可能。
--   返信（admin_reply 等）の更新は管理者（service role）側で行う想定。
--   画像本体のアップロードは未対応（ファイル名のみ保存）。
-- ------------------------------------------------------------
create table if not exists public.contact_inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_name text,
  user_email text,
  inquiry_category text,
  inquiry_message text,
  attached_image_filename text,
  status text not null default '未対応',
  ai_draft_reply text,
  admin_reply text,
  reply_status text not null default '未対応',
  replied_at timestamptz,
  replied_by uuid,
  is_sent boolean not null default false,
  is_knowledge_candidate boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists contact_inquiries_user_id_created_at_idx
  on public.contact_inquiries (user_id, created_at desc);

alter table public.contact_inquiries enable row level security;

drop policy if exists "contact_inquiries_select_own" on public.contact_inquiries;
create policy "contact_inquiries_select_own" on public.contact_inquiries
  for select using (auth.uid() = user_id);

drop policy if exists "contact_inquiries_insert_own" on public.contact_inquiries;
create policy "contact_inquiries_insert_own" on public.contact_inquiries
  for insert with check (auth.uid() = user_id);

-- 管理者（許可メールアドレス）は全件 select 可能（運営のお問い合わせ管理画面用）。
-- 当面は許可メールアドレス方式。将来は admins テーブル等に置き換え可能。
drop policy if exists "contact_inquiries_select_admin" on public.contact_inquiries;
create policy "contact_inquiries_select_admin" on public.contact_inquiries
  for select using ((auth.jwt() ->> 'email') = 'designat5take@gmail.com');

-- 管理者（許可メールアドレス）は返信（admin_reply 等）の更新が可能。
-- ユーザーは update 不可（自分のお問い合わせの内容も改変させない）。
drop policy if exists "contact_inquiries_update_admin" on public.contact_inquiries;
create policy "contact_inquiries_update_admin" on public.contact_inquiries
  for update using ((auth.jwt() ->> 'email') = 'designat5take@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'designat5take@gmail.com');

-- ------------------------------------------------------------
-- ロール権限（GRANT）
--   RLS は「行レベル」の制御。これとは別に、テーブルへの基本権限を
--   authenticated（ログイン済みユーザー）ロールへ付与する必要がある。
--   これが無いと permission denied (code=42501) になる。
--   ※ RLS は有効のまま。実際にアクセスできる行は各ポリシーで制限される。
-- ------------------------------------------------------------
grant usage on schema public to authenticated;

grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.memos to authenticated;
grant select, insert, update, delete on table public.reservations to authenticated;
-- お問い合わせはユーザーからは送信（insert）と自分の参照（select）。
-- update は許可しているが、RLS により実際に更新できるのは管理者（許可メール）のみ。
grant select, insert, update on table public.contact_inquiries to authenticated;

-- ------------------------------------------------------------
-- chatbot_knowledge：Q&A / FAQ ナレッジ
--   お問い合わせと管理者返信をもとに、個人情報を除いた一般的なQ&Aとして保存する。
--   管理者（許可メール）のみ参照・追加・更新可能。is_public=false（公開前提ではなく確認用）。
--   同一お問い合わせからの重複登録は一意制約で防止する。
-- ------------------------------------------------------------
create table if not exists public.chatbot_knowledge (
  id uuid primary key default gen_random_uuid(),
  category text,
  question text not null,
  answer text not null,
  source_type text not null default 'inquiry',
  source_inquiry_id uuid references public.contact_inquiries (id) on delete set null,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 同一お問い合わせからの重複登録を防止（inquiry 由来のみ）
create unique index if not exists chatbot_knowledge_source_inquiry_uniq
  on public.chatbot_knowledge (source_inquiry_id)
  where source_inquiry_id is not null;

alter table public.chatbot_knowledge enable row level security;

drop policy if exists "chatbot_knowledge_admin_select" on public.chatbot_knowledge;
create policy "chatbot_knowledge_admin_select" on public.chatbot_knowledge
  for select using ((auth.jwt() ->> 'email') = 'designat5take@gmail.com');

drop policy if exists "chatbot_knowledge_admin_insert" on public.chatbot_knowledge;
create policy "chatbot_knowledge_admin_insert" on public.chatbot_knowledge
  for insert with check ((auth.jwt() ->> 'email') = 'designat5take@gmail.com');

drop policy if exists "chatbot_knowledge_admin_update" on public.chatbot_knowledge;
create policy "chatbot_knowledge_admin_update" on public.chatbot_knowledge
  for update using ((auth.jwt() ->> 'email') = 'designat5take@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'designat5take@gmail.com');

-- Q&Aナレッジは管理者のみ。RLS で許可メールに限定。
grant select, insert, update on table public.chatbot_knowledge to authenticated;
