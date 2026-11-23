# Residuality analysis

[Residuality theory](https://www.sciencedirect.com/science/article/pii/S1877050920305780) (Barry O'Reilly)
treats architecture as something that must *survive* in an environment it cannot predict. Instead of predicting
requirements, we apply **stressors** (anything that could happen to the system: technical, business, user,
platform) and ask what the system falls into when each one hits (its **attractor**). What must remain working is
the **residue**. We then change the architecture so that the residue survives, iterate, and finally test the
result against a **second, independent set of stressors** that was not used to design it.

The quality metric is the **residual index**:

> **Ri = (Yr − Yn) / S**
>
> S = number of test stressors, Yn = test stressors the naive architecture survives,
> Yr = test stressors the residual architecture survives. Ri ranges from −1 to 1; positive means the
> residual architecture survives more of the unknown than the naive one.

A stressor is **survived** when the app keeps delivering its core value (test a pattern on text, offline) and the
change it requires stays inside one component (or one component plus its client wiring).

## Iteration A0: the naive architecture

What one would build without analysis: one Angular component that holds the state, calls `new RegExp()` on
the main thread on every keystroke, highlights tokens with ad-hoc regexes, saves to `localStorage`, writes the
rockuml SVG into the DOM with `innerHTML`, and reads `location.hash` with `JSON.parse`.

## Design stressors

Stressors S01–S24 were used to shape the architecture. For each: what A0 falls into (attractor), what must
survive (residue), and the change made.

| ID | Stressor | A0 attractor | Residue to keep | Change | Iteration |
| --- | --- | --- | --- | --- | --- |
| S01 | User types `(a+)+$` on 30 `a`s and `!` | Tab freezes; work lost | UI stays responsive, pattern keeps working for normal input | **SandboxAccess**: worker with time budget, terminate and respawn | A1 |
| S02 | Need the Python flavor | Every feature special-cased by `if (flavor)` | Adding a flavor touches one place per concern | **SyntaxEngine dialects** (feature tables), backends in **MatchEngine** | A1 |
| S03 | Browser's JS engine lacks a feature (lookbehind in old WebKit, `v` flag) | Confusing "invalid regex" errors | Clear "your engine lacks X" and an alternative backend | Capability probe in MatchEngine's ECMAScript backend | A2 |
| S04 | User opens a 50 MB log | Freeze, out of memory | Matching continues; results capped and summarised | Budget and result caps in SandboxAccess; size policy in WorkbenchManager | A1 |
| S05 | Crafted share link | XSS or prototype pollution via `JSON.parse` | Opening any link is safe | **ShareAccess** with schema validation | A1 |
| S06 | Storage quota exceeded | Unhandled exception on save | Editing continues; old history trimmed | **WorkspaceAccess** catches and trims | A1 |
| S07 | User is offline on first launch after install | Blank page | Installed app works | Service worker precaches the whole build incl. WASM | A1 |
| S08 | `rockuml.wasm` fails to load (blocked, corrupt) | Exceptions in the main component | Everything except the diagram works | **DiagramAccess** isolates load errors; UI shows a message | A1 |
| S09 | Pattern nested 100 000 deep | Stack overflow in highlighting | Clear error | Depth limit in SyntaxEngine | A1 |
| S10 | Pattern matches empty string on 50 MB → 50 M matches | Out of memory | Partial results + "capped" notice | Result cap in the backend | A1 |
| S11 | Another app on the same `github.io` origin | Reads/overwrites history | Our data is validated and namespaced | WorkspaceAccess namespacing + validation | A1 |
| S12 | A dependency is compromised | Malicious code in the build | Detect and contain | Lock file, pinned versions, CSP blocks exfiltration | A1 |
| S13 | WebView2 and WebKitGTK behave differently | Desktop bugs spread through UI code | Platform differences in one place | **HostAccess**; Desktop Shell has no logic | A2 |
| S14 | Replacement syntax differs per flavor (`$1` vs `\1` vs `\g<1>`) | Wrong replacements | Correct per flavor | **TransformEngine** uses the dialect | A1 |
| S15 | User needs exact Rust `regex` semantics | Results differ from production | Same engine as production | Rust core backend in the worker | A1 |
| S16 | Step debugger records millions of steps | Freeze | Trace stops with "catastrophic backtracking" | **TraceEngine** split from MatchEngine, own step cap | A2 |
| S17 | New output mode: code generation | Main component grows | One new transform | TransformEngine + UI tab | A1 |
| S18 | Rust core panics on an edge case | Worker hangs or dies silently | Error shown; next run works | SandboxAccess respawns the worker on error | A1 |
| S19 | Want an NFA view instead of railroad | Rewrite rendering | New notation only | **DiagramEngine** (notation) split from DiagramAccess (renderer) | A1 |
| S20 | Clipboard or File API unavailable | Buttons silently fail | Fallback path | HostAccess with fallbacks | A2 |
| S21 | Service worker serves a stale, buggy build | Users stuck on old version | Update reaches users | SW update check + reload prompt | A1 |
| S22 | Inference on 100 000 noisy lines | Freeze | Bounded, explainable result | **InferenceEngine** linear algorithm, input cap | A2 |
| S23 | Angular major upgrade | Every file touches Angular | Engines unaffected | Engines and contracts are framework-free TypeScript | A1 |
| S24 | Screen-reader user | Unusable | Accessible | UI client concern; semantic markup, ARIA, focus order | A1 |

### What changed between A1 and A2

The incidence matrix of A1 showed **MatchEngine** affected by six stressors (S01, S02, S03, S10, S15, S16), the
highest of any component, and the UI client affected by every platform stressor (S13, S20) because Tauri and
clipboard calls were made from components. A component hit by many unrelated stressors is a place where
changes will collide. A2 therefore:

1. Split **TraceEngine** out of MatchEngine (S16 no longer touches matching).
2. Introduced **HostAccess** (S13, S20 leave the UI).
3. Moved reference text into **ReferenceAccess** as data (content changes no longer touch SyntaxEngine).
4. Gave SandboxAccess a **main-thread fallback** with a smaller budget for environments without workers.
5. Made InferenceEngine a separate engine instead of a function inside SynthesisManager (S22).

## Incidence matrix (A2)

Rows are design stressors, columns are components. `●` = the component must change or act to survive the
stressor. K = number of components affected.

| | UI | Desk | WM | SM | LM | SE | ME | TE | DE | IE | TrE | SA | WA | ShA | DA | RA | HA | K |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S01 | | | | | | | ● | | | | | ● | | | | | | 2 |
| S02 | | | | | | ● | ● | ● | | | | | | | | ● | | 4 |
| S03 | | | | | | | ● | | | | | | | | | | | 1 |
| S04 | ● | | ● | | | | | | | | | ● | | | | | | 3 |
| S05 | | | | | | | | | | | | | | ● | | | | 1 |
| S06 | | | | | | | | | | | | | ● | | | | | 1 |
| S07 | ● | | | | | | | | | | | | | | | | | 1 |
| S08 | | | | | | | | | | | | | | | ● | | | 1 |
| S09 | | | | | | ● | | | | | | | | | | | | 1 |
| S10 | | | | | | | ● | | | | | ● | | | | | | 2 |
| S11 | | | | | | | | | | | | | ● | | | | | 1 |
| S12 | | | | | | | | | | | | | | | ● | | | 1 |
| S13 | | ● | | | | | | | | | | | | | | | ● | 2 |
| S14 | | | | | | | | ● | | | | | | | | | | 1 |
| S15 | | | | | | | ● | | | | | ● | | | | | | 2 |
| S16 | | | | | | | | | | | ● | | | | | | | 1 |
| S17 | ● | | | | | | | ● | | | | | | | | | | 2 |
| S18 | | | | | | | | | | | | ● | | | | | | 1 |
| S19 | | | | | | | | | ● | | | | | | | | | 1 |
| S20 | | | | | | | | | | | | | | | | | ● | 1 |
| S21 | ● | | | | | | | | | | | | | | | | | 1 |
| S22 | | | | ● | | | | | | ● | | | | | | | | 2 |
| S23 | ● | | ● | ● | ● | | | | | | | | | | | | | 4 |
| S24 | ● | | | | | | | | | | | | | | | | | 1 |
| **Σ** | 6 | 1 | 2 | 2 | 1 | 2 | 5 | 3 | 1 | 1 | 1 | 5 | 2 | 1 | 2 | 1 | 2 | 38 |

- Mean K = 38 / 24 = **1.58** components per stressor (A1: 2.13; A0: 1 by construction, because everything is
  one component, which is exactly why A0 can't contain anything).
- The two K = 4 rows are honest: a new flavor (S02) needs syntax, a backend, replacement rules and reference
  text. Those four are still separate changes to four stable interfaces, and the dialect table is shared.
- MatchEngine and SandboxAccess still carry 5 each, all of them execution concerns. That is the intended
  concentration: execution is the riskiest activity, and it is now in exactly two places.

## Test stressors and residual index

The following stressors were written **after** A2 was fixed and were not used to design it. Each architecture
is checked against each one.

| ID | Test stressor | A0 | A1 | A2 | Notes |
| --- | --- | --- | --- | --- | --- |
| T01 | Users ask for the Java flavor | ✗ | ✓ | ✓ | New dialect + backend |
| T02 | rockuml 1.0 changes its API | ✗ | ✓ | ✓ | DiagramAccess only |
| T03 | Linux WebKitGTK lacks the RegExp `v` flag | ✗ | ✗ | ✓ | A2 capability probe |
| T04 | A user opens a 200 MB file | ✗ | ✓ | ✓ | Caps and budget |
| T05 | Lockdown mode disables WASM and workers | ✓ | ✗ | ✓ | A0 never used them; A1 depended on them; A2 falls back to the main thread with a small budget |
| T06 | Share link format v2 | ✗ | ✓ | ✓ | Versioned in ShareAccess |
| T07 | Replace Tauri with another shell | ✗ | ✗ | ✓ | HostAccess |
| T08 | German UI translation | ✗ | ✗ | ✗ | UI strings are not externalised yet |
| T09 | Debugger on a pattern that takes 10 M steps | ✗ | ✗ | ✓ | TraceEngine step cap |
| T10 | Browser evicts storage | ✓ | ✓ | ✓ | Only history is lost |
| T11 | Script injected via a diagram label | ✗ | ✓ | ✓ | `<img>` rendering, escaping |
| T12 | Run unit tests on every keystroke | ✗ | ✓ | ✓ | Manager workflow change |
| T13 | Inference must use negative examples | ✗ | ✗ | ✓ | InferenceEngine is separate |
| T14 | App moves from GitHub Pages to a custom domain | ✓ | ✓ | ✓ | Relative base href |
| T15 | Clipboard permission denied | ✗ | ✗ | ✓ | HostAccess fallback |
| T16 | Rust core panics on an input | ✓ | ✓ | ✓ | A0 has no Rust core; A1/A2 respawn the worker |
| **Survived** | | **4** | **9** | **15** | of S = 16 |

- **Ri(A1) = (9 − 4) / 16 = 0.31**
- **Ri(A2) = (15 − 4) / 16 = 0.69**

T08 (translation) is the one A2 does not survive. It is recorded as a known weakness; externalising UI strings
is a backlog task rather than an M1 change because no story requires it yet.

## How to keep this alive

- Add a stressor here whenever an incident, bug or feature request surprises us. If A2 doesn't survive it,
  change the architecture, then add the stressor to the matrix.
- Re-score the test set at the end of each milestone. If Ri drops, the architecture has eroded.
