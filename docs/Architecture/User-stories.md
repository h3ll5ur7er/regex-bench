# User stories

These stories are written from common real-world use cases, not from a feature list. Each one names the
**volatility** it exposes (see [[Architecture/Volatilities]]). Those links are what the architecture is built
around: a feature is a call chain through stable components, and what changes is hidden inside one component.

Personas:

- **Dev** writes code and needs a pattern that works in *their* language (JS, Python, Rust, Go, Java, .NET, PCRE).
- **Ops** works in logs and config files, often large ones, often offline or on locked-down machines.
- **Analyst** has data and wants structure out of it, but does not think in regex.
- **Learner** reads someone else's pattern and needs to understand it.
- **Reviewer** gets a pattern in a pull request and wants to know if it is correct and safe.

| ID | As a… | I want to… | So that… | Milestone | Volatilities |
| --- | --- | --- | --- | --- | --- |
| US-01 | Dev | type a pattern and test text and see every match highlighted live, with groups | I know at once if my pattern works | M1 | V1, V2, V8 |
| US-02 | Learner | point at any token of a pattern and read what it does, in plain words | I understand a pattern without reading docs | M1 | V1, V10 |
| US-03 | Dev | write a replacement template and see the result text | I can build `sed`/`replace()` calls with confidence | M1 | V1, V3 |
| US-04 | Analyst | list every match through a template (`$1, $<name>\n`) | I can extract columns out of text | M1 | V3 |
| US-05 | Learner, Reviewer | see the pattern as a railroad diagram | I can see the structure, alternatives and loops | M1 | V4 |
| US-06 | Dev | pick the regex flavor of my target language and get flavor-correct errors and results | what works here also works in my code | M1 (JS), M3 (others) | V1, V2 |
| US-07 | Dev | convert a pattern from one flavor to another, with warnings for what can't convert | I can port a pattern between languages | M3 | V1, V3 |
| US-08 | Dev | share a pattern with a link, without any server | my colleague sees exactly what I see | M1 | V5 |
| US-09 | Dev | keep a library and history of my patterns on my device | I can find yesterday's pattern again | M1 | V5 |
| US-10 | Ops | install the app and use it offline, in the browser or as a desktop app | it works on a plane and on air-gapped machines | M2 | V6 |
| US-11 | Analyst | paste a list of values and get a regex that matches them, and mark the parts I care about as groups | I get a pattern without writing one | M3 | V7 |
| US-12 | Dev, Reviewer | step through how the engine matches, and get a warning when a pattern can backtrack catastrophically | I can find why it doesn't match, or why it's slow | M3 | V2, V8 |
| US-13 | Dev | keep a set of strings that must and must not match, and see them pass or fail as I edit | I don't break a pattern when I change it | M3 | V3 |
| US-14 | Learner | browse a quick reference for the selected flavor and insert a token from it | I can learn while I work | M1 | V1, V10 |
| US-15 | Dev | get a code snippet for my language that uses the pattern, flags and replacement | I can paste it into my code | M3 | V1, V3 |
| US-16 | Ops | open a large file (a 50 MB log) and still get matches without the UI freezing | the tool works on real data | M1 (budget), M3 (streaming) | V2, V8 |
| US-17 | Any | work with the keyboard only and with a screen reader, in light or dark theme | the tool is accessible and comfortable | M1 | V9 |
| US-18 | Dev | use named groups everywhere: in the match table, the replacement, the list, and the diagram | names make my patterns readable | M1, M3 | V1, V3 |

## Acceptance notes

- **US-01** Results update while typing, within one frame for small inputs. A slow or runaway pattern never
  freezes the UI: it is stopped after a time budget, and the UI says so.
- **US-02** The explanation is a tree that mirrors the pattern. Hovering a node highlights the token in the
  pattern, and hovering a token highlights the node.
- **US-05** The diagram uses the same named groups and quantifiers as the pattern. It renders offline.
- **US-08** The share link carries the state in the URL fragment (`#…`), which browsers do not send to the server.
- **US-10** After the first visit, every feature works with the network disconnected. The first visit itself is
  the only load from the host; nothing is ever fetched from a third party.
- **US-11** The inferred regex must be more specific than `.*`: it generalises character classes per position
  (digits, letters, hex, separators) and keeps constant parts literal.
- **US-12** The debugger shows each step: the position in the pattern, the position in the text and whether it
  backtracked. It counts steps, which is also how catastrophic backtracking is detected.

## What these stories tell us will change

Reading the table by its last column: flavors (V1) and execution backends (V2) appear in almost every story. Output
modes (V3) grow from three (match, replace, list) to many (tests, code, conversion). Storage and sharing (V5) and
the host (V6) change with the platforms we target. These are the areas the architecture must isolate.
