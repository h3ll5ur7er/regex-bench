---
id: RB-8
title: Flavor-aware parser with dialect tables
type: feature
status: done
priority: high
milestone: M1
estimate: 2d
depends_on: [RB-3]
---
One recursive-descent parser, seven dialects (ECMAScript, PCRE2, Python, Java, .NET, Rust, Go). Differential test against `RegExp` for ECMAScript.

Code: `web/src/app/engines/syntax/`
