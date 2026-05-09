import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const cacheDir = path.join(root, ".cache/cultural-gravity");
const appDataDir = path.join(root, "apps/arcade/public/data");
const dailyDir = path.join(appDataDir, "daily");
const answerHistoryPath = path.join(appDataDir, "answer-history.json");
const seedMoviesPath = path.join(root, "prototypes/pop-culture-path/src/data/movies.json");
const seedRankingsPath = path.join(root, "prototypes/pop-culture-path/src/data/movie-rankings.json");
const catalogPath = path.join(cacheDir, "movie-catalog.json");
const vectorManifestPath = path.join(cacheDir, "movie-vector-manifest.json");
const vectorBinaryPath = path.join(cacheDir, "movie-vectors.f32");

const schemaVersion = 1;
const model = process.env.CG_EMBEDDING_MODEL ?? "text-embedding-3-large";
const dimensions = Number(process.env.CG_EMBEDDING_DIMENSIONS ?? 1024);
const targetCatalogSize = Number(process.env.CG_TARGET_CATALOG_SIZE ?? 100000);
const answerPoolSize = Number(process.env.CG_ANSWER_POOL_SIZE ?? 10000);
const dailyWindowDays = Number(process.env.CG_DAILY_WINDOW_DAYS ?? 7);
const enrichConcurrency = Number(process.env.CG_TMDB_CONCURRENCY ?? 8);
const tmdbDetailLimit = Number(process.env.CG_TMDB_DETAIL_LIMIT ?? 0);
const embeddingBatchSize = Number(process.env.CG_EMBEDDING_BATCH_SIZE ?? 64);
const minCandidatePopularity = Number(process.env.CG_MIN_CANDIDATE_POPULARITY ?? 1);
const minCatalogReleaseYear = Number(process.env.CG_MIN_CATALOG_RELEASE_YEAR ?? 1900);
const minCatalogVoteCount = Number(process.env.CG_MIN_CATALOG_VOTE_COUNT ?? 10);
const minCatalogPopularity = Number(process.env.CG_MIN_CATALOG_POPULARITY ?? 0.1);
const minAnswerReleaseYear = Number(process.env.CG_MIN_ANSWER_RELEASE_YEAR ?? 1990);
const minAnswerVoteCount = Number(process.env.CG_MIN_ANSWER_VOTE_COUNT ?? 2000);
const minAnswerPopularity = Number(process.env.CG_MIN_ANSWER_POPULARITY ?? 8);

const command = process.argv[2] ?? "help";

switch (command) {
  case "seed-from-local":
    await seedFromLocal();
    break;
  case "sync-catalog":
    await syncCatalog();
    break;
  case "embed-missing":
    await embedMissing();
    break;
  case "generate-daily":
    await generateDailyWindow();
    break;
  case "validate-public":
    await validatePublicData();
    break;
  case "update":
    await syncCatalog();
    await embedMissing();
    await generateDailyWindow();
    await validatePublicData();
    break;
  default:
    console.log("Usage: node scripts/cultural-gravity.mjs <seed-from-local|sync-catalog|embed-missing|generate-daily|validate-public|update>");
}

async function seedFromLocal() {
  const seedMovies = await readJson(seedMoviesPath);
  const rankings = await readJson(seedRankingsPath);
  const answerId = "the-matrix";
  const movies = seedMovies
    .map((movie, index) => ({
      id: movie.id,
      title: movie.title,
      year: movie.year,
      aliases: movie.aliases ?? [],
      popularity: seedMovies.length - index,
      voteCount: 1000,
    }))
    .filter(isCatalogEligible);
  const movieIds = new Set(movies.map((movie) => String(movie.id)));
  const history = await loadAnswerHistory();
  const answerMovie = movies.find((movie) => String(movie.id) === answerId);
  const rankedIds = Object.entries(rankings.rankings[answerId])
    .sort(([, left], [, right]) => left.rank - right.rank)
    .map(([id]) => id)
    .filter((id) => movieIds.has(String(id)));
  const date = "2026-05-08";

  await writePublicLookup(movies, {
    catalogSource: "local-seed",
    model: rankings.model,
    dimensions: rankings.dimensions,
  });

  await writeDailyFile({
    date,
    answerId,
    rankedIds,
    catalogSize: movies.length,
    model: rankings.model,
    dimensions: rankings.dimensions,
    generatedAt: rankings.generatedAt,
  });

  if (answerMovie) {
    await writeAnswerHistory(upsertAnswerHistory(history, date, answerMovie));
  }
  await writeLatest(date);
  console.log(`Seeded public Cultural Gravity data from ${movies.length} local movies.`);
}

