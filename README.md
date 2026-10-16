# gym-log
poc app to log gym exercise. See [gym-log-spec.md](gym-log-spec.md).

## Development

```sh
npm install
npm run dev      # http://localhost:5173/gym-log/
npm run build    # typecheck + production build into dist/
npm run preview  # serve the production build (service worker active)
npm test         # unit tests (Vitest + fake-indexeddb)
```

## Deploy

Every push to `main` builds and deploys to https://disk83.github.io/gym-log/ via
`.github/workflows/deploy.yml`. One-time setup: in the repo's Settings → Pages,
set **Source** to **GitHub Actions**.
