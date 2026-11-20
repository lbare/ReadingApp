-- Goodreads exports half-star ratings (3.5, 2.5…). Store them as-is.
-- The existing 0–5 check constraint still applies.
alter table public.books alter column my_rating type numeric(2, 1);
