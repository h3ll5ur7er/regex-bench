# Volatilities

The [IDesign method](https://www.idesign.net/) decomposes a system by **volatility**, not by function. A
functional decomposition (a "match component", a "replace component") couples every component to every change in
requirements. A volatility-based decomposition puts each area of likely change behind one component, so that a
change touches one place. Features then become *call chains* through those components
(see [[Architecture/Call-chains]]).

Each volatility below was found by reading the [[Architecture/User-stories]] for the question "what can change
here, either over time or between customers/platforms?". Every row names the component that encapsulates it
(see [[Architecture]]).

| ID | Volatility | Axis | What changes | Evidence | Encapsulated by |
| --- | --- | --- | --- | --- | --- |
| V1 | **Regex flavor / dialect** | over time and per user | The syntax a flavor accepts (`(?<n>)` vs `(?P<n>)`, possessive quantifiers, `\K`, `\p{…}`, inline flags), its errors, its replacement syntax. New flavors get added; existing flavors gain features (JS `v` flag, `/d` indices, duplicate named groups). | US-01, 02, 06, 07, 14, 15, 18 | `SyntaxEngine` dialects |
| V2 | **Execution backend** | over time and per platform | *What* runs the pattern: the browser's `RegExp`, the Rust `regex` crate in WASM, a tracing interpreter, and maybe native engines on the desktop. Different backends have different semantics, limits and speeds. | US-01, 06, 12, 16 | `MatchEngine` backends behind `SandboxAccess` |
| V3 | **Output mode** | over time | Match, replace and list today; split, unit tests, code generation, flavor conversion and exports later. | US-03, 04, 07, 13, 15 | `TransformEngine` |
| V4 | **Visual notation and renderer** | over time | Railroad diagram today; NFA/DFA graphs and step animation later. The renderer (rockuml) may change version, or be replaced. | US-05, 12 | `DiagramEngine` (notation) and `DiagramAccess` (renderer) |
| V5 | **Persistence and sharing** | per platform and over time | URL fragment links, `localStorage`/IndexedDB, files on the desktop, exports. Format versions must migrate. | US-08, 09 | `WorkspaceAccess`, `ShareAccess` |
| V6 | **Host platform** | per platform | Browser tab, installed PWA, Tauri on Windows (WebView2) and Linux (WebKitGTK), later macOS/mobile. Each has different APIs (files, clipboard, storage) and different JS engines. | US-10, 16 | Clients and `HostAccess` |
| V7 | **Inference algorithm** | over time | How a regex is synthesised from examples: per-position class generalisation today, alignment/multiple-sequence approaches, or negative examples later. | US-11 | `InferenceEngine` |
| V8 | **Input scale and performance budget** | per user | From a 3-line sample to a 50 MB log. Determines chunking, time budgets, result truncation, virtualised rendering. | US-01, 12, 16 | `SandboxAccess` (budget), `WorkbenchManager` (policy) |
| V9 | **Look, layout and interaction** | over time | Themes, layouts (side by side, stacked, mobile), keyboard maps. | US-17 | Clients |
| V10 | **Reference and explanation content** | over time and per flavor | Token descriptions, quick-reference sections, examples; later translations. | US-02, 14 | `ReferenceAccess` (content as data) |

## Things that are *not* volatile

The core abstractions are stable and form the shared contracts between components:

- A **pattern** has a source, flags and a flavor.
- A **subject** is text.
- A **match** is a span with numbered and optionally named group spans.
- A **pattern AST** is a tree of nodes with source spans (literal, class, group, quantifier, assertion, …).

These are plain data types in `web/src/app/contracts/` and they are the only things that cross component
boundaries.

## Volatilities that were considered and rejected

- *"Which UI framework"*: a one-time choice (Angular), not a volatility we design for.
- *"Server-side execution"*: explicitly out of scope; the product promise is "nothing leaves your device".
- *"Multi-user collaboration"*: no story requires it. Sharing by link (V5) covers the need.
