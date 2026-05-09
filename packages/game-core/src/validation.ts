import { normalizeGuess } from "./scoring";
import type { DailyPuzzle, PuzzleValidationIssue } from "./types";

export function validatePuzzle(puzzle: DailyPuzzle): PuzzleValidationIssue[] {
  const issues: PuzzleValidationIssue[] = [];
  const normalizedAnswer = normalizeGuess(puzzle.answer);

  if (!puzzle.id) {
    issues.push(error("missing-id", "Puzzle is missing an id."));
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(puzzle.date)) {
    issues.push(error("bad-date", `Puzzle ${puzzle.id} has an invalid date.`));
  }

  if (!normalizedAnswer) {
    issues.push(error("missing-answer", `Puzzle ${puzzle.id} is missing an answer.`));
  }

  if (puzzle.goldenGuesses.length < 3) {
    issues.push(warning("thin-golden-set", `Puzzle ${puzzle.id} should have at least 3 golden guesses.`));
  }

  if (puzzle.sourceRefs.length === 0) {
    issues.push(warning("missing-sources", `Puzzle ${puzzle.id} has no source references.`));
  }

  const aliases = new Set(puzzle.aliases.map(normalizeGuess));
  if (aliases.has(normalizedAnswer)) {
    issues.push(warning("duplicate-alias", `Puzzle ${puzzle.id} repeats the answer in aliases.`));
  }

  return issues;
}

export function validatePuzzleSet(puzzles: DailyPuzzle[]): PuzzleValidationIssue[] {
  const issues = puzzles.flatMap(validatePuzzle);
  const seen = new Map<string, string>();

  for (const puzzle of puzzles) {
    const answer = normalizeGuess(puzzle.answer);
    const duplicate = seen.get(answer);
    if (duplicate) {
      issues.push(error("duplicate-answer", `Puzzles ${duplicate} and ${puzzle.id} share answer "${puzzle.answer}".`));
    }
    seen.set(answer, puzzle.id);
  }

  return issues;
}

function error(code: string, message: string): PuzzleValidationIssue {
  return { severity: "error", code, message };
}

function warning(code: string, message: string): PuzzleValidationIssue {
  return { severity: "warning", code, message };
}
