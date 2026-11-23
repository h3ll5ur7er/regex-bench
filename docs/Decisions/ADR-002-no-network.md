# ADR-002 No network at runtime

**Context.** Users paste logs and data that may be confidential, and work on air-gapped machines.

**Decision.** The build contains everything: fonts (`@fontsource`), WASM modules, reference content. A
Content-Security-Policy in `index.html` restricts every fetch to `'self'`. No telemetry, no analytics, no
error reporting service. The service worker precaches the whole build.

**Consequences.** Larger first load (WASM ~12 MB for rockuml, loaded lazily on first diagram). Fonts and
content updates require a new build. An end-to-end check asserts that no request leaves the origin.