async function syncCatalog() {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    throw new Error("TMDB_API_KEY is required for sync-catalog. Add it locally or as a GitHub Actions secret.");
  }

  await ensureDir(cacheDir);
  const existingCatalog = existsSync(catalogPath) ? await readJson(catalogPath) : { movies: [] };
  const existingById = new Map((existingCatalog.movies ?? []).map((movie) => [String(movie.id), movie]));
  const candidates = await fetchTmdbMovieExportCandidates();
  const selectedCandidates = candidates
    .filter((movie) => !movie.adult && !movie.video && movie.popularity >= minCandidatePopularity)
    .sort((left, right) => right.popularity - left.popularity)
    .slice(0, targetCatalogSize);

  const selectedIds = new Set(selectedCandidates.map((movie) => String(movie.id)));
  const missingCandidates = selectedCandidates.filter((movie) => !existingById.has(String(movie.id)));
  const candidatesToFetch = tmdbDetailLimit > 0 ? missingCandidates.slice(0, tmdbDetailLimit) : missingCandidates;
  const refreshedMovies = (existingCatalog.movies ?? []).filter(
    (movie) => selectedIds.has(String(movie.id)) && isCatalogEligible(movie),
  );

  console.log(`TMDB export candidates: ${candidates.length}`);
  console.log(`Selected catalog target: ${selectedCandidates.length}`);
  console.log(`Existing selected movies: ${refreshedMovies.length}`);
  console.log(`Missing details to fetch: ${missingCandidates.length}`);
  console.log(`Details fetched this run: ${candidatesToFetch.length}`);

  const fetchedMovies = await mapConcurrent(candidatesToFetch, enrichConcurrency, async (candidate, index) => {
    const details = await fetchTmdbMovieDetails(candidate.id, apiKey);
    if ((index + 1) % 100 === 0) {
      console.log(`Fetched ${index + 1}/${candidatesToFetch.length} TMDB movie detail records.`);
    }
    return buildMovieRecord(candidate, details);
  });

  const catalogMovies = [...refreshedMovies, ...fetchedMovies]
    .filter(Boolean)
    .filter(isCatalogEligible)
    .sort((left, right) => right.popularity - left.popularity)
    .slice(0, targetCatalogSize);

  const catalog = {
    schemaVersion,
    generatedAt: new Date().toISOString(),
    source: "tmdb",
    targetCatalogSize,
    filters: {
      minCandidatePopularity,
      minCatalogReleaseYear,
      minCatalogVoteCount,
      minCatalogPopularity,
      minAnswerReleaseYear,
      minAnswerVoteCount,
      minAnswerPopularity,
    },
    movies: catalogMovies,
  };

  await writeJsonAtomic(catalogPath, catalog);
  console.log(`Wrote ${catalogMovies.length} movies to ${path.relative(root, catalogPath)}.`);
}

async function embedMissing() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for embed-missing. Add it locally or as a GitHub Actions secret.");
  }

  const catalog = await readJson(catalogPath);
  const movies = catalog.movies ?? [];
  const existingCache = await loadVectorCache();
  const existingById = new Map(existingCache.items.map((item, index) => [String(item.id), { ...item, index }]));
  const existingVectors = existingCache.vectors;
  const nextVectors = new Float32Array(movies.length * dimensions);
  const missing = [];

  for (let index = 0; index < movies.length; index += 1) {
    const movie = movies[index];
    const existing = existingById.get(String(movie.id));
    if (existing && existing.contentHash === movie.contentHash && existingCache.dimensions === dimensions && existingCache.model === model) {
      nextVectors.set(existingVectors.subarray(existing.index * dimensions, (existing.index + 1) * dimensions), index * dimensions);
    } else {
      missing.push({ movie, index });
    }
  }

  console.log(`Embedding cache hits: ${movies.length - missing.length}`);
  console.log(`Embedding cache misses: ${missing.length}`);

  for (let offset = 0; offset < missing.length; offset += embeddingBatchSize) {
    const batch = missing.slice(offset, offset + embeddingBatchSize);
    const embeddings = await fetchEmbeddings(
      batch.map((item) => item.movie.identityText),
      apiKey,
    );

    for (let index = 0; index < batch.length; index += 1) {
      nextVectors.set(Float32Array.from(embeddings[index]), batch[index].index * dimensions);
    }

    console.log(`Embedded ${Math.min(offset + batch.length, missing.length)}/${missing.length} missing movies.`);
  }

  const manifest = {
    schemaVersion,
    generatedAt: new Date().toISOString(),
    model,
    dimensions,
    itemCount: movies.length,
    items: movies.map((movie) => ({
      id: movie.id,
      contentHash: movie.contentHash,
    })),
  };

  await ensureDir(cacheDir);
  await writeJsonAtomic(vectorManifestPath, manifest);
  await writeFileAtomic(vectorBinaryPath, Buffer.from(nextVectors.buffer));
  console.log(`Wrote vector cache for ${movies.length} movies.`);
}

