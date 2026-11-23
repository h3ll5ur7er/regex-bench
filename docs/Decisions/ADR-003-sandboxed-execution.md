# ADR-003 Run every pattern in a worker with a budget

**Context.** User patterns can backtrack catastrophically. A synchronous `RegExp` call cannot be interrupted;
only terminating the thread that runs it can stop it.

**Decision.** `SandboxAccess` runs every execution job in a dedicated Web Worker. If a job exceeds its time
budget (default 1.5 s), the worker is terminated and replaced, and the result is `timeout`. Where workers are
unavailable, jobs run on the main thread with a reduced input size.

**Consequences.** Results arrive asynchronously; the manager drops stale results by job id. Worker startup costs
a few ms once.
