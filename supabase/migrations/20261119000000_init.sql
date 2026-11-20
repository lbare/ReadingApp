-- Reading App: Phase 1 schema.
-- Single-user app: every signed-in user can read and write everything, so turn
-- off new sign-ups in Supabase (Authentication → Providers → Email) once your
-- own account exists.

create extension if not exists pgcrypto;

-- One row per book, whatever shelf it is on.
create table public.books (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  author          text,
  isbn13          text,
  isbn10          text,
  goodreads_id    text unique,
  ol_work_key     text unique,           -- e.g. "/works/OL82563W"
  cover_url       text,
  pages           integer,
  avg_rating      numeric(3, 2),
  ratings_count   integer,
  published_year  integer,

  shelf           text not null check (shelf in ('next_up', 'to_read', 'currently_reading', 'read')),
  position        integer,                -- order within Next Up (lower = sooner)
  my_rating       smallint check (my_rating between 0 and 5),
  date_added      date,
  date_started    date,
  date_read       date,                   -- most recent finish date
  read_count      integer not null default 0,

  source          text not null default 'manual'
                  check (source in ('manual', 'tiktok', 'screenshot', 'text', 'goodreads_csv', 'goodreads_rss')),
  source_url      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index books_shelf_idx on public.books (shelf, position);
create index books_date_read_idx on public.books (date_read) where date_read is not null;
create index books_isbn13_idx on public.books (isbn13) where isbn13 is not null;

-- Something shared from the iPhone, plus the books found in it.
create table public.captures (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  source_type  text not null check (source_type in ('tiktok', 'screenshot', 'text')),
  source_url   text,
  raw_text     text,                      -- TikTok caption or the text that was shared
  -- [{ query: {title, author}, candidates: [BookCandidate...], decision: null | 'next_up' | 'to_read' | 'skipped', book_id }]
  items        jsonb not null default '[]'::jsonb,
  status       text not null default 'pending' check (status in ('pending', 'done')),
  error        text
);

create index captures_created_idx on public.captures (created_at desc);

-- Single settings row.
create table public.settings (
  id                    smallint primary key default 1 check (id = 1),
  yearly_goal           integer not null default 52,
  goodreads_user_id     text,
  goodreads_rss_key     text,             -- only needed if the Goodreads profile is private
  goodreads_last_sync   timestamptz,
  goodreads_last_result text
);
insert into public.settings (id) values (1) on conflict do nothing;

-- updated_at bookkeeping
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger books_touch before update on public.books
for each row execute function public.touch_updated_at();

-- Row level security: signed-in users only. The edge functions use the
-- service role key and bypass RLS.
alter table public.books    enable row level security;
alter table public.captures enable row level security;
alter table public.settings enable row level security;

create policy "signed in: books"    on public.books    for all to authenticated using (true) with check (true);
create policy "signed in: captures" on public.captures for all to authenticated using (true) with check (true);
create policy "signed in: settings" on public.settings for all to authenticated using (true) with check (true);
