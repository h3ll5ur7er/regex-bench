# ADR-005 Railroad diagrams through rockuml

**Context.** A railroad diagram makes alternation, optionality and repetition visible. rockuml renders
PlantUML, including `@startregex` railroad diagrams, in WebAssembly without a server.

**Decision.** `DiagramEngine` prints a normalised pattern from the AST into a `@startregex` block (escaping
everything, no directives). `DiagramAccess` wraps `@rockuml/core`; the WASM file is copied into the build
assets and loaded lazily on first use.

**Consequences.** Constructs PlantUML's regex diagram does not know (backreferences, lookbehind, inline flags)
are normalised to a readable stand-in. The 12 MB WASM file is fetched only when the diagram is first shown, and
cached by the service worker for offline use.
