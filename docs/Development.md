# Development

## Layout

| Path | What |
| --- | --- |
| `web/` | The Angular 22 PWA (the Workbench UI client and everything below it) |
| `web/src/app/contracts/` | Shared data types: the only things that cross component boundaries |
| `web/src/app/engines/` | Syntax, Match, Transform, Diagram, Inference, Trace engines: framework-free TypeScript |
| `web/src/app/access/` | Resource access: sandbox, workspace, share, diagram, reference, host |
| `web/src/app/managers/` | Workbench, Synthesis, Library managers |
| `web/src/app/ui/` | The Workbench UI client |
| `web/src/app/workers/` | The sandbox worker |
| `web/scripts/` | `e2e.mjs` (end-to-end checks), `serve.mjs`, `icons.mjs` |
| `core/` | The Rust core: the `regex` crate behind a C ABI, compiled to `wasm32-unknown-unknown` |
| `desktop/` | The Tauri 2 desktop shell |
| `docs/`, `tasks/` | This wiki and the task board ([Genbeya](https://genbeya.fyi)) |

## Prerequisites

- Node 22 and npm
- Rust (stable) with the WebAssembly target: `rustup target add wasm32-unknown-unknown`
- For the desktop app on Linux: `libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev patchelf`

## Web app

```bash
cd web
npm ci
npm run build:core      # builds core/ to WebAssembly and copies it to public/wasm/
npm start               # http://localhost:4200 (service worker off in dev)
npm test                # unit tests (Vitest)
npx ng build            # production build in dist/web/browser
```

End-to-end checks run the production build in Chromium. They need Playwright
(`npm install --no-save playwright && npx playwright install chromium`):

```bash
node scripts/e2e.mjs dist/web/browser /
```

They check that no request leaves the origin, that every engine runs, that a runaway pattern is stopped, that
share links round-trip and that the app works offline after the first visit.

## Rust core

```bash
cargo test --manifest-path core/Cargo.toml
```

## Desktop app

```bash
cd web && npx ng build --base-href / && cd ..
cd desktop && npm ci && npx tauri build          # all bundles for this OS
cd desktop && npx tauri build --bundles deb      # one bundle
```

The app loads `web/dist/web/browser` into the binary. It exposes no Tauri commands and loads no plugins.

## Releases

- Every push to `main` runs `.github/workflows/ci.yml` and deploys to GitHub Pages. In the repository settings,
  set **Pages → Source** to **GitHub Actions** once.
- A tag `v*` runs `.github/workflows/desktop.yml`: Windows (NSIS, MSI) and Linux (AppImage, deb) installers are
  attached to a GitHub release.

## Adding a flavor

1. Add a `Dialect` in `web/src/app/engines/syntax/dialects.ts`. The parser, explanation, converter and templates
   read it.
2. Choose its backend: `native`, `translated` (exact translation to ECMAScript) or `rust`.
3. Add its replacement syntax in `engines/transform/template.ts` if it is new, and a snippet in `codegen.ts`.
4. Add reference entries in `access/reference.content.ts`.
5. Add tests next to the parser and printer specs.

This is the residuality stressor S02: four stable places, one per concern.
