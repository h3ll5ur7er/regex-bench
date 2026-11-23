# ADR-007 CodeMirror 6 for the editors

**Context.** The pattern and the test text need syntax colouring, match highlighting, hover, and must stay fast
on very large text.

**Decision.** Use CodeMirror 6 (already a peer dependency of `@rockuml/angular/editor`). Highlighting is done with
decorations computed from the AST and the match results.

**Consequences.** Virtualised rendering handles large documents. Accessibility of the editor is CodeMirror's.
