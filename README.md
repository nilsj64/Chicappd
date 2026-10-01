# Chicappd

Chicappd is a two-to-four-player online card game with a static React/Vite frontend on GitHub Pages and a Cloudflare Worker with one Durable Object per room. The Worker holds the only full game state. Each client receives a player-specific view and sends commands that the Worker validates in order. WebSockets update all clients automatically. A room code admits additional players; an unguessable temporary token identifies each seat and is saved in that browser for reloads. No account is required.

Rooms support two to four players in any mix of humans and CPU players. The room owner can add or remove CPU players in the lobby; a single human can start with CPU opponents. When no multiplayer API is configured, creating a room uses the same game model locally with CPU players.

## Local development

```bash
npm ci
npm run server:dev
```

In another terminal:

```bash
cp .env.example .env.local
# Set VITE_MULTIPLAYER_API_URL=http://localhost:8787 in .env.local
npm run dev
```

Open the Vite URL in two different browsers or browser profiles. Create a room in one, join with the five-character code in the other, or add CPU players in the lobby. For automated verification against the local Worker, run `npm run test:online`. Run `npm test`, `npm run build`, and `npm run server:check` for the other checks.

## Optional Supabase configuration

The frontend includes `@supabase/supabase-js` and a lazy, shared client in `src/supabase.ts`. The landing-page header offers optional account creation, sign-in and sign-out. Guest play never depends on an account; missing configuration leaves a useful unavailable message in the account dialog.

In `.env.local`, set `VITE_SUPABASE_URL` to your Supabase project URL and `VITE_SUPABASE_PUBLISHABLE_KEY` to its public publishable key from the project's Connect dialog / API settings. Restart Vite after changing these values. Leave either value blank to disable Supabase; malformed URLs also return `null` with a configuration warning. These are public, build-time browser values: never put a secret key or service-role credential in a `VITE_*` variable. The client uses the [official JavaScript initialization API](https://supabase.com/docs/reference/javascript/initializing).

