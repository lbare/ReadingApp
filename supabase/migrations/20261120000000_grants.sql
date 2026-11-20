-- Newer Supabase projects don't grant the API roles access to new tables by
-- default. Signed-in users (still limited by the RLS policies) and the edge
-- functions' service role need it; anonymous visitors get nothing.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on public.books, public.captures, public.settings to authenticated, service_role;
