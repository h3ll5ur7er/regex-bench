# ADR-001 Decompose by volatility with IDesign

**Context.** The feature list (match, replace, list, diagrams, flavors, inference, debugging, desktop) will keep
growing. A functional decomposition would put every feature into the UI layer and couple them all to Angular.

**Decision.** Use the IDesign layers (clients, managers, engines, resource access, resources, utilities) with
the calling rules in [[Architecture]]. Volatilities are listed in [[Architecture/Volatilities]].

**Consequences.** More files than a naive app. Engines are framework-free and testable in isolation. The
residual index rose from 0 (naive) to 0.69 (see [[Architecture/Residuality]]).