For GitHub Pages, add repository Actions variables `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; the existing workflow passes them to Vite. Rebuild/redeploy when they change. Missing variables leave the foundation disabled.

### Username/password accounts

In Supabase **Authentication → Sign In / Providers → Email**, enable the email/password provider and **turn off Confirm email**. Allow new user signups. Set the server-side minimum password length to at least 8 characters (the app also requires 8 for signup). No SMTP or mailbox is needed. The app checks public Auth settings before signup and refuses to create an account when confirmations are enabled. Changing confirmation settings affects all email/password users in this Supabase project, so this setup assumes a project dedicated to Chicappd's mailbox-free accounts. Keep Supabase's authentication rate limits enabled.

Users enter only a username and password. Usernames are trimmed, restricted to 3–24 ASCII letters/digits/underscores (starting with a letter or digit), and lowercased. ` Alice ` and `ALICE` both resolve to `alice`. The stable internal identifier is `<canonical-username>@accounts.chicappd.invalid`; it is never shown as a user's email. The reserved `.invalid` domain cannot receive verification or recovery messages. Do not change this mapping after accounts exist.

The app uses Supabase `signUp` / `signInWithPassword`, with no custom password storage, hashing or tokens. Supabase's Auth uniqueness constraint arbitrates duplicate usernames, including concurrent signup attempts. With confirmations disabled, signup returns a session and duplicate signup returns an error. The [password-auth docs](https://supabase.com/docs/guides/auth/passwords) and [Auth configuration docs](https://supabase.com/docs/guides/auth/general-configuration) describe this behavior. Supabase's [signup implementation](https://github.com/supabase/auth/blob/master/internal/api/signup.go) confirms that auto-confirmed signup bypasses email delivery; test/example-domain restrictions on outgoing mail therefore do not apply to this flow.

Supabase persists and refreshes sessions under `chicappd-supabase-auth`; reloads restore the account. Sign-out uses local scope (this browser only) and removes that session. The displayed username is derived from the auth identifier, rather than trusting editable user metadata. This display value must never be an authorization rule: use the authenticated user's UUID for ownership.

No password recovery is available. The creation form tells users to save their password; a forgotten password cannot be recovered through this app. No email collection or profile editing is implemented. Direct Auth API clients can create identifiers outside the app's username convention; they are outside this UI's supported account flow and grant no extra data access.

No profile table is required: Supabase Auth stores the identity, and the app derives its label without another table. Multiplayer seats remain under `chicappd-online-session`, online rooms remain in Cloudflare Durable Object storage, and active local CPU rooms use React state. Completed digital rounds also have the archive described below.

### Cloud history for the physical-card scorekeeper

Physical history is the IRL match and its undo snapshot array. Signed-in users sync this same `IRLGame` JSON representation. Guests retain the existing single local match at `chicappd-irl-game` and the same undo/scorekeeping screens. A separate `chicappd-irl-game-meta` entry assigns stable UUIDs to legacy guest saves without changing their JSON format.

Apply `supabase/migrations/20261001180000_irl_history.sql` once in the project's **SQL Editor → New query → Run**. This is the first Supabase migration; the older Wrangler migration config is only for Cloudflare rooms. Future database changes belong in `supabase/migrations`. The SQL creates just `public.irl_history`, enables and forces RLS, and grants only authenticated access to that table. SELECT/INSERT/UPDATE/DELETE policies use `auth.uid() = owner_id`. Updates are limited to payload, revision and timestamp columns, so clients cannot rewrite ownership. Keep automatic table exposure disabled and RLS enabled. The explicit grants expose only this table; no anonymous grants or exposure defaults are changed. See Supabase's [RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security).

Each saved match has a stable UUID, owning auth UUID, revision UUID, payload and timestamp. The composite `(owner_id, id)` primary key prevents retry duplicates; an owner/timestamp index supports owned history. No service-role credential is used. Authorization never uses a username, internal email or editable metadata.

The shared provider restores accounts, imports guest history on sign-in **or signup**, and loads owned cloud matches. Guest data is copied, never deleted on import. A guest revision UUID is the import's deterministic record ID, and each account's local cache records successful imports only after cloud acknowledgement. Reprocessing the same revision is idempotent. A subsequently edited guest match becomes a separate preserved version rather than overwriting a diverged account match. Legacy saves have no cross-device identifier: independently copied guest saves on different browsers may import as separate matches.

Account saves are written to a separate per-user local cache before upload, debounced by 500 ms, and serialized. Cloud updates compare revision UUIDs. Concurrent edits preserve the remote match and save the local version as another match instead of overwriting it; the selector makes both accessible. Starting a new account match retains earlier matches, while the guest reset keeps its original behavior. Failed or uncertain responses retain pending local copies; retrying confirmed writes does not duplicate them. Sign-out immediately hides account history and restores the guest slot. Per-user caches remain on the device for retries; signing back in resumes that account.

Sync runs at account restoration/sign-in, after edits, when the app regains visibility/connectivity, and on **Uppdatera** / **Försök igen**. There are no history realtime subscriptions or background polling. Offline edits need a successful sync before appearing elsewhere. Cloud history is fetched in pages; complete snapshots and undo stacks are retained, so very long matches or large archives may eventually need size/retention controls. Use one active tab when working offline; simultaneous offline tabs share the same local cache.

Run `npm test`, `npm run build`, and `npm run server:check`. The explicit `npm run test:history:live` uses `.env.local`, creates two dedicated test accounts/data, verifies guest import/retries/fresh-session persistence and direct cross-user RLS queries, and leaves those accounts for inspection. It does not modify unrelated data. Regular tests never contact Supabase.

### Digital round history

The UI remains Swedish throughout; there is currently no language switch or English localization. Account controls show **Gäst** with local history, or the username with **Inloggad** and account save status. Both history views offer account controls and separate **Fysiska matcher** / **Digitala givar** navigation. Pending saves and temporary connection failures keep local results visible and offer the existing retry action. These are presentation changes only; auth and persistence behavior are unchanged.

The landing page's **Digital spelhistorik** opens a read-only archive of completed local and online rounds. Each result saves public scores, settings, hand awards and played tricks; private hands, deck order and Worker seat tokens are excluded. Active games and their controls keep their existing behavior. This is a result archive, not a way to resume unfinished local games; rounds played before this feature were only in memory and cannot be recovered.

Digital results use the same `public.irl_history` table, owning Auth UUID, composite primary key, grants and RLS policies. The original JSON constraint already supports this payload, so no additional migration is required. A `kind: "digital"` tag separates digital results from the original physical payloads, which have no kind tag. Both remote adapters filter by type before pagination.

The same `HistoryStore` implements imports, per-account caching, serialized writes, acknowledgement tracking and connectivity/visibility/manual retries for both formats. Guests use `chicappd-digital-history`; accounts use `chicappd-digital-history-<UUID>`. Sign-in/signup copies every guest result into the account without deleting the guest archive or existing cloud results. Sign-out restores the guest archive. Pending account results remain in that account's local queue when a request fails, including after a reload.

Completed results are immutable. Their record/revision UUID is derived from a SHA-256 digest of the public result, including room code and the online Worker revision. Reprocessing a result after renders, reconnection, reload or guest import produces the same ID. Identical local results in the same room (including the same dealt/played cards and scores) collapse into one entry because the existing local game has no durable round identifier. There is no realtime history subscription or cloud restoration of active games. Local archives/caches share the physical history's single-active-tab and device-storage limitations.

`npm run test:digital-history:live` uses `.env.local` and the dedicated `historya_mupp5xxm` / `historyb_mupp5xxm` test accounts left by the original live history check. It adds two digital result fixtures, checks fresh sessions/imports/retries/direct RLS queries, and asserts existing physical records stay unchanged. It does not edit or remove unrelated records. Normal unit tests cover digital captures and persistence without contacting Supabase.

## Put multiplayer online

1. Sign in to a Cloudflare account and run `npx wrangler login` on your own computer. No private key belongs in the repository. `wrangler.jsonc` already defines the Worker, SQLite-backed Durable Object binding, migration, and the allowed GitHub Pages origin (`https://nilsj64.github.io`).
2. Run `npm run server:deploy`. Copy the `https://chicappd-rooms.<your-subdomain>.workers.dev` URL printed by Wrangler.
3. In GitHub repository **Settings → Secrets and variables → Actions → Variables**, add `MULTIPLAYER_API_URL` with that HTTPS URL (no trailing slash). The Pages workflow exposes this public URL to Vite at build time. Run the **Deploy GitHub Pages** workflow or push the changes to `main`.

