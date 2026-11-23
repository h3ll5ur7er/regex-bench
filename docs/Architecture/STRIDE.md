# STRIDE analysis

Every hop of every call chain in [[Architecture/Call-chains]] is analysed here. The chain × hop matrix on that page
shows which chains use which hop; because hops are shared, analysing each hop once covers every hop of every chain.

**S**poofing · **T**ampering · **R**epudiation · **I**nformation disclosure · **D**enial of service ·
**E**levation of privilege.

Risk is `L`ow, `M`edium or `H`igh *after* mitigation. `—` means the category does not apply to the hop (with the
reason in the cell where it is not obvious).

## System context

regex-bench has no backend, no accounts and no network traffic after the build is loaded. That removes most of
the classic web attack surface (session theft, CSRF, server injection). The assets worth protecting are:

- **A1 The user's text.** Logs, config files and data pasted into the app can hold secrets and personal data.
- **A2 The user's device.** CPU and memory (ReDoS), the DOM (XSS), browser storage of the shared origin.
- **A3 The integrity of the app.** What GitHub Pages or a release binary delivers is what we built.

The two inputs an attacker controls are **share links** (H02) and **files/text a user is tricked into pasting**
(H01, H17). The most likely real-world harm is not an attacker at all: it is a pattern that backtracks
catastrophically (D on H07/H08/H20).

## Per-hop analysis

### H01 User → Workbench UI

| | Threat | Mitigation | Risk |
| --- | --- | --- | --- |
| S | — (local user, no identities) | | — |
| T | Pasted text containing control characters, bidi overrides (`U+202E`) or zero-width characters that make the pattern or text look different from what it is | Editors render invisible and bidi characters as visible markers; the explanation lists them as tokens | L |
| R | — | | — |
| I | Text holding secrets is visible on screen or in screenshots | Nothing leaves the device; no telemetry; "clear session" action | L |
| D | Huge pastes (100 MB) exhaust memory or freeze rendering | Size limit with an explicit "load anyway" for files; CodeMirror virtualises rendering; result cap | L |
| E | Pattern or text injected into the DOM as HTML | All text is rendered through Angular bindings and CodeMirror text nodes; no `innerHTML` of user data | L |

### H02 URL fragment → Workbench UI → LibraryManager

| | Threat | Mitigation | Risk |
| --- | --- | --- | --- |
| S | A link claims to come from someone it doesn't | Links carry no identity; the UI never claims authorship | L |
| T | A crafted fragment with oversized or malformed data, prototype-pollution keys (`__proto__`) | `ShareAccess.fromLink` decodes into a fresh object, validates every field against a schema with length limits, drops unknown keys, rejects on any failure | L |
| R | — | | — |
| I | A link shared in chat leaks the embedded text (A1) | Fragments are never sent to the server; the share dialog shows what the link contains and offers "pattern only" | M |
| D | A link with an evil pattern (`(a+)+$`) freezes the victim's tab | Every execution is budgeted and runs in a worker (H06/H07); the UI reports the timeout | L |
| E | XSS through a field rendered as HTML | Same as H01 E; validation also rejects non-string fields | L |

### H03 Workbench UI → WorkbenchManager

In-process signal. No trust boundary.

| | Threat | Mitigation | Risk |
| --- | --- | --- | --- |
| S/T/R/I/E | — (same JS realm, same trust level) | | — |
| D | Update storms from typing trigger hundreds of runs | Debounce; each run has a generation number and stale runs are cancelled | L |

### H04 WorkbenchManager → SyntaxEngine

| | Threat | Mitigation | Risk |
| --- | --- | --- | --- |
| S/R/I/E | — | | — |
| T | A pattern that the parser accepts but the backend reads differently (parser differential), so the explanation lies | Parser is tested against the backends: for each test pattern the parser's verdict must equal `new RegExp()`'s for the ECMAScript flavor | M |
| D | Deeply nested pattern (`((((…))))` × 100 000) overflows the recursive parser | Nesting depth limit; pattern length limit | L |

### H05 WorkbenchManager → MatchEngine · H06 MatchEngine → SandboxAccess

| | Threat | Mitigation | Risk |
| --- | --- | --- | --- |
| S/T/R/I/E | — (in-process) | | — |
| D | Millions of matches (`/(?:)/g` on 50 MB) exhaust memory | Result cap (default 10 000 matches) reported in the UI; empty-match advance rule | L |

