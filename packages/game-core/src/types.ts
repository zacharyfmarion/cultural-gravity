export type GuessQuality = "cold" | "warm" | "hot" | "exact";

export type ScoreResult = {
  normalizedGuess: string;
  isExact: boolean;
  quality: GuessQuality;
  rank?: number;
  similarity?: number;
  distance?: number;
  explanation: string;
};

export type GuessRecord = ScoreResult & {
  rawGuess: string;
  submittedAt: string;
};

export type PuzzleValidationIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type DailyPuzzle = {
  id: string;
  date: string;
  answer: string;
  aliases: string[];
  category: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  prompt: string;
  sourceRefs: string[];
  goldenGuesses: string[];
};

export type GameDefinition = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  maxGuesses?: number;
  puzzles: DailyPuzzle[];
  scoreGuess: (input: {
    puzzle: DailyPuzzle;
    guess: string;
    history: GuessRecord[];
  }) => ScoreResult;
  getShareText: (input: {
    puzzle: DailyPuzzle;
    history: GuessRecord[];
    solved: boolean;
  }) => string;
};
