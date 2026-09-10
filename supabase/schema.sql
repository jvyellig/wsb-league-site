-- WSB Generations League — trade block schema
-- Paste this whole file into the Supabase SQL editor and click Run. Safe to re-run.

create table if not exists public.trade_posts (
  id uuid primary key default gen_random_uuid(),
  team_id integer not null,
  team_name text not null check (char_length(team_name) <= 80),
  offering text not null check (char_length(offering) between 1 and 500),
  seeking text not null check (char_length(seeking) between 1 and 500),
  notes text check (char_length(notes) <= 300),
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now()
);

create table if not exists public.trade_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.trade_posts (id) on delete cascade,
  team_id integer not null,
  team_name text not null check (char_length(team_name) <= 80),
  body text not null check (char_length(body) between 1 and 400),
  created_at timestamptz not null default now()
);

create index if not exists trade_comments_post_idx on public.trade_comments (post_id, created_at);
create index if not exists trade_posts_created_idx on public.trade_posts (created_at desc);

-- Row level security: anyone with the site's public key can read, post and comment;
-- the only update allowed is flipping a post's status (column-level grant below). No deletes.
alter table public.trade_posts enable row level security;
alter table public.trade_comments enable row level security;

drop policy if exists "posts: read" on public.trade_posts;
drop policy if exists "posts: insert" on public.trade_posts;
drop policy if exists "posts: update status" on public.trade_posts;
drop policy if exists "comments: read" on public.trade_comments;
drop policy if exists "comments: insert" on public.trade_comments;

create policy "posts: read" on public.trade_posts for select to anon, authenticated using (true);
create policy "posts: insert" on public.trade_posts for insert to anon, authenticated with check (true);
create policy "posts: update status" on public.trade_posts for update to anon, authenticated using (true) with check (true);
create policy "comments: read" on public.trade_comments for select to anon, authenticated using (true);
create policy "comments: insert" on public.trade_comments for insert to anon, authenticated with check (true);

revoke update on public.trade_posts from anon, authenticated;
grant update (status) on public.trade_posts to anon, authenticated;
revoke delete on public.trade_posts from anon, authenticated;
revoke delete on public.trade_comments from anon, authenticated;
revoke update on public.trade_comments from anon, authenticated;