### H07 SandboxAccess ↔ Web Worker

| | Threat | Mitigation | Risk |
| --- | --- | --- | --- |
| S | A message from another source posing as the worker | Dedicated worker; replies are matched by job id; anything else is ignored | L |
| T | Results of an old job applied to a new session | Job ids; only the latest job's result is applied | L |
| R | — | | — |
| I | — (same origin, same user) | | — |
| D | Catastrophic backtracking hangs the worker forever | SandboxAccess terminates the worker after the time budget and starts a new one | L |
| E | Worker script swapped by an attacker | Worker is part of the hashed build, same origin, CSP `worker-src 'self'` | L |

### H08 Web Worker → backend (`RegExp` / Rust core WASM)

| | Threat | Mitigation | Risk |
| --- | --- | --- | --- |
| S | — | | — |
| T | Out-of-bounds writes in WASM memory corrupting results | Rust core is safe Rust (`#![forbid(unsafe_code)]` except the ABI shim); inputs are length-prefixed; results are JSON-validated | L |
| R | — | | — |
| I | — | | — |
| D | Rust `regex` compile of a huge repetition (`a{1000}{1000}`) uses lots of memory | `RegexBuilder::size_limit` and `dfa_size_limit`; compile errors are reported, not panics; panics abort only the worker | L |
| E | WASM escaping its sandbox | Not possible by design; WASM gets no imports except memory | L |

### H09 WorkbenchManager → TransformEngine

| | Threat | Mitigation | Risk |
| --- | --- | --- | --- |
| S/R/I/E | — | | — |
| T | Generated code snippet (US-15) that is wrong for the language because of escaping, so the user ships a different pattern than tested | Snippets escape per-language string rules; snapshot tests per language | M |
| D | Replacement template that expands output exponentially (`$&$&$&…` on many matches) | Output length cap | L |

### H10 WorkbenchManager → DiagramEngine

| | Threat | Mitigation | Risk |
| --- | --- | --- | --- |
| S/R/I/E | — | | — |
| T | Pattern text that injects PlantUML directives (`@enduml`, `!include`) into the notation | DiagramEngine escapes every literal; it emits notation from the AST, never pastes the pattern source | L |
| D | Huge AST yields a gigantic diagram | Node-count limit; above it the UI shows "diagram too large" | L |

### H11 WorkbenchManager → DiagramAccess → rockuml WASM

| | Threat | Mitigation | Risk |
| --- | --- | --- | --- |
| S | — | | — |
| T | A compromised rockuml release (supply chain) | Pinned exact version and lock file integrity hashes; renovate PRs are reviewed | M |
| R | — | | — |
| I | rockuml `!include` reading local resources | Notation never contains `!include` (H10); rockuml has no file/network imports in the browser | L |
| D | Render loops or very slow layout | Render is lazy, debounced and only when the diagram tab is visible | L |
| E | — (WASM sandbox) | | — |

### H12 DiagramAccess → Workbench UI (SVG into the DOM)

| | Threat | Mitigation | Risk |
| --- | --- | --- | --- |
| S/R/I | — | | — |
| T | SVG containing `<script>` or `onload=` from a literal that slipped through | SVG is shown through `<img src="blob:">`, where scripts never run; no `innerHTML` | L |
| D | — | | — |
| E | Script execution via SVG | As T | L |

### H13 → ReferenceAccess → bundled content

Static content compiled into the build. No threats beyond the build's integrity (H24).

### H14 Workbench UI → LibraryManager

In-process. No trust boundary. (S/T/R/I/D/E: —)

### H15 → WorkspaceAccess → browser storage

| | Threat | Mitigation | Risk |
| --- | --- | --- | --- |
| S | — | | — |
| T | Another app on the same origin (GitHub Pages `user.github.io`) writes to our storage keys | Keys are namespaced; everything read from storage is validated like a share link (H02) | M |
| R | — | | — |
| I | Another app on the same origin reads our history (A1) | Documented; deploy to a dedicated origin is recommended; history can be disabled and cleared | M |
| D | Storage quota exceeded | Writes catch quota errors, history is capped and trimmed | L |
| E | — | | — |

