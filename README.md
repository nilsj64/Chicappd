# Chicago

A small browser foundation for a private Chicago card game. The current build is a **local preview**: room codes, other players, dealing, and scores are mock state in one browser tab. It does not connect players online yet.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`). Use **Skapa spel** or **Gå med i spel**, add demo players if needed, then open the table. Your current combination is visible immediately. Exchange selected cards or keep all five; repeat for three exchanges. The first hand comparison happens after exchange 1. The best qualifying hand scores after exchanges 1 and 2. After exchange 3, the final hands stay hidden while five tricks are played. Players must follow the led suit when able, and the winner leads the next trick. The last trick gives its winner 5 points, then the saved final hands are compared and scored in the round summary. Returning to the lobby and entering the table again starts a fresh practice deal.

Run `npm test` (Node.js 22.6+ with TypeScript type stripping) for poker ranking, exchanges, and trick-play checks.

## Project shape

- `src/game.ts` — authoritative cards, players, room commands, game transitions, and per-player views.
- `src/poker.ts` — five-card evaluation, Swedish combination labels, and tie-breaking comparisons.
- `src/bot.ts` — pure, simple discard decisions for demo players.
- `src/tricks.ts` — follow-suit legality and no-trump trick winner rules.
- `src/App.tsx` — landing, room entry, lobby, table, and card UI.
- `src/styles.css` — visual design and responsive layout.

Hand points use the basic 1–8 scale: pair 1, two pair 2, three of a kind 3, straight 4, flush 5, full house 6, four of a kind 7, and straight flush 8. High card scores 0; an exact tie for the best hand awards no points. Tricks 1–4 score 0 and the last trick scores 5, with no two-card bonus. Exchanges use one shared deck and discard pile; earlier discards are shuffled back into the deck if it runs out. Chicago declarations and networking are not implemented.

The local preview uses `applyCommand` for shared game actions and `viewForPlayer` for rendering. Human and bot seats are explicit, and each human exchange is recorded separately. The full authority still lives in the browser for this preview; moving it to a trusted room host and binding commands to authenticated connections belongs to the networking step.
