# Reading

A personal reading app: save books from TikTok in two taps, keep a Next Up / To-Read queue, and see your reading stats
built from your whole Goodreads history. This is **Phase 1** of the plan in the
"Reading App — Capture, Kobo Sync & Phase 1" doc. The Kobo desktop agent and the Discover tab are Phase 2.

## What's here

| Piece | Where | What it does |
| --- | --- | --- |
| Web app | `src/` (Vite + React) | Shelves, the capture confirmation page, Goodreads import, stats |
| `capture` function | `supabase/functions/capture` | Takes a TikTok link, a screenshot or text from the Shortcut. Reads the caption (TikTok oEmbed) or the image (Claude Opus 5.5), matches each book on Open Library, and returns a confirmation link. |
| `goodreads-sync` function | `supabase/functions/goodreads-sync` | Pulls your read / currently-reading / to-read RSS feeds and merges them in |
| Shared logic | `supabase/functions/_shared` | Goodreads CSV/RSS parsing, merge rules, Open Library search, stats. Used by both the app and the functions; unit-tested in `tests/` |
| Database | `supabase/migrations` | `books`, `captures`, `settings`, with row-level security |
| Shortcut | `shortcut/README.md` | Step-by-step build of the "Add Book" Apple Shortcut |

How imports merge: books are matched by Goodreads id, then ISBN, then title + author, so importing twice never duplicates.
Goodreads decides *read* and *currently reading*. A Goodreads *to-read* never pulls a book off your Next Up queue.

## Try it locally (no accounts needed)

```bash
npm install
npm run dev
```

With no Supabase keys the app runs in **local mode**: everything is stored in that browser. Import your Goodreads CSV and
look at Stats right away. The Shortcut and RSS sync need Supabase.

```bash
npm test                 # unit tests (parsers, merge rules, stats)
npm run typecheck        # web app + shared code
npm run check:functions  # type-checks the edge functions with Deno (via npx)
```

## Set it up for real

### 1. Supabase project

Create a project at supabase.com, then install the CLI and link it:

```bash
brew install supabase/tap/supabase
```

```bash
supabase login
```

```bash
supabase link --project-ref <your-project-ref>
```

```bash
supabase db push
```

### 2. Secrets and functions

Copy `supabase/functions/.env.example` to `supabase/functions/.env` and fill it in:

- `ANTHROPIC_API_KEY`: from console.anthropic.com. Each capture is one Claude Opus 5.5 call at low effort, about a cent or two per capture.
- `CAPTURE_TOKEN`: any long random string (`openssl rand -hex 24`). The Shortcut sends it.
- `APP_URL`: where the web app is hosted (step 4), no trailing slash, e.g. `https://<user>.github.io/<repo>`.

```bash
supabase secrets set --env-file supabase/functions/.env
```

```bash
supabase functions deploy capture
```

```bash
supabase functions deploy goodreads-sync
```

(`supabase/config.toml` turns off JWT checks for `capture`, since the Shortcut authenticates with `CAPTURE_TOKEN` instead.)

### 3. Your login

In the Supabase dashboard:

1. **Authentication → Users → Add user**, with your email.
2. **Authentication → Sign In / Providers → Email**: turn off *Allow new users to sign up*. Every signed-in user can see
   all data, so this keeps it yours.
3. **Authentication → URL Configuration**: set *Site URL* to your `APP_URL` and add `APP_URL/**` to *Redirect URLs*.

### 4. Host the web app (GitHub Pages)

`.github/workflows/deploy.yml` tests, builds and publishes the app to `https://<user>.github.io/<repo>/` on every push
to `main`. One-time setup (free accounts need the repo to be public; nothing secret is in it):

1. **Settings → Pages → Source:** GitHub Actions.
2. **Settings → Secrets and variables → Actions → Variables:** add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   (Project Settings → API in Supabase). Both are public by design; the database is protected by row-level security.

Because Pages can't rewrite URLs, the workflow copies `index.html` to `404.html` so links like `/confirm/<id>` still
open the app. For local development, put the same two variables in `.env.local` (see `.env.example`).

On the iPhone, open the site in Safari, sign in, and **Share → Add to Home Screen** for an app-like icon.

### 5. Goodreads

1. **Full history, once:** Goodreads → My Books → *Import and export* → *Export Library*. Upload the CSV on the Import page.
2. **Ongoing:** on the Import page, paste your Goodreads profile link and press **Sync now**. If your profile is private,
   also paste the `key=` value from any of your shelf RSS links.

Optional daily sync, run in the Supabase SQL editor (enable the `pg_cron` and `pg_net` extensions first). This puts your
service role key in the job definition, so for anything beyond a personal project store it in Vault instead:

```sql
select cron.schedule('goodreads-sync', '0 9 * * *', $$
  select net.http_post(
    url := 'https://<your-project-ref>.supabase.co/functions/v1/goodreads-sync',
    headers := jsonb_build_object('Authorization', 'Bearer <service-role-key>', 'Content-Type', 'application/json')
  );
$$);
```

### 6. The Shortcut

Follow `shortcut/README.md`.

## Not in Phase 1

- **Desktop agent** (Mac): snapshot `KoboReader.sqlite`, copy Next Up books (KEPUB) to the Kobo, drop folder → Calibre → KEPUB.
  Open question in the doc: copy directly, or run as a Calibre plugin.
- **Discover tab:** genre, minimum rating, minimum number of ratings, hide already-shelved.
- **Native share extension** (Expo), once the Shortcut flow feels right. It reuses the same `capture` function.