### H16 → ShareAccess → URL fragment / clipboard

| | Threat | Mitigation | Risk |
| --- | --- | --- | --- |
| S/T/R | — | | — |
| I | Sharing a link with sensitive text in it | Share dialog with "include test text" toggle, off when the text is large | M |
| D | Very long links break chat tools | Compression; size shown; "pattern only" option | L |
| E | — | | — |

### H17 → HostAccess → file system / clipboard

| | Threat | Mitigation | Risk |
| --- | --- | --- | --- |
| S | — | | — |
| T | — | | — |
| R | — | | — |
| I | App reads files the user didn't choose | File picker (or drop) only, in the browser and in the desktop webview alike; the desktop app has no file-system plugin at all | L |
| D | Binary or huge files | Size limit and UTF-8 decode with replacement characters | L |
| E | Tauri IPC exposing more commands than needed | No custom commands, no plugins; the capability file grants `core:default` only | L |

### H18 Workbench UI → SynthesisManager · H19 → InferenceEngine

| | Threat | Mitigation | Risk |
| --- | --- | --- | --- |
| S/T/R/I/E | — | | — |
| D | Inference over 100 000 lines with quadratic alignment | Input caps; algorithm is linear in lines × length | L |

### H20 SynthesisManager → TraceEngine → SandboxAccess → Worker

Same as H07, plus:

| | Threat | Mitigation | Risk |
| --- | --- | --- | --- |
| D | Trace of a catastrophic pattern records millions of steps | Step cap (default 50 000), which is also reported as "catastrophic backtracking detected" | L |

### H21 SynthesisManager → MatchEngine

Same as H05–H08.

### H22 Static host / service worker → browser

| | Threat | Mitigation | Risk |
| --- | --- | --- | --- |
| S | A look-alike site serving a modified build | Out of scope technically; README links the one canonical URL | M |
| T | Service worker keeps serving a vulnerable old build | Angular service worker checks for updates on load and every 6 hours and prompts to reload | L |
| R | — | | — |
| I | Third-party requests (fonts, CDNs) leak usage | No third-party resource exists; CSP `default-src 'self'` blocks any; an end-to-end test fails on any non-same-origin request | L |
| D | Host outage | Installed PWA works from cache; desktop app needs no host | L |
| E | — | | — |

### H23 Desktop Shell → Workbench UI

| | Threat | Mitigation | Risk |
| --- | --- | --- | --- |
| S | Remote content loaded into the webview with IPC access | The webview loads only the bundled build (`frontendDist`); no remote URLs; CSP in `tauri.conf.json` | L |
| T | — | | — |
| R | — | | — |
| I | — | | — |
| D | — | | — |
| E | XSS in the webview reaching native commands | There are no native commands to reach: no plugins, `core:default` only; no shell, no fs | L |

### H24 CI → GitHub Pages / Releases

| | Threat | Mitigation | Risk |
| --- | --- | --- | --- |
| S | — | | — |
| T | Compromised third-party action or npm package | Actions pinned to versions from GitHub's own orgs; `npm ci` with lock file; minimal `permissions:` per job | M |
| R | Who released a binary | Releases come only from tags via the workflow; the workflow run is the audit trail | L |
| I | Secrets in logs | No secrets needed: Pages uses OIDC, releases use the scoped `GITHUB_TOKEN` | L |
| D | — | | — |
| E | Workflow triggered by a fork PR with write permissions | `pull_request` (not `pull_request_target`); deploy job only on `main` | L |

## Residual risks (Medium)

| Hop | Risk | Accepted because | Follow-up |
| --- | --- | --- | --- |
| H02/H16 | Shared links can carry sensitive text | Users choose what to share; the dialog makes it explicit | RB task: share dialog shows content summary |
| H04 | Parser differential | Mitigated by differential tests; can't be eliminated for flavors we don't execute | Differential tests per flavor in M3 |
| H09 | Code snippet escaping | Snapshot tests | — |
| H11/H24 | Supply chain | Pinned versions, lock file, review | Consider SRI-style hash check of `rockuml.wasm` at build |
| H15 | Shared origin on `*.github.io` | Mitigated by namespacing and validation | Custom domain |
| H22 | Phishing copies | Not technically preventable | — |
