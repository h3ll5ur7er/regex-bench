/// <reference lib="webworker" />
import { ExecJob, ExecOutcome } from '../contracts';
import { instantiateRustCore, runNative, runRust } from '../engines/match/backends';
import { trace } from '../engines/trace/trace.engine';

/**
 * The sandbox worker (docs/Decisions/ADR-003-sandboxed-execution.md). It holds the current text so it is not
 * copied on every keystroke, and the Rust core instance. SandboxAccess terminates it when a job overruns its
 * budget, which is the only way to stop a runaway backtracking regex.
 */
let text = '';
let textVersion = -1;
let rustModule: WebAssembly.Module | undefined;
let rust: Awaited<ReturnType<typeof instantiateRustCore>> | undefined;

type Inbound = { type: 'init'; rustModule?: WebAssembly.Module } | { type: 'job'; job: ExecJob };

addEventListener('message', async ({ data }: MessageEvent<Inbound>) => {
  if (data.type === 'init') {
    rustModule = data.rustModule;
    return;
  }
  const job = data.job;
  if (job.text !== undefined) {
    text = job.text;
    textVersion = job.textVersion;
  }
  if (job.textVersion !== textVersion) {
    postMessage({ id: job.id, ok: false, matches: [], capped: false, elapsedMs: 0, needText: true } satisfies ExecOutcome);
    return;
  }
  let out: ExecOutcome;
  try {
    if (job.kind === 'trace') {
      const t0 = performance.now();
      const result = trace(job.ast!, job.flags, text, job.limit);
      out = { id: job.id, ok: true, matches: [], capped: false, elapsedMs: performance.now() - t0, trace: result };
    } else if (job.backend === 'rust') {
      if (!rust) {
        if (!rustModule) throw new Error('The Rust engine is not available.');
        rust = await instantiateRustCore(rustModule);
      }
      out = runRust(rust, job, text);
    } else {
      out = runNative(job, text);
    }
  } catch (e) {
    out = { id: job.id, ok: false, error: (e as Error).message, matches: [], capped: false, elapsedMs: 0 };
  }
  postMessage(out);
});
