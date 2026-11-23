# regex-bench

A regex workbench that runs **entirely on your device**. It ships as an installable PWA and as an optional
Tauri desktop app (Windows and Linux). Nothing is loaded from a CDN, and the app makes no outbound requests at
runtime. Every engine, font and diagram renderer is part of the build.

The goal is to cover what regex101 and regexr do, then go further with regex-from-data, step debugging,
flavor conversion and a Rust/WASM core. The bar is UX: on first sight the page should make a complicated subject
obvious, without fluff.

## Where to start

| Page | What it answers |
| --- | --- |
| [[Architecture/User-stories]] | Who uses this, and for what |
| [[Architecture/Volatilities]] | What will change, and which component hides each change |
| [[Architecture]] | The iDesign decomposition: clients, managers, engines, resource access, resources, utilities |
| [[Architecture/Call-chains]] | How each user story travels through the components |
| [[Architecture/STRIDE]] | Threats on each hop of each call chain, with mitigations |
| [[Architecture/Residuality]] | Stressor analysis and the residual index for each architecture iteration |
| [[Design/UX-principles]] | The design rules the UI is held to |
| [[Decisions]] | Architecture decision records |
| [[Development]] | Build, test and release the web app, the Rust core and the desktop app |

## Milestones

| Milestone | Scope | Tasks |
| --- | --- | --- |
| M0 Architecture | User stories, volatilities, iDesign, call chains, STRIDE, residuality | `tasks/M0 Architecture/` |
| M1 Proof of concept | Match, replace, list, explain, railroad visualization, flavors | `tasks/M1 PoC/` |
| M2 Deployment | GitHub Actions, GitHub Pages, offline PWA, Tauri builds | `tasks/M2 Deployment/` |
| M3 Advanced features | Regex from data, Rust/WASM core, flavor conversion, debugger, tests | `tasks/M3 Advanced/` |
