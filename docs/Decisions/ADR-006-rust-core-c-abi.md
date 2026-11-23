# ADR-006 Rust core as a plain C-ABI WASM module

**Context.** We want Rust `regex` semantics (and later a faster engine) in the browser. `wasm-bindgen` needs a
CLI whose version must match the crate exactly, and generates glue code.

**Decision.** The crate in `core/` exports `alloc`, `dealloc` and `run(ptr, len) -> ptr` over linear memory.
Input is JSON, output is a length-prefixed JSON buffer. The worker instantiates it with no imports.

**Consequences.** No generated glue, no tool version pinning, reproducible builds with plain `cargo build
--target wasm32-unknown-unknown`. JSON costs a little speed, irrelevant at our sizes compared to matching.
