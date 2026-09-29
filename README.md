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
