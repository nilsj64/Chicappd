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

For GitHub Pages, add repository Actions variables `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; the existing workflow passes them to Vite. Rebuild/redeploy when they change. The Pages workflow now rejects missing account variables before publishing. The existing public deployment was built without these variables; set both and rebuild to restore its account form.

### Username/password accounts

In Supabase **Authentication → Sign In / Providers → Email**, enable the email/password provider and **turn off Confirm email**. Allow new user signups. Set the server-side minimum password length to at least 8 characters (the app also requires 8 for signup). No SMTP or mailbox is needed. The app checks public Auth settings before signup and refuses to create an account when confirmations are enabled. Changing confirmation settings affects all email/password users in this Supabase project, so this setup assumes a project dedicated to Chicappd's mailbox-free accounts. Keep Supabase's authentication rate limits enabled.

Users enter only a username and password. Usernames are trimmed, restricted to 3–24 ASCII letters/digits/underscores (starting with a letter or digit), and lowercased. ` Alice ` and `ALICE` both resolve to `alice`. The stable internal identifier is `<canonical-username>@accounts.chicappd.invalid`; it is never shown as a user's email. The reserved `.invalid` domain cannot receive verification or recovery messages. Do not change this mapping after accounts exist.

The app uses Supabase `signUp` / `signInWithPassword`, with no custom password storage, hashing or tokens. Supabase's Auth uniqueness constraint arbitrates duplicate usernames, including concurrent signup attempts. With confirmations disabled, signup returns a session and duplicate signup returns an error. The [password-auth docs](https://supabase.com/docs/guides/auth/passwords) and [Auth configuration docs](https://supabase.com/docs/guides/auth/general-configuration) describe this behavior. Supabase's [signup implementation](https://github.com/supabase/auth/blob/master/internal/api/signup.go) confirms that auto-confirmed signup bypasses email delivery; test/example-domain restrictions on outgoing mail therefore do not apply to this flow.

Supabase persists and refreshes sessions under `chicappd-supabase-auth`; reloads restore the account. Sign-out uses local scope (this browser only) and removes that session. The displayed username is derived from the auth identifier, rather than trusting editable user metadata. This display value must never be an authorization rule: use the authenticated user's UUID for ownership.

No password recovery is available. The creation form tells users to save their password; a forgotten password cannot be recovered through this app. No email collection or profile editing is implemented. Direct Auth API clients can create identifiers outside the app's username convention; they are outside this UI's supported account flow and grant no extra data access.

No profile table is required: Supabase Auth stores the identity, and the app derives its label without another table. The signed-in status shows the account creation date from Auth `user.created_at`, formatted with the selected locale (Swedish or British English). Editable user metadata is not used for this date. Digital create/join forms automatically use the authenticated username; guest and opponent names retain their existing flow. Worker names accept all 24 characters allowed by accounts; guest forms still use the existing 20-character limit. Multiplayer seats remain under `chicappd-online-session`, online rooms remain in Cloudflare Durable Object storage, and active local CPU rooms use React state. Completed digital rounds also have the archive described below.

### Cloud history for the physical-card scorekeeper

Physical history is the IRL match and its undo snapshot array. Signed-in users sync this same `IRLGame` JSON representation. Guests retain the existing single local match at `chicappd-irl-game` and the same undo/scorekeeping screens. A separate `chicappd-irl-game-meta` entry assigns stable UUIDs to legacy guest saves without changing their JSON format.

Apply `supabase/migrations/20261001180000_irl_history.sql` once in the project's **SQL Editor → New query → Run**. This is the first Supabase migration; the older Wrangler migration config is only for Cloudflare rooms. Future database changes belong in `supabase/migrations`. The SQL creates just `public.irl_history`, enables and forces RLS, and grants only authenticated access to that table. SELECT/INSERT/UPDATE/DELETE policies use `auth.uid() = owner_id`. Updates are limited to payload, revision and timestamp columns, so clients cannot rewrite ownership. Keep automatic table exposure disabled and RLS enabled. The explicit grants expose only this table; no anonymous grants or exposure defaults are changed. See Supabase's [RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security).

Each saved match has a stable UUID, owning auth UUID, revision UUID, payload and timestamp. The composite `(owner_id, id)` primary key prevents retry duplicates; an owner/timestamp index supports owned history. No service-role credential is used. Authorization never uses a username, internal email or editable metadata.

The shared provider restores accounts, imports guest history on sign-in **or signup**, and loads owned cloud matches. Guest data is copied, never deleted on import. A guest revision UUID is the import's deterministic record ID, and each account's local cache records successful imports only after cloud acknowledgement. Reprocessing the same revision is idempotent. A subsequently edited guest match becomes a separate preserved version rather than overwriting a diverged account match. Legacy saves have no cross-device identifier: independently copied guest saves on different browsers may import as separate matches.

Account saves are written to a separate per-user local cache before upload, debounced by 500 ms, and serialized. Cloud updates compare revision UUIDs. Concurrent edits preserve the remote match and save the local version as another match instead of overwriting it; the selector makes both accessible. Starting a new account match retains earlier matches, while the guest reset keeps its original behavior. Failed or uncertain responses retain pending local copies; retrying confirmed writes does not duplicate them. Sign-out immediately hides account history and restores the guest slot. Per-user caches remain on the device for retries; signing back in resumes that account.

Sync runs at account restoration/sign-in, after edits, when the app regains visibility/connectivity, and on **Uppdatera** / **Försök igen**. There are no history realtime subscriptions or background polling. Offline edits need a successful sync before appearing elsewhere. Cloud history is fetched in pages; complete snapshots and undo stacks are retained, so very long matches or large archives may eventually need size/retention controls. Use one active tab when working offline; simultaneous offline tabs share the same local cache.

Run `npm test`, `npm run build`, and `npm run server:check`. The explicit `npm run test:history:live` uses `.env.local`, creates two dedicated test accounts/data, verifies guest import/retries/fresh-session persistence and direct cross-user RLS queries, and leaves those accounts for inspection. It does not modify unrelated data. Regular tests never contact Supabase.

### Digital player statistics

The digital view is a compact cumulative player profile, with games played, wins, losses, win percentage, current/longest streak, best/average score, best hand and Royal Flush count. Expandable hand counts include all nine evaluator categories, with Royal Flushes counted separately. Physical-card history and its sync engine are unchanged.

Games, wins and losses count **decided matches**, according to the existing Chicago/score winner rule or the new immediate Royal Flush rule. A finished deal with no match winner (including tied eligible scores) is not forced into a win, loss or draw: play continues. Score statistics use the local player's cumulative score at the end of each completed deal; hand counts use one final hand per completed deal, while best hand considers initial and intermediate scoring evaluations as well. Streaks follow completed match outcomes in result timestamp order. The UI explains the difference between matches and deals.

Results remain internal immutable JSON records in the existing `irl_history` table, filtered by `game.kind = digital`; no SQL migration or RLS change is needed. New payloads add the player's seat ID, match UUID, deal number, explicit match winner and evaluator outputs. Result UUIDs derive from source/match/deal/seat, so replaying a result or changing a room revision does not duplicate it. Per-user caches, guest backups, guest imports, failed-sync retry queues, paging and owner UUID authorization reuse the existing history engine. No valid historical results are deleted or rewritten.

Older final hands can be reconstructed from the five public trick records using the existing evaluator. Old local results use the original first seat as the local player; old online results count only when the account username identifies one unique seat. Unidentifiable online records remain stored, are excluded from personal aggregates, and are explained in the UI. Initial/intermediate hands discarded by the old payload cannot be recovered, so their best-hand baseline uses the final hand. Historical incomplete matches do not increase games played.

A true Royal Flush is an evaluated ace-high Straight Flush: 10/J/Q/K/A in one suit. It ends the game immediately on dealing or an accepted/replacement exchange, before the next seat acts. It uses the existing 8 poker points and score-reset setting, and its explicit winner bypasses Chicago eligibility even if the optional score reset returns that score to zero. Ordinary Straight Flushes retain their existing behavior. Result UI, podium and persistence use the same winner. Both initial dealing and shared online authority run this logic; deploy the Worker together with the frontend.

Run `npm run test:digital-history:live` to check guest merge, aggregate restoration, repeat sign-in, failed-sync recovery and cross-user RLS using dedicated test accounts. Regular automated tests include Royal Flush detection/instant wins and cumulative statistics. Live fixtures remain on dedicated test accounts for inspection.

### Language

Swedish is the default. The small **Språk / Language** selector above the app switches every view between Swedish and English. The choice is saved locally under `chicappd-language`, independently of accounts; document language/title, dates, card descriptions, advice and history summaries follow the selection.

`src/translations.ts` is the typed copy catalog. Swedish source phrases serve as stable keys, with natural English translations and optional improved Swedish wording. Use `useI18n().t(key, values)` for UI copy and indexed `{0}` placeholders for dynamic values. `src/locale.ts` translates known canonical game/Worker messages at the display boundary, including older saved summaries, without rewriting history or translating player names. New generated message formats should be added there with focused tests. Brand names, player/user names, room codes and printed card symbols remain unchanged. Language names are shown in their own languages. No translation dependency, schema or persistence changes are needed. `tests/locale.test.mjs` and `tests/localized-ui.test.mjs` cover choice persistence, messages, advice and representative real views in both languages.

The landing page's **Digital spelarstatistik** opens the cumulative profile described above. Active games cannot be restored from statistics; only completed results are retained. Results before digital persistence existed were only in memory and cannot be recovered. There are no realtime history subscriptions. Local archives/caches retain the existing single-active-tab and device-storage limitations.

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