async function generateDailyWindow() {
  const catalog = await readJson(catalogPath);
  const cache = await loadVectorCache();
  const movies = catalog.movies ?? [];

  if (movies.length !== cache.items.length) {
    throw new Error(`Catalog/vector size mismatch: ${movies.length} movies, ${cache.items.length} vectors.`);
  }

  await writePublicLookup(movies, {
    catalogSource: catalog.source ?? "tmdb",
    model: cache.model,
    dimensions: cache.dimensions,
  });

  const start = parseDate(process.env.CG_START_DATE) ?? todayUtc();
  let answerHistory = await loadAnswerHistory();
  for (let offset = 0; offset < dailyWindowDays; offset += 1) {
    const date = formatDate(addDays(start, offset));
    const usedAnswerIds = new Set(answerHistory.answers.map((answer) => String(answer.id)));
    const answerIndex = chooseAnswerIndex(movies, date, usedAnswerIds);
    const rankedIds = rankMovies(cache.vectors, answerIndex, movies);

    await writeDailyFile({
      date,
      answerId: movies[answerIndex].id,
      rankedIds,
      catalogSize: movies.length,
      model: cache.model,
      dimensions: cache.dimensions,
      generatedAt: new Date().toISOString(),
    });
    answerHistory = upsertAnswerHistory(answerHistory, date, movies[answerIndex]);
  }

  await writeAnswerHistory(answerHistory);
  await writeLatest(formatDate(start));
  console.log(`Generated ${dailyWindowDays} daily files starting ${formatDate(start)}.`);
}

