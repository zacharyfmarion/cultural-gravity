import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Flag, Lightbulb, Orbit, RotateCcw, Share2 } from "lucide-react";
import "./styles.css";

type MovieId = string | number;

type MovieTuple = [MovieId, string, number | null, string[]];

type Movie = {
  id: string;
  title: string;
  year: number | null;
  aliases: string[];
};

type MovieLookupData = {
  schemaVersion: number;
  generatedAt: string;
  catalogSource: string;
  model: string;
  dimensions: number;
  itemCount: number;
  movies: MovieTuple[];
};

type LatestData = {
  schemaVersion: number;
  date: string;
  path: string;
};

type DailyData = {
  schemaVersion: number;
  date: string;
  generatedAt: string;
  model: string;
  dimensions: number;
  answerId: MovieId;
  catalogSize: number;
  rankedIds: MovieId[];
};

type GameData = {
  lookup: MovieLookupData;
  daily: DailyData;
  moviesById: Map<string, Movie>;
  guessesByName: Map<string, string>;
  rankById: Map<string, number>;
};

type GuessQuality = "cold" | "warm" | "hot" | "exact";

type GuessRecord = {
  movieId?: string;
  rawGuess: string;
  normalizedGuess: string;
  isExact: boolean;
  quality: GuessQuality;
  rank?: number;
  submittedAt: string;
  explanation: string;
};

const root = createRoot(document.getElementById("root") as HTMLElement);

root.render(
  <StrictMode>
    <Arcade />
  </StrictMode>,
);

function Arcade() {
  const { data, error, loading } = useGameData();

  return (
    <main className="app-shell">
      <aside className="game-rail" aria-label="Game information">
        <div className="brand">
          <Orbit aria-hidden="true" />
          <span>Cultural Gravity</span>
        </div>
        <div className="game-note">
          <strong>Rank first.</strong>
          <span>Optional hints and give up are available when you want to inspect the embedding neighborhood.</span>
        </div>
      </aside>
      {loading ? <StatusSurface title="Loading the culture cloud" /> : null}
      {error ? <StatusSurface title="Could not load game data" detail={error} /> : null}
      {data ? <GameSurface data={data} /> : null}
    </main>
  );
}

