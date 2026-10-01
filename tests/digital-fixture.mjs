import { createRoom, addDemoPlayer, startRound, applyCommand, viewForPlayer } from "../src/game.ts";
import { legalCards } from "../src/tricks.ts";

export function finishedDigitalRound(code = "TEST1") {
  let game = startRound(addDemoPlayer(createRoom("Digitaltest", code)));
  for (let steps = 0; steps < 300 && game.tableStage !== "result"; steps++) {
    if (game.tableStage === "exchange") {
      game = applyCommand(game, { type: "exchange", actorId: game.ownerId, discardIds: [] });
    } else if (game.waitingForNextTrick) {
      game = applyCommand(game, { type: "continue-trick", actorId: game.ownerId });
    } else if (game.activePlayerId !== game.ownerId) {
      game = applyCommand(game, { type: "advance-bot", actorId: game.ownerId });
    } else {
      const hand = game.players.find(p => p.id === game.ownerId).hand;
      const card = legalCards(hand, game.currentTrick[0]?.card.suit)[0];
      game = applyCommand(game, { type: "play-card", actorId: game.ownerId, cardId: card.id });
    }
  }
  if (game.tableStage !== "result") throw new Error("Fixture did not complete its round");
  return { game, view: viewForPlayer(game, game.ownerId) };
}
