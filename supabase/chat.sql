-- WSB Generations League — native league chat
-- Paste into the Supabase SQL editor and Run. Safe to re-run.

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  team_id integer not null,
  team_name text not null check (char_length(team_name) <= 80),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_id_idx on public.chat_messages (id desc);

alter table public.chat_messages enable row level security;

drop policy if exists "chat: read" on public.chat_messages;
drop policy if exists "chat: insert" on public.chat_messages;
create policy "chat: read" on public.chat_messages for select to anon, authenticated using (true);
create policy "chat: insert" on public.chat_messages for insert to anon, authenticated with check (true);

revoke update, delete on public.chat_messages from anon, authenticated;
