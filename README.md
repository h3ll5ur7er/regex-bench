# regex-bench

A regex workbench that runs **entirely on your device**: test, explain, visualise, debug, convert and even
*generate* regular expressions. It's an installable offline PWA and a small desktop app for Windows and Linux.
There is no server, no CDN and no tracking: every engine, font and renderer is part of the build.

**Flavors:** ECMAScript · PCRE2 · Python · Java · .NET · Rust · Go

- **Match** with every group in its own colour, the same colour in the pattern, the text, the match list and the
  explanation.
- **Explain**: a plain-language tree that mirrors the pattern; hover either side to see the other.
- **Railroad diagram** of the pattern, rendered in WebAssembly by [rockuml](https://www.npmjs.com/package/@rockuml/angular).
- **Replace** and **List** with each flavor's own template rules.
- **Tests**: strings that must or must not match, re-run on every change.
- **Debug**: step through the backtracking engine, see where it spends its time, and get warned about
  catastrophic backtracking before it bites.
- **Convert** between flavors, with a warning wherever meaning would change.
- **Code** snippets for JavaScript, PHP, Python, Java, C#, Rust and Go, correctly escaped.
- **From data**: paste examples, select the parts you want, get a pattern that is not `.*`.
- **Never freezes**: every run happens in a sandboxed worker and is stopped after 1.5 s.
- **Shares by link** without a server: the state lives in the URL fragment.

PCRE, Python, Java and .NET patterns are translated *exactly* into ECMAScript (atomic groups, possessive
quantifiers, `\A`, `\Z` and PCRE's `$` are emulated) and run on the browser's engine. Rust and Go run on the Rust
`regex` crate compiled to WebAssembly.

## Documentation

The project is documented and tracked with [Genbeya](https://genbeya.fyi): open this repository in Genbeya, or
read the Markdown directly.

- [Home](docs/Home.md) · [Architecture](docs/Architecture.md) · [User stories](docs/Architecture/User-stories.md)
  · [Volatilities](docs/Architecture/Volatilities.md) · [Call chains](docs/Architecture/Call-chains.md)
  · [STRIDE](docs/Architecture/STRIDE.md) · [Residuality](docs/Architecture/Residuality.md)
- [Development](docs/Development.md): build, test and release
- [Tasks](tasks/): the board, one Markdown file per task

## Quick start

```bash
cd web && npm ci && npm run build:core && npm start
```
