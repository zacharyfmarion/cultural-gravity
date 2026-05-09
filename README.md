# Cultural Gravity

A daily movie guessing game that uses offline OpenAI embeddings to rank cultural similarity.

## Scripts

- `pnpm install`
- `pnpm dev`
- `pnpm build`
- `pnpm typecheck`
- `pnpm validate:puzzles`
- `pnpm seed:local`
- `pnpm update:daily`
- `pnpm validate:generated`

## Layout

- `apps/arcade`: the playable web app.
- `packages/game-core`: shared puzzle, scoring, state, validation, and shell primitives.
- `packages/prototype-registry`: active game registration.
- `prototypes/pop-culture-path`: the embedding-backed movie game.
- `scripts/cultural-gravity.mjs`: syncs TMDB, updates cached embeddings, and writes daily static game data.
- `.github/workflows/cultural-gravity-daily.yml`: daily GitHub Actions data update and Pages deploy.

The browser never calls OpenAI or TMDB. It loads static JSON from `apps/arcade/public/data`.

## Publishing Setup

Add these repository secrets in GitHub:

- `OPENAI_API_KEY`
- `TMDB_API_KEY`

Enable GitHub Pages with source set to **GitHub Actions**. The scheduled workflow restores the movie/vector cache, syncs TMDB, embeds only missing or changed movies with `text-embedding-3-large`, generates a rolling 7-day set of daily rank files, commits the static data, and deploys the Vite build.

Default catalog and answer filters are deliberately different:

- Guess catalog: release year `1900+`, at least `10` TMDB votes, and popularity `>= 0.1`.
- Daily answers: release year `1990+`, at least `2,000` TMDB votes, and popularity `>= 8`.
- The full guess catalog can include obscure movies as guesses, but answers are restricted to modern, moderately popular movies.
- `apps/arcade/public/data/answer-history.json` records past answers, and the daily generator skips repeats.

Local fallback:

- `pnpm seed:local` regenerates a tiny 63-movie dataset from the current seed corpus.
- `pnpm update:daily` requires both API keys and builds the scaled dataset.