After changing Worker routes, deploy the Worker before using the updated Pages client. Verify that the public Worker accepts the client's leave request with `CHICAPPD_TEST_API=https://chicappd-rooms.<your-subdomain>.workers.dev npm run test:deployed-leave`.

The public Worker URL is not a credential. Room tokens are generated on the Worker and stored only in each player's browser; service credentials are never sent to GitHub Pages. If your Pages site uses a custom domain, update `FRONTEND_ORIGIN` in `wrangler.jsonc` to that site's exact origin and deploy the Worker again.

## Game rules and project layout

- `src/game.ts` owns room commands, card transitions, scoring, and filtered player views.
- `src/poker.ts` ranks five-card hands; `src/tricks.ts` enforces following suit.
- `server/worker.ts` authenticates temporary seats, persists rooms, validates commands, and broadcasts filtered views.
- `src/online.ts` handles the browser's session, API requests, and WebSocket reconnection.
- `src/App.tsx` renders the lobby and table for both online and local rooms.

Players exchange or keep cards three times. The best qualifying hand scores after exchanges one and two. Five tricks follow; the fifth trick awards five points, then the saved final hands are compared. Scores carry into “Spela en runda till”. A tie for best hand awards no poker points. The server keeps deck order, discards, and other players' hands private. Its stored room survives ordinary page reloads and Worker restarts; refreshing a browser resumes its seat using the saved token.
