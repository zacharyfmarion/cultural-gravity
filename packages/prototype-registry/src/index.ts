import { popCulturePathGame } from "@daily-game-lab/prototype-pop-culture-path";
import type { GameDefinition } from "@daily-game-lab/game-core";

export const allGames: GameDefinition[] = [popCulturePathGame];

export function getGame(gameId: string): GameDefinition | undefined {
  return allGames.find((game) => game.id === gameId);
}