async function validatePublicData() {
  const lookup = await readJson(path.join(appDataDir, "movie-lookup.json"));
  const latest = await readJson(path.join(dailyDir, "latest.json"));
  const daily = await readJson(path.join(appDataDir, latest.path.replace(/^\/?data\//, "")));
  const history = existsSync(answerHistoryPath) ? await readJson(answerHistoryPath) : { answers: [] };
  const ids = new Set(lookup.movies.map((movie) => String(movie[0])));
  const rankedIds = daily.rankedIds.map(String);
  const rankedSet = new Set(rankedIds);
  const issues = [];

  if (!ids.has(String(daily.answerId))) {
    issues.push(`Daily answer ${daily.answerId} is missing from movie lookup.`);
  }

  if (rankedIds[0] !== String(daily.answerId)) {
    issues.push(`Daily answer ${daily.answerId} must be ranked first.`);
  }

  if (rankedIds.length !== lookup.movies.length) {
    issues.push(`Daily rankedIds length ${rankedIds.length} does not match lookup size ${lookup.movies.length}.`);
  }

  if (rankedSet.size !== rankedIds.length) {
    issues.push("Daily rankedIds contains duplicates.");
  }

  const historyForDate = history.answers.filter((answer) => answer.date === daily.date);
  if (historyForDate.length !== 1 || String(historyForDate[0].id) !== String(daily.answerId)) {
    issues.push(`Answer history must contain exactly one matching entry for ${daily.date}.`);
  }

  const answerCounts = new Map();
  for (const answer of history.answers) {
    answerCounts.set(String(answer.id), (answerCounts.get(String(answer.id)) ?? 0) + 1);
  }
  const repeatedAnswer = [...answerCounts.entries()].find(([, count]) => count > 1);
  if (repeatedAnswer) {
    issues.push(`Answer history repeats movie id ${repeatedAnswer[0]}.`);
  }

  for (const id of rankedIds) {
    if (!ids.has(id)) {
      issues.push(`Ranked movie id ${id} is missing from movie lookup.`);
      break;
    }
  }

  if (issues.length > 0) {
    for (const issue of issues) console.error(issue);
    process.exit(1);
  }

  console.log(`Validated public data for ${lookup.movies.length} movies and daily puzzle ${daily.date}.`);
}

async function fetchTmdbMovieExportCandidates() {
  for (let daysBack = 1; daysBack <= 7; daysBack += 1) {
    const date = addDays(todayUtc(), -daysBack);
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const yyyy = date.getUTCFullYear();
    const url = `https://files.tmdb.org/p/exports/movie_ids_${mm}_${dd}_${yyyy}.json.gz`;
    const response = await fetch(url);
    if (!response.ok) continue;

    const compressed = Buffer.from(await response.arrayBuffer());
    const lines = gunzipSync(compressed).toString("utf8").trim().split("\n");
    console.log(`Using TMDB daily export ${url}`);
    return lines.map((line) => JSON.parse(line));
  }

  throw new Error("Could not fetch a TMDB daily movie id export from the last 7 days.");
}

async function fetchTmdbMovieDetails(movieId, apiKey) {
  const url = new URL(`https://api.themoviedb.org/3/movie/${movieId}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("language", "en-US");
  url.searchParams.set("append_to_response", "credits,keywords,alternative_titles");

  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(`TMDB details failed for ${movieId}: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

function buildMovieRecord(candidate, details) {
  const directors = (details.credits?.crew ?? [])
    .filter((person) => person.job === "Director")
    .map((person) => person.name)
    .filter(Boolean)
    .slice(0, 4);
  const cast = (details.credits?.cast ?? [])
    .map((person) => person.name)
    .filter(Boolean)
    .slice(0, 10);
  const keywords = (details.keywords?.keywords ?? [])
    .map((keyword) => keyword.name)
    .filter(Boolean)
    .slice(0, 20);
  const genres = (details.genres ?? []).map((genre) => genre.name).filter(Boolean);
  const aliases = uniqueStrings([
    details.original_title,
    ...(details.alternative_titles?.titles ?? [])
      .filter((title) => ["US", "GB", "CA", "AU", "NZ"].includes(title.iso_3166_1))
      .map((title) => title.title),
  ])
    .filter((alias) => alias && alias !== details.title)
    .slice(0, 10);
  const year = Number((details.release_date ?? "").slice(0, 4)) || null;
  const identityText = [
    `Title: ${details.title}.`,
    details.original_title && details.original_title !== details.title ? `Original title: ${details.original_title}.` : "",
    year ? `Year: ${year}.` : "",
    genres.length ? `Genres: ${genres.join(", ")}.` : "",
    details.overview ? `Overview: ${details.overview}` : "",
    keywords.length ? `Keywords and themes: ${keywords.join(", ")}.` : "",
    directors.length ? `Director: ${directors.join(", ")}.` : "",
    cast.length ? `Cast: ${cast.join(", ")}.` : "",
    details.belongs_to_collection?.name ? `Collection: ${details.belongs_to_collection.name}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: details.id,
    title: details.title,
    originalTitle: details.original_title,
    year,
    releaseDate: details.release_date || null,
    overview: details.overview || "",
    popularity: Number(candidate.popularity ?? details.popularity ?? 0),
    voteCount: Number(details.vote_count ?? 0),
    genres,
    keywords,
    directors,
    cast,
    collection: details.belongs_to_collection?.name ?? null,
    aliases,
    identityText,
    contentHash: hashString(identityText),
  };
}

async function fetchEmbeddings(inputs, apiKey) {
  const response = await fetchWithRetry("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      dimensions,
      input: inputs,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding request failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json();
  return payload.data.sort((left, right) => left.index - right.index).map((item) => item.embedding);
}

async function fetchWithRetry(url, options, attempts = 4) {
  let lastResponse;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, options);
    if (response.ok || ![429, 500, 502, 503, 504].includes(response.status)) {
      return response;
    }
    lastResponse = response;
    await sleep(500 * attempt ** 2);
  }
  return lastResponse;
}

async function loadVectorCache() {
  if (!existsSync(vectorManifestPath) || !existsSync(vectorBinaryPath)) {
    return {
      schemaVersion,
      model,
      dimensions,
      items: [],
      vectors: new Float32Array(),
    };
  }

  const manifest = await readJson(vectorManifestPath);
  const bytes = await readFile(vectorBinaryPath);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return {
    ...manifest,
    vectors: new Float32Array(arrayBuffer),
  };
}

function rankMovies(vectors, answerIndex, movies) {
  const scored = [];
  const answerOffset = answerIndex * dimensions;
  const answerMagnitude = vectorMagnitude(vectors, answerOffset, dimensions);

  for (let movieIndex = 0; movieIndex < movies.length; movieIndex += 1) {
    const offset = movieIndex * dimensions;
    const similarity = cosineSimilarity(vectors, answerOffset, offset, dimensions, answerMagnitude);
    scored.push({ id: movies[movieIndex].id, similarity });
  }

  return scored.sort((left, right) => right.similarity - left.similarity).map((item) => item.id);
}

function cosineSimilarity(vectors, leftOffset, rightOffset, length, leftMagnitude) {
  let dot = 0;
  let rightMagnitudeSquared = 0;

  for (let index = 0; index < length; index += 1) {
    const left = vectors[leftOffset + index];
    const right = vectors[rightOffset + index];
    dot += left * right;
    rightMagnitudeSquared += right * right;
  }

  return dot / (leftMagnitude * Math.sqrt(rightMagnitudeSquared));
}

function vectorMagnitude(vectors, offset, length) {
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    sum += vectors[offset + index] * vectors[offset + index];
  }
  return Math.sqrt(sum);
}

function chooseAnswerIndex(movies, date, usedAnswerIds = new Set()) {
  const eligibleIndexes = movies
    .map((movie, index) => ({ movie, index }))
    .filter(({ movie, index }) => index < answerPoolSize && isAnswerEligible(movie) && !usedAnswerIds.has(String(movie.id)))
    .map(({ index }) => index);

  if (eligibleIndexes.length === 0) {
    throw new Error("No eligible movies for daily answer selection.");
  }

  const digest = createHash("sha256").update(`cultural-gravity:${date}`).digest();
  const seed = digest.readUInt32BE(0);
  return eligibleIndexes[seed % eligibleIndexes.length];
}

function isCatalogEligible(movie) {
  return (
    Boolean(movie.title) &&
    Number(movie.year) >= minCatalogReleaseYear &&
    Number(movie.voteCount ?? 0) >= minCatalogVoteCount &&
    Number(movie.popularity ?? 0) >= minCatalogPopularity
  );
}

function isAnswerEligible(movie) {
  return (
    isCatalogEligible(movie) &&
    Number(movie.year) >= minAnswerReleaseYear &&
    Number(movie.voteCount ?? 0) >= minAnswerVoteCount &&
    Number(movie.popularity ?? 0) >= minAnswerPopularity
  );
}

async function loadAnswerHistory() {
  if (!existsSync(answerHistoryPath)) {
    return {
      schemaVersion,
      generatedAt: new Date().toISOString(),
      answers: [],
    };
  }
  return readJson(answerHistoryPath);
}

async function writeAnswerHistory(history) {
  const answersByDate = new Map();
  for (const answer of history.answers ?? []) {
    answersByDate.set(answer.date, answer);
  }
  const answers = [...answersByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  await writeJsonAtomic(answerHistoryPath, {
    schemaVersion,
    generatedAt: new Date().toISOString(),
    answers,
  });
}

function upsertAnswerHistory(history, date, movie) {
  const answers = (history.answers ?? []).filter((answer) => answer.date !== date);
  answers.push({
    date,
    id: movie.id,
    title: movie.title,
    year: movie.year,
  });
  return {
    ...history,
    answers,
  };
}

async function writePublicLookup(movies, metadata) {
  const publicMovies = movies.map((movie) => [
    movie.id,
    movie.title,
    movie.year,
    uniqueStrings(movie.aliases ?? []).filter((alias) => alias && alias !== movie.title),
  ]);
  const lookup = {
    schemaVersion,
    generatedAt: new Date().toISOString(),
    catalogSource: metadata.catalogSource,
    model: metadata.model,
    dimensions: metadata.dimensions,
    itemCount: publicMovies.length,
    movies: publicMovies,
  };

  await ensureDir(appDataDir);
  await writeJsonAtomic(path.join(appDataDir, "movie-lookup.json"), lookup);
}

async function writeDailyFile({ date, answerId, rankedIds, catalogSize, model, dimensions, generatedAt }) {
  await ensureDir(dailyDir);
  await writeJsonAtomic(path.join(dailyDir, `${date}.json`), {
    schemaVersion,
    date,
    generatedAt,
    model,
    dimensions,
    answerId,
    catalogSize,
    rankedIds,
  });
}

async function writeLatest(date) {
  await ensureDir(dailyDir);
  await writeJsonAtomic(path.join(dailyDir, "latest.json"), {
    schemaVersion,
    date,
    path: `/data/daily/${date}.json`,
  });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJsonAtomic(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await writeFileAtomic(filePath, `${JSON.stringify(value)}\n`);
}

async function writeFileAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, value);
  await rename(tempPath, filePath);
}

async function ensureDir(directory) {
  await mkdir(directory, { recursive: true });
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    if (!value) continue;
    const trimmed = String(value).trim();
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

function hashString(value) {
  return createHash("sha256").update(value).digest("hex");
}

function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid CG_START_DATE: ${value}`);
  }
  return date;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