function GameSurface({ data }: { data: GameData }) {
  const answer = data.moviesById.get(String(data.daily.answerId));
  const storageKey = `cultural-gravity:${data.daily.date}:${data.daily.answerId}`;
  const [guess, setGuess] = useState("");
  const [history, setHistory] = useStoredHistory(storageKey);
  const [hintCount, setHintCount] = useStoredNumber(`${storageKey}:hints`, 0);
  const [gaveUp, setGaveUp] = useStoredBoolean(`${storageKey}:gave-up`, false);
  const solved = history.some((record) => record.isExact);
  const locked = solved || gaveUp;
  const hintMovies = useMemo(() => getHintMovies(data, history, hintCount), [data, history, hintCount]);
  const sortedHistory = useMemo(
    () => [...history].sort((left, right) => Number(left.rank ?? Infinity) - Number(right.rank ?? Infinity)),
    [history],
  );

  function submitGuess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || guess.trim().length === 0) return;

    const result = scoreGuess(guess, data);
    if (history.some((record) => record.normalizedGuess === result.normalizedGuess)) {
      setGuess("");
      return;
    }

    setHistory([
      ...history,
      {
        ...result,
        rawGuess: guess.trim(),
        submittedAt: new Date().toISOString(),
      },
    ]);
    setGuess("");
  }

  function useHint() {
    if (solved) return;
    setHintCount(Math.min(hintCount + 1, 5));
  }

  function giveUp() {
    setGaveUp(true);
  }

  function resetToday() {
    setHistory([]);
    setHintCount(0);
    setGaveUp(false);
  }

  async function shareResult() {
    const marks = history
      .map((record) => {
        if (record.quality === "exact") return "G";
        if (record.quality === "hot") return "H";
        if (record.quality === "warm") return "W";
        return "C";
      })
      .join("");
    const text = [
      `Cultural Gravity ${data.daily.date}`,
      solved ? `Solved in ${history.length}` : gaveUp && answer ? `Gave up: ${answer.title}` : `${history.length} guesses`,
      marks,
      window.location.href,
    ].join("\n");
    await navigator.clipboard.writeText(text);
  }

  return (
    <section className="game-surface">
      <header className="play-header">
        <div>
          <p className="eyebrow">{data.lookup.itemCount.toLocaleString("en-US")} modern popular movies</p>
          <h1>Cultural Gravity</h1>
          <p>
            Guess modern popular movies. Each known title returns only its rank against today's hidden answer:
            no clues, no categories, just cultural closeness.
          </p>
        </div>
        <div className="score-strip" aria-label="Current score">
          <span>{history.length}</span>
          <small>guesses</small>
        </div>
      </header>

      <section className="puzzle-band" aria-label="Current puzzle">
        <div>
          <span className="date-chip">{data.daily.date}</span>
          <h2>
            {(solved || gaveUp) && answer
              ? `Answer: ${answer.title}${answer.year ? ` (${answer.year})` : ""}`
              : "Guess the hidden movie. Lower ranks are closer."}
          </h2>
        </div>
        <div className={solved ? "status-pill solved" : gaveUp ? "status-pill ended" : "status-pill"}>
          {solved ? "Solved" : gaveUp ? "Revealed" : "Live"}
        </div>
      </section>

      <form className="guess-form" onSubmit={submitGuess}>
        <input
          aria-label="Guess"
          autoComplete="off"
          disabled={locked}
          onChange={(event) => setGuess(event.target.value)}
          placeholder={locked && answer ? answer.title : "Type a movie title"}
          value={guess}
        />
        <button disabled={locked || guess.trim().length === 0} type="submit">
          Guess
        </button>
      </form>

      <div className="tool-row">
        <button className="icon-button" onClick={shareResult} title="Copy share text" type="button">
          <Share2 aria-hidden="true" />
          <span>Share</span>
        </button>
        <button
          className="icon-button"
          disabled={hintCount >= 5 || solved}
          onClick={useHint}
          title="Reveal a nearby movie"
          type="button"
        >
          <Lightbulb aria-hidden="true" />
          <span>Hint</span>
        </button>
        <button className="icon-button danger" disabled={locked} onClick={giveUp} title="Reveal the answer" type="button">
          <Flag aria-hidden="true" />
          <span>Give up</span>
        </button>
        <button className="icon-button" onClick={resetToday} title="Reset today's state" type="button">
          <RotateCcw aria-hidden="true" />
          <span>Reset</span>
        </button>
      </div>

      {hintMovies.length > 0 ? (
        <section className="hint-panel" aria-label="Hints">
          <strong>Closest unguessed neighbors</strong>
          <div className="hint-list">
            {hintMovies.map((movie) => (
              <span className="hint-chip" key={movie.id}>
                #{data.rankById.get(movie.id)} {movie.title}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="history" aria-label="Guess history">
        {history.length === 0 ? (
          <div className="empty-state">
            <strong>Find the hidden movie by its place in the culture cloud.</strong>
            <span>Start with a famous movie, then chase lower ranks.</span>
          </div>
        ) : (
          sortedHistory.map((record) => (
            <article className={`guess-row ${record.quality}`} key={record.normalizedGuess}>
              <div>
                <strong>{record.rawGuess}</strong>
                <span>{record.explanation}</span>
              </div>
              <output>{record.rank ? `#${record.rank.toLocaleString("en-US")}` : "-"}</output>
            </article>
          ))
        )}
      </section>
    </section>
  );
}

function StatusSurface({ title, detail }: { title: string; detail?: string }) {
  return (
    <section className="game-surface">
      <div className="empty-state">
        <strong>{title}</strong>
        {detail ? <span>{detail}</span> : <span>One moment.</span>}
      </div>
    </section>
  );
}

function useGameData() {
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const lookup = await fetchJson<MovieLookupData>("data/movie-lookup.json");
        const latest = await fetchJson<LatestData>("data/daily/latest.json");
        const daily = await fetchJson<DailyData>(latest.path);
        const gameData = buildGameData(lookup, daily);

        if (!cancelled) {
          setData(gameData);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, error, loading };
}

async function fetchJson<T>(relativePath: string): Promise<T> {
  const response = await fetch(dataUrl(relativePath));
  if (!response.ok) {
    throw new Error(`Failed to load ${relativePath}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function dataUrl(relativePath: string): string {
  const base = import.meta.env.BASE_URL;
  return new URL(relativePath.replace(/^\//, ""), window.location.origin + base).toString();
}

function buildGameData(lookup: MovieLookupData, daily: DailyData): GameData {
  const moviesById = new Map<string, Movie>();
  const guessesByName = new Map<string, string>();
  const rankById = new Map<string, number>();

  for (const [id, title, year, aliases] of lookup.movies) {
    const movie = {
      id: String(id),
      title,
      year,
      aliases: aliases ?? [],
    };
    moviesById.set(movie.id, movie);
    addGuessName(guessesByName, title, movie.id);

    for (const alias of movie.aliases) {
      addGuessName(guessesByName, alias, movie.id);
    }
  }

  daily.rankedIds.forEach((id, index) => {
    rankById.set(String(id), index + 1);
  });

  return {
    lookup,
    daily,
    moviesById,
    guessesByName,
    rankById,
  };
}

function addGuessName(guessesByName: Map<string, string>, name: string, movieId: string) {
  const normalized = normalizeGuess(name);
  if (!guessesByName.has(normalized)) {
    guessesByName.set(normalized, movieId);
  }
}

function scoreGuess(rawGuess: string, data: GameData): Omit<GuessRecord, "rawGuess" | "submittedAt"> {
  const normalizedGuess = normalizeGuess(rawGuess);
  const movieId = data.guessesByName.get(normalizedGuess);

  if (!movieId) {
    return {
      normalizedGuess,
      isExact: false,
      quality: "cold",
      explanation: `Not in the current ${data.lookup.itemCount.toLocaleString("en-US")}-movie catalog yet.`,
    };
  }

  const rank = data.rankById.get(movieId);
  const isExact = movieId === String(data.daily.answerId);

  return {
    movieId,
    normalizedGuess: movieId,
    isExact,
    rank,
    quality: qualityFromRank(rank, data.lookup.itemCount, isExact),
    explanation: isExact
      ? "Solved."
      : rank
        ? `#${rank.toLocaleString("en-US")} of ${data.lookup.itemCount.toLocaleString("en-US")} in the embedded movie space.`
        : "This movie is missing from today's rank table.",
  };
}

function getHintMovies(data: GameData, history: GuessRecord[], hintCount: number): Movie[] {
  if (hintCount <= 0) return [];

  const guessedIds = new Set(history.map((record) => record.movieId).filter(Boolean));
  const hints: Movie[] = [];

  for (const id of data.daily.rankedIds) {
    const movieId = String(id);
    if (movieId === String(data.daily.answerId) || guessedIds.has(movieId)) continue;

    const movie = data.moviesById.get(movieId);
    if (movie) {
      hints.push(movie);
    }

    if (hints.length >= hintCount) break;
  }

  return hints;
}

function qualityFromRank(rank: number | undefined, itemCount: number, isExact: boolean): GuessQuality {
  if (isExact) return "exact";
  if (!rank) return "cold";
  if (rank <= Math.ceil(itemCount * 0.02)) return "hot";
  if (rank <= Math.ceil(itemCount * 0.15)) return "warm";
  return "cold";
}

function normalizeGuess(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ");
}

function useStoredHistory(key: string): [GuessRecord[], (next: GuessRecord[]) => void] {
  const [history, setHistoryState] = useState<GuessRecord[]>(() => {
    const rawValue = localStorage.getItem(key);
    return rawValue ? (JSON.parse(rawValue) as GuessRecord[]) : [];
  });

  useEffect(() => {
    const rawValue = localStorage.getItem(key);
    setHistoryState(rawValue ? (JSON.parse(rawValue) as GuessRecord[]) : []);
  }, [key]);

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(history));
  }, [history, key]);

  return [history, setHistoryState];
}

function useStoredNumber(key: string, fallback: number): [number, (next: number) => void] {
  const [value, setValueState] = useState(() => {
    const rawValue = localStorage.getItem(key);
    return rawValue ? Number(rawValue) : fallback;
  });

  useEffect(() => {
    const rawValue = localStorage.getItem(key);
    setValueState(rawValue ? Number(rawValue) : fallback);
  }, [fallback, key]);

  useEffect(() => {
    localStorage.setItem(key, String(value));
  }, [key, value]);

  return [value, setValueState];
}

function useStoredBoolean(key: string, fallback: boolean): [boolean, (next: boolean) => void] {
  const [value, setValueState] = useState(() => {
    const rawValue = localStorage.getItem(key);
    return rawValue ? rawValue === "true" : fallback;
  });

  useEffect(() => {
    const rawValue = localStorage.getItem(key);
    setValueState(rawValue ? rawValue === "true" : fallback);
  }, [fallback, key]);

  useEffect(() => {
    localStorage.setItem(key, String(value));
  }, [key, value]);

  return [value, setValueState];
}
