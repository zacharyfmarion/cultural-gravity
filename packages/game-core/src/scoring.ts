import type { DailyPuzzle, GuessQuality, GuessRecord, ScoreResult } from "./types";

export function normalizeGuess(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ");
}

export function isAcceptedAnswer(puzzle: DailyPuzzle, normalizedGuess: string): boolean {
  const accepted = [puzzle.answer, ...puzzle.aliases].map(normalizeGuess);
  return accepted.includes(normalizedGuess);
}

export function qualityFromSimilarity(similarity: number, isExact: boolean): GuessQuality {
  if (isExact) return "exact";
  if (similarity >= 0.72) return "hot";
  if (similarity >= 0.42) return "warm";
  return "cold";
}

export function lexicalSimilarity(a: string, b: string): number {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (left.size === 0 || right.size === 0) return 0;

  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

export function scoreByKeywordMap(input: {
  puzzle: DailyPuzzle;
  guess: string;
  history: GuessRecord[];
  keywordScores: Record<string, number>;
  fallbackExplanation: string;
}): ScoreResult {
  const normalizedGuess = normalizeGuess(input.guess);
  const isExact = isAcceptedAnswer(input.puzzle, normalizedGuess);
  const directScore = input.keywordScores[normalizedGuess] ?? 0;
  const aliasScore = Math.max(
    ...Object.keys(input.keywordScores).map((keyword) => lexicalSimilarity(normalizedGuess, keyword)),
    0,
  );
  const similarity = isExact ? 1 : Math.max(directScore, aliasScore * 0.65);

  return {
    normalizedGuess,
    isExact,
    similarity,
    rank: Math.max(1, Math.round((1 - similarity) * 1000)),
    quality: qualityFromSimilarity(similarity, isExact),
    explanation: isExact
      ? `Solved: ${input.puzzle.answer}`
      : input.keywordScores[normalizedGuess] !== undefined
        ? "This guess is in the prototype's curated neighborhood."
        : input.fallbackExplanation,
  };
}

export function buildShareText(input: {
  gameName: string;
  puzzle: DailyPuzzle;
  history: GuessRecord[];
  solved: boolean;
}): string {
  const marks = input.history
    .map((guess) => {
      if (guess.quality === "exact") return "G";
      if (guess.quality === "hot") return "H";
      if (guess.quality === "warm") return "W";
      return "C";
    })
    .join("");

  return [
    `${input.gameName} ${input.puzzle.id}`,
    input.solved ? `Solved in ${input.history.length}` : `Unsolved after ${input.history.length}`,
    marks,
    "Daily Game Lab",
  ].join("\n");
}

function tokenize(value: string): string[] {
  return normalizeGuess(value)
    .split(/[\s-]/)
    .filter((token) => token.length > 1);
}
