# ADR-004 One parser with dialect feature tables

**Context.** Flavors share most syntax and differ in details: named-group syntax, possessive quantifiers,
atomic groups, `\A`/`\z`, inline flags, Unicode properties, replacement syntax.

**Decision.** One recursive-descent parser produces one AST type. A `Dialect` object lists which constructs the
flavor accepts and how they are spelled. The parser checks each construct against the dialect and emits a
diagnostic for unsupported ones. Conversion between flavors parses with the source dialect and prints with the
target dialect.

**Consequences.** Adding a flavor means writing a dialect table and, optionally, a backend. Flavor quirks that
change the *meaning* of shared syntax (for example `$` in Python vs JS) are encoded as dialect flags used by the
explanation text and the converter.
