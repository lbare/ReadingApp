-- One row per read-through, so rereads count in stats (Goodreads' export
-- keeps only one "Date Read" per book).
create table public.reads (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.books(id) on delete cascade,
  date_started  date,
  date_finished date,
  source        text not null default 'app' check (source in ('app', 'goodreads_csv', 'goodreads_rss')),
  created_at    timestamptz not null default now()
);

-- One read per book per finish date (re-imports don't duplicate).
create unique index reads_book_finished_key on public.reads (book_id, date_finished);
create index reads_finished_idx on public.reads (date_finished);

alter table public.reads enable row level security;
create policy "signed in: reads" on public.reads for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.reads to authenticated, service_role;

-- Backfill: every finished book's known finish date becomes a read.
insert into public.reads (book_id, date_finished, source)
select id, date_read, case when source in ('goodreads_csv', 'goodreads_rss') then source else 'app' end
from public.books
where shelf = 'read' and date_read is not null
on conflict do nothing;
