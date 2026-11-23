import { Injectable } from '@angular/core';
import { ExecJob, ExecOutcome } from '../contracts';
import { instantiateRustCore, runNative, runRust } from '../engines/match/backends';

export type SandboxResult = ExecOutcome | { id: number; timeout: true; elapsedMs: number } | { id: number; superseded: true };

export const DEFAULT_BUDGET_MS = 1500;
/** Without a worker nothing can stop a runaway pattern, so the text is cut to keep the worst case short. */
export const MAIN_THREAD_TEXT_LIMIT = 20_000;

interface InFlight {
  job: ExecJob;
  text: string;
  sentAt: number;
  resolve: (r: SandboxResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * SandboxAccess: `execute(job)` within a time budget (docs/Decisions/ADR-003-sandboxed-execution.md).
 * Hides the worker's lifecycle, its termination on overrun, the Rust core's WASM module and the main-thread
 * fallback for environments without workers (Residuality T05). Independent workflows use separate lanes, each
 * with its own worker, so a test run never supersedes the live match.
 */
@Injectable({ providedIn: 'root' })
export class SandboxAccess {
  budgetMs = DEFAULT_BUDGET_MS;
  private readonly lanes = new Map<string, Lane>();
  private rustModule?: Promise<WebAssembly.Module | undefined>;
  private workersUnavailable = typeof Worker === 'undefined';

  /** True when patterns run on the main thread (no worker support). */
  get degraded(): boolean {
    return this.workersUnavailable;
  }

  async execute(job: Omit<ExecJob, 'id' | 'text'>, text: string, lane = 'match'): Promise<SandboxResult> {
    let l = this.lanes.get(lane);
    if (!l) this.lanes.set(lane, (l = new Lane(this)));
    if (job.backend === 'rust') await this.loadRust();
    return l.execute(job, text);
  }

  /** @internal */
  createWorker(): Worker | undefined {
    if (this.workersUnavailable) return undefined;
    try {
      const w = new Worker(new URL('../workers/exec.worker', import.meta.url), { type: 'module' });
      void this.rustModule?.then((m) => w.postMessage({ type: 'init', rustModule: m }));
      return w;
    } catch {
      this.workersUnavailable = true;
      return undefined;
    }
  }

  private loadRust(): Promise<WebAssembly.Module | undefined> {
    this.rustModule ??= (async () => {
      try {
        const url = new URL('wasm/regex_core.wasm', document.baseURI);
        // Streaming compilation needs the application/wasm MIME type; fall back where a host doesn't send it.
        const module = await WebAssembly.compileStreaming(fetch(url)).catch(async () => WebAssembly.compile(await (await fetch(url)).arrayBuffer()));
        for (const l of this.lanes.values()) l.post({ type: 'init', rustModule: module });
        return module;
      } catch {
        return undefined;
      }
    })();
    return this.rustModule;
  }

  /** @internal */
  async runOnMainThread(job: ExecJob, text: string): Promise<ExecOutcome> {
    const cut = text.length > MAIN_THREAD_TEXT_LIMIT ? text.slice(0, MAIN_THREAD_TEXT_LIMIT) : text;
    if (job.kind === 'trace') {
      const { trace } = await import('../engines/trace/trace.engine');
      return { id: job.id, ok: true, matches: [], capped: false, elapsedMs: 0, trace: trace(job.ast!, job.flags, cut, job.limit) };
    }
    if (job.backend === 'rust') {
      const module = await this.rustModule;
      if (!module) return { id: job.id, ok: false, error: 'The Rust engine could not be loaded.', matches: [], capped: false, elapsedMs: 0 };
      return runRust(await instantiateRustCore(module), job, cut);
    }
    return runNative(job, cut);
  }
}

let nextJobId = 1;

/** One worker and the jobs in flight on it. */
class Lane {
  private worker?: Worker;
  /** NaN never equals a version, so the first job always carries its text. */
  private workerTextVersion = NaN;
  private readonly inFlight = new Map<number, InFlight>();

  constructor(private readonly sandbox: SandboxAccess) {}

  post(msg: unknown) {
    this.worker?.postMessage(msg);
  }

  execute(job: Omit<ExecJob, 'id' | 'text'>, text: string): Promise<SandboxResult> {
    const full: ExecJob = { ...job, id: nextJobId++ };
    // Older jobs are superseded; one that has been running for a while may be a runaway, so restart.
    for (const f of [...this.inFlight.values()]) {
      if (performance.now() - f.sentAt > 50) this.restart();
      else {
        clearTimeout(f.timer);
        this.inFlight.delete(f.job.id);
        f.resolve({ id: f.job.id, superseded: true });
      }
    }
    if (!this.ensureWorker()) return this.sandbox.runOnMainThread(full, text);
    return new Promise<SandboxResult>((resolve) => {
      const timer = setTimeout(() => this.timeout(full.id), this.sandbox.budgetMs + 50);
      this.inFlight.set(full.id, { job: full, text, sentAt: performance.now(), resolve, timer });
      this.send(full, text);
    });
  }

  private send(job: ExecJob, text: string) {
    const withText = this.workerTextVersion !== job.textVersion;
    this.worker!.postMessage({ type: 'job', job: { ...job, text: withText ? text : undefined } });
    this.workerTextVersion = job.textVersion;
  }

  private ensureWorker(): boolean {
    if (this.worker) return true;
    this.worker = this.sandbox.createWorker();
    if (!this.worker) return false;
    this.workerTextVersion = NaN;
    this.worker.onmessage = ({ data }: MessageEvent<ExecOutcome>) => this.onResult(data);
    this.worker.onerror = () => this.failAll('The sandbox worker crashed. The next run starts a fresh one.');
    return true;
  }

  private onResult(out: ExecOutcome) {
    const f = this.inFlight.get(out.id);
    if (!f) return;
    if (out.needText) {
      this.workerTextVersion = NaN;
      this.send(f.job, f.text);
      return;
    }
    clearTimeout(f.timer);
    this.inFlight.delete(out.id);
    f.resolve(out);
  }

  private timeout(id: number) {
    const f = this.inFlight.get(id);
    if (!f) return;
    this.inFlight.delete(id);
    this.restart();
    f.resolve({ id, timeout: true, elapsedMs: performance.now() - f.sentAt });
  }

  private restart() {
    this.worker?.terminate();
    this.worker = undefined;
    for (const f of this.inFlight.values()) {
      clearTimeout(f.timer);
      f.resolve({ id: f.job.id, superseded: true });
    }
    this.inFlight.clear();
  }

  private failAll(error: string) {
    for (const f of this.inFlight.values()) {
      clearTimeout(f.timer);
      f.resolve({ id: f.job.id, ok: false, error, matches: [], capped: false, elapsedMs: 0 });
    }
    this.inFlight.clear();
    this.worker?.terminate();
    this.worker = undefined;
  }
}
