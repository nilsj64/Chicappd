# Frontend performance audit — 1 October 2026

Measured the existing production configuration, with accounts and online play enabled. No new dependencies, Vite manual chunk rules, or warning-limit changes.

## Findings and changes

The original entry eagerly included the full Supabase SDK, digital table/controller, game engine/CPU, physical scorekeeper and statistics. Rollup's pre-minification module contributions were led by React DOM (645 kB), Supabase Auth's GoTrueClient (272 kB), Supabase Storage (113 kB), PostgREST (111 kB), and App.tsx (82 kB). These are attribution values, not compressed download sizes. No duplicated production package versions, Worker code, development React, or test code were found in the emitted client bundle. Extraneous installed packages were not bundled.

Vite already supports dynamic imports, dependency preloading, shared chunks and content-hashed assets. The changes use those defaults:

- Extract the existing landing JSX into `Landing.tsx`; keep it and the lightweight account controls eager.
- Move the existing entry/lobby/table/controller unchanged into `DigitalGame.tsx`, loaded on digital entry or saved online-seat restoration. Lazily load `IRLTable` and `DigitalHistoryPanel` at their feature boundaries.
- Load Supabase asynchronously after the shell mounts, sharing one initialization promise. Start session restoration automatically; disable account actions/game submission until auth resolves. The same SDK, session key, refresh behavior, subscription cleanup and sync stores remain in use. Unconfigured builds never request the SDK.
- Move the existing three-line `digitalMatchWinnerId` helper into `scoring.ts` and re-export it from `game.ts`. History no longer pulls the whole game engine/CPU into the shell through that helper. Its implementation/rules are unchanged.
- Use React transitions to keep the previous view interactive during feature loading, with the existing fixed status notice. Saved-room startup uses the existing brand/card/status styles. No CSS changes; no interim blank screen or loading-induced shift of the current page.

Account/history stores remain mounted above all feature boundaries, so navigation does not recreate subscriptions, reset caches, or interrupt sync. No gameplay, Worker protocol, persistence format, localization catalog, or rules changed.

## Production bundle metrics

Decimal kB; gzip measured from the emitted files.

| JavaScript | Before raw / gzip | After raw / gzip |
| --- | ---: | ---: |
| Initial entry | 606.61 / 174.55 kB | 307.09 / 95.57 kB |
| Supabase, automatic background import when configured | In entry | 228.24 / 59.95 kB |
| Digital game, including engine/CPU | In entry | 58.39 / 17.83 kB |
| Physical scorekeeper | In entry | 17.22 / 5.44 kB |
| Statistics view | In entry | 2.91 / 1.33 kB |
| Shared podium (automatic Rollup chunk) | In entry | 0.50 / 0.33 kB |
| Entry + configured background SDK | 606.61 / 174.55 kB | 535.33 / 155.52 kB |
| All feature chunks combined | 606.61 / 174.55 kB | 614.36 / 180.45 kB |

The entry reduction is **299.52 kB (49.4%) raw / 78.98 kB (45.2%) gzip**. Configured startup still downloads the SDK, but after the landing can render; combined shell/SDK transfer is 10.9% smaller gzipped. Total bytes across every feature increase slightly (1.3% raw / 3.4% gzip) because of chunk boundaries and imports. This is deferral of unnecessary first-load work, not removal of functionality or a claim of a smaller entire app.

CSS is byte-identical at 43.98 kB / 10.49 kB gzip. The original >500 kB Vite warning is gone: the largest chunk is now 307.09 kB. No threshold was raised. No manually separated vendor chunks were needed.

## Browser measurements and UX

Headless installed Chrome, production preview under `/Chicappd/`, fresh browser context per run, 100 ms network latency, 200,000 bytes/s download (1.6 Mbps), 100,000 bytes/s upload and 4× CPU slowdown. Five cold runs per variant on the same machine. Values are lab medians, not production RUM or Lighthouse scores.

| Measurement | Before | After |
| --- | ---: | ---: |
| Landing create button visible/available | 1,309 ms | 897 ms |
| First contentful paint | 1,292 ms | 884 ms |
| Landing with 250 saved digital results (~716 kB local cache) | 1,326 ms | 889 ms |

Landing availability improves by **412 ms (31.5%)**. The populated-cache baseline had a 51–65 ms startup long task in each run; none of the corresponding after runs had tasks above 50 ms. Empty-cache baseline had one 66 ms task in five runs; after had none. The synchronous cache restoration is not the dominant bottleneck at this sample size, so it was left intact.

There is a tradeoff: in a separate same-throttle five-run check, account actions became available at median 1.58 s versus 1.33 s before, because SDK download now follows shell rendering. Opening the digital entry after account readiness takes ~388 ms cold versus ~66 ms when it was eager (click/dispatch and render included, detected with animation-frame DOM polling). The landing remains usable during that fetch; cached feature opens reuse the loaded module. Account-dependent actions still await restoration, avoiding guest/account identity races. Do not interpret earlier landing availability as earlier authenticated-game submission.

A separate three-run feature-open check under the same throttle measured median click-to-view times of 445 ms for digital entry, 284 ms for physical setup, and 237 ms for statistics. The previous page remains visible and interactive throughout.

Verified a deliberately held physical-feature request: the landing button bounds remain identical during loading and language switching still works. Desktop (1440 px) and mobile (390 px) settled landing screenshots are pixel-identical to the baseline.

## Validation

- `npm test`: **163/163 pass**, including account, persistence/sync, localized real UI, digital statistics, physical history, CPU/exchange behavior, Chicago/Royal Flush/scoring and six-player rules. Adapted component-load tests to the moved file and Supabase tests to the async API; verified concurrent callers share initialization.
- `npm run build`: passes; no size warning.
- `npm run server:check`: TypeScript and Wrangler deploy dry-run pass.
- Local `npm run server:dev` + `npm run test:online`: **15/15 pass**, including complete 4/5/6-human rounds, WebSocket updates, CPU alarms and room/session rules.
- Production-browser smoke: landing; guest account dialog; six-player physical match setup/scoring; reload persistence; physical history/statistics navigation; local digital game with CPU; Swedish/English changes.
- Production-browser account check with isolated synthetic stored session and mocked Supabase transport: deferred SDK restores identity, game entry uses authenticated username, sign-out works, sign-in/signup form opens. Real cloud login/writes were not performed by this audit.
- Production-browser online check against the local Worker: create room, reload saved seat, add CPU, start game, switch language, leave; no console, dynamic-import or runtime errors. This used a production build with the API pointed at localhost.

## Reproduce and remaining bottlenecks

Run `npm run build` and `node scripts/analyze-bundle.mjs`. The analyzer uses Vite/Rollup's final output and built-in gzip, writes no artifacts, and reports chunk sizes, imports and largest rendered modules. Run the above test/check commands. For production preview use `npm run preview -- --base /Chicappd/`: the development command normally selects `/`, while the emitted build selects `/Chicappd/`.

React DOM and the shared localization/history shell remain the largest first-render work. The configured SDK is the largest background payload and now gates account readiness; that is the next measured tradeoff to investigate if account entry becomes the priority. External Google Fonts CSS remains render-blocking (roughly 0.35–0.50 s resource duration here), but did not dominate the baseline JS download (~1.05 s). Arbitrarily large history/undo archives can still grow synchronous storage and sync costs; the 250-result check does not establish an upper bound. No speculative renderer, font, SDK replacement or history refactor was included.
