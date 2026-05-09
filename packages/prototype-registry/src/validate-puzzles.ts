import { validatePuzzleSet } from "@daily-game-lab/game-core";
import { allGames } from "./index";

const issues = allGames.flatMap((game) =>
  validatePuzzleSet(game.puzzles).map((issue) => ({
    ...issue,
    gameId: game.id,
  })),
);

for (const issue of issues) {
  const label = issue.severity.toUpperCase();
  console.log(`[${label}] ${issue.gameId}:${issue.code} ${issue.message}`);
}

if (issues.some((issue) => issue.severity === "error")) {
  process.exit(1);
}
