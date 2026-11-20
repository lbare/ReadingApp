# Reading

A personal reading app: save books from TikTok in two taps, keep a Next Up / To-Read queue, and see your reading stats
built from your whole Goodreads history. This is **Phase 1** of the plan in the
"Reading App — Capture, Kobo Sync & Phase 1" doc. The Kobo desktop agent and the Discover tab are Phase 2.

**Live app:** https://lbare.github.io/ReadingApp/

## Status

| Part | State |
| --- | --- |
| Web app on GitHub Pages | Live; redeploys on every push to `main` |
| Database (Supabase) | Tables, access grants and row-level security applied |
| `capture` function | Live. Tested with shared text and with screenshots (base64 JSON and file upload) |
| `goodreads-sync` function | Live, not yet run against a real Goodreads profile |
| TikTok links | Not yet tested with a real TikTok |
| Sign-in on iPhone, Goodreads import | Not yet tested on the live app (both work in local mode) |
| "Add Book" Shortcut | Not built yet: see `shortcut/README.md` |
| Daily Goodreads sync (cron) | Optional, not set up |

## What's here

| Piece | Where | What it does |
| --- | --- | --- |
| Web app | `src/` (Vite + React) | Shelves, the capture confirmation page, Goodreads import, stats |
| `capture` function | `supabase/functions/capture` | Takes a TikTok link, a screenshot or text from the Shortcut. Reads the caption (TikTok oEmbed) or the image (Claude Opus 5.5), matches each book on Open Library, and returns a confirmation link. |
| `goodreads-sync` function | `supabase/functions/goodreads-sync` | Pulls your read / currently-reading / to-read RSS feeds and merges them in |
| Shared logic | `supabase/functions/_shared` | Goodreads CSV/RSS parsing, merge rules, Open Library search, stats. Used by both the app and the functions; unit-tested in `tests/` |
| Database | `supabase/migrations` | `books`, `captures`, `settings`, row-level security, and grants for the API roles |
| Deploy workflow | `.github/workflows/deploy.yml` | Tests, builds and publishes the web app to GitHub Pages |
| Shortcut | `shortcut/README.md` | Step-by-step build of the "Add Book" Apple Shortcut |

How imports merge: books are matched by Goodreads id, then ISBN, then title + author, so importing twice never duplicates.
Goodreads decides *read* and *currently reading*. A Goodreads *to-read* never pulls a book off your Next Up queue.

## Working on it

```bash
npm install
npm run dev
```

With no Supabase keys the dev server runs in **local mode**: everything is stored in that browser, so you can try
imports and stats without touching the live data. To point the dev server at Supabase instead, put
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` (see `.env.example`).

```bash
npm test                 # unit tests (parsers, merge rules, stats)
npm run typecheck        # web app + shared code
npm run check:functions  # type-checks the edge functions with Deno (via npx)
```

The Supabase CLI is a dev dependency, so use it through `npx supabase …` from this folder. This folder is already linked
to the live project.

| Change | Command |
| --- | --- |
| Web app | Push to `main`; the workflow deploys it |
| An edge function | `npx supabase functions deploy capture --use-api` (or `goodreads-sync`) |
| Database | Add a file under `supabase/migrations/`, then `npx supabase db push --remote` |
| Function secrets | Edit `supabase/functions/.env`, then `npx supabase secrets set --env-file supabase/functions/.env` |

## Running costs

- **Claude API:** each capture is one Claude Opus 5.5 call at low effort, about a cent or two. The API uses prepaid
  credits (console.anthropic.com → Plans & Billing → Credit balance). The "monthly spend limit" there is only a cap.
  With no credits, captures still save but show "credit balance is too low" on the confirmation page.
- **Supabase and GitHub Pages:** free tiers. Supabase pauses free projects after a week without activity; restore it
  from the dashboard if the app stops loading data.

## Setting it up from scratch

Already done for the live app; kept here for rebuilding it.

### 1. Supabase project

Create a project at supabase.com, then:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <your-project-ref>
```

```bash
npx supabase db push --remote
```

### 2. Secrets and functions

Copy `supabase/functions/.env.example` to `supabase/functions/.env` and fill it in:

- `ANTHROPIC_API_KEY`: from console.anthropic.com (the account needs prepaid credits).
- `CAPTURE_TOKEN`: any long random string (`openssl rand -hex 24`). The Shortcut sends it.
- `APP_URL`: where the web app is hosted, no trailing slash, e.g. `https://<user>.github.io/<repo>`.

```bash
npx supabase secrets set --env-file supabase/functions/.env
```

```bash
npx supabase functions deploy capture goodreads-sync --use-api
```

(`supabase/config.toml` turns off Supabase's JWT check for `capture`, since the Shortcut authenticates with
`CAPTURE_TOKEN` instead.)

### 3. Your login

In the Supabase dashboard:

1. **Authentication → Users → Add user**, with your email.
2. **Authentication → Sign In / Providers → Email**: turn off *Allow new users to sign up*. Every signed-in user can see
   all data, so this keeps it yours.
3. **Authentication → URL Configuration**: set *Site URL* to your `APP_URL` and add `APP_URL/**` to *Redirect URLs*.

### 4. Host the web app (GitHub Pages)

The workflow publishes to `https://<user>.github.io/<repo>/`. One-time setup (free accounts need the repo to be public;
nothing secret is in it):

1. **Settings → Pages → Source:** GitHub Actions.
2. **Settings → Secrets and variables → Actions → Variables:** add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   (Project Settings → API in Supabase). Both are public by design; the database is protected by row-level security.

Because Pages can't rewrite URLs, the workflow copies `index.html` to `404.html` so links like `/confirm/<id>` still
open the app.

### 5. On the iPhone

1. Open the site in Safari, sign in with the emailed link (open it on the same phone), then **Share → Add to Home Screen**.
2. **Goodreads history, once:** on goodreads.com, My Books → *Import and export* → *Export Library*. Upload the CSV on
   the Import page.
3. **Ongoing Goodreads sync:** on the Import page, paste your Goodreads profile link and press **Sync now**. If your
   profile is private, also paste the `key=` value from any of your shelf RSS links.
4. **Shortcut:** follow `shortcut/README.md`.

### Optional: daily Goodreads sync

Run in the Supabase SQL editor (enable the `pg_cron` and `pg_net` extensions first). This puts your service role key in
the job definition, so for anything beyond a personal project store it in Vault instead:

```sql
select cron.schedule('goodreads-sync', '0 9 * * *', $$
  select net.http_post(
    url := 'https://<your-project-ref>.supabase.co/functions/v1/goodreads-sync',
    headers := jsonb_build_object('Authorization', 'Bearer <service-role-key>', 'Content-Type', 'application/json')
  );
$$);
```

## Phase 2

- **Desktop agent (Mac):** snapshot `KoboReader.sqlite` when the Kobo connects, copy Next Up books (KEPUB) to it,
  optionally remove finished books, and a drop folder → Calibre → KEPUB step. Decided: the agent copies files to the
  Kobo itself (not a Calibre plugin), so Calibre stays the library manager.
- **Discover tab:** genre, minimum rating, minimum number of ratings, hide already-shelved.
- **Native share extension** (Expo), once the Shortcut flow feels right. It reuses the same `capture` function.
