import { buildShareText, normalizeGuess } from "@daily-game-lab/game-core";
import type { DailyPuzzle, GameDefinition, GuessQuality, ScoreResult } from "@daily-game-lab/game-core";
import movies from "./data/movies.json";
import movieRankings from "./data/movie-rankings.json";

type MovieEntry = {
  id: string;
  title: string;
  aliases: string[];
  year: number;
  embeddingText: string;
};

type RankedGuess = {
  rank: number;
  similarity: number;
};

type RankingIndex = {
  model: string;
  dimensions: number;
  generatedAt: string;
  itemCount: number;
  rankings: Record<string, Record<string, RankedGuess>>;
};

const movieEntries = movies as MovieEntry[];
const rankingIndex = movieRankings as RankingIndex;
const answerId = "the-matrix";
const answerMovie = movieEntries.find((movie) => movie.id === answerId);

if (!answerMovie) {
  throw new Error(`Missing movie entry for daily answer ${answerId}.`);
}

const movieLookup = new Map<string, MovieEntry>();
for (const movie of movieEntries) {
  movieLookup.set(normalizeGuess(movie.title), movie);
  movieLookup.set(movie.id, movie);

  for (const alias of movie.aliases) {
    movieLookup.set(normalizeGuess(alias), movie);
  }
}

export const popCulturePathGame: GameDefinition = {
  id: "cultural-gravity",
  name: "Cultural Gravity",
  tagline: "Find the hidden movie by its place in the culture cloud.",
  description:
    "Guess popular movies. Each known title returns only its embedding rank against today's answer: no clues, no categories, just cultural closeness.",
  puzzles: [
    {
      id: "cultural-gravity-001",
      date: "2026-05-08",
      answer: answerMovie.title,
      aliases: answerMovie.aliases,
      category: `${rankingIndex.itemCount} embedded movies`,
      difficulty: 3,
      prompt: "Guess the hidden movie. Lower ranks are closer.",
      sourceRefs: [`OpenAI ${rankingIndex.model}`, "curated movie identity cards"],
      goldenGuesses: ["Blade Runner", "Ghost in the Shell", "Inception", "John Wick"],
    },
  ],
  scoreGuess: ({ puzzle, guess }) => scoreMovieGuess(puzzle, guess),
  getShareText: ({ puzzle, history, solved }) =>
    buildShareText({ gameName: "Cultural Gravity", puzzle, history, solved }),
};

function scoreMovieGuess(puzzle: DailyPuzzle, guess: string): ScoreResult {
  const normalizedInput = normalizeGuess(guess);
  const guessedMovie = movieLookup.get(normalizedInput);

  if (!guessedMovie) {
    return {
      normalizedGuess: normalizedInput,
      isExact: false,
      similarity: 0,
      quality: "cold",
      explanation: `Not in the current ${rankingIndex.itemCount}-movie catalog yet.`,
    };
  }

  const answer = movieEntries.find((movie) => normalizeGuess(movie.title) === normalizeGuess(puzzle.answer));
  const ranking = answer ? rankingIndex.rankings[answer.id]?.[guessedMovie.id] : undefined;
  const isExact = guessedMovie.id === answer?.id;

  if (!ranking) {
    return {
      normalizedGuess: guessedMovie.id,
      isExact,
      similarity: 0,
      quality: isExact ? "exact" : "cold",
      explanation: "This movie is missing from the generated embedding rank table.",
    };
  }

  return {
    normalizedGuess: guessedMovie.id,
    isExact,
    similarity: ranking.similarity,
    rank: ranking.rank,
    quality: qualityFromRank(ranking.rank, isExact),
    explanation: isExact
      ? `Solved: ${puzzle.answer}`
      : `#${ranking.rank.toLocaleString("en-US")} of ${rankingIndex.itemCount} in the embedded movie space.`,
  };
}

function qualityFromRank(rank: number, isExact: boolean): GuessQuality {
  if (isExact) return "exact";
  if (rank <= Math.ceil(rankingIndex.itemCount * 0.12)) return "hot";
  if (rank <= Math.ceil(rankingIndex.itemCount * 0.4)) return "warm";
  return "cold";
}
