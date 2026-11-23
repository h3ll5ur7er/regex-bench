import { computed, effect, inject, Injectable, Injector, Signal, signal, untracked } from '@angular/core';
import { DEFAULT_SESSION, PatternSpec, SessionState, TestCase } from '../contracts';
import { SandboxAccess } from '../access/sandbox.access';
import { DEFAULT_INFER_OPTIONS, infer, InferMark, InferOptions } from '../engines/inference/inference.engine';
import { MatchEngine } from '../engines/match/match.engine';
import { SyntaxEngine } from '../engines/syntax/syntax.engine';
import { DEFAULT_STEP_LIMIT, TraceResult } from '../engines/trace/trace.engine';
import { TransformEngine } from '../engines/transform/transform.engine';

export interface TestOutcome {
  id: string;
  status: 'pass' | 'fail' | 'error' | 'running';
  detail: string;
}

/**
 * SynthesisManager: the learning and verification workflows (US-11, 12, 13): regex from data, unit tests and the
 * step debugger. Managers don't call each other: the client binds the session in (`attach`) and applies what
 * this manager produces. Its jobs run on separate sandbox lanes so they never cancel the live match.
 */
@Injectable({ providedIn: 'root' })
export class SynthesisManager {
  private readonly matchEngine = inject(MatchEngine);
  private readonly sandbox = inject(SandboxAccess);
  private readonly injector = inject(Injector);
  private session: Signal<SessionState> = signal(DEFAULT_SESSION);
  private analysis: Signal<ReturnType<typeof SyntaxEngine.analyze>> = computed(() => SyntaxEngine.analyze(this.session().pattern));

  // ── unit tests ──────────────────────────────────────────────────────────────────────────────────────────
  readonly testOutcomes = signal<Map<string, TestOutcome>>(new Map());
  private testRun = 0;
  private traceRun = 0;

  // ── debugger ────────────────────────────────────────────────────────────────────────────────────────────
  readonly trace = signal<TraceResult | null>(null);
  readonly traceError = signal<string | null>(null);
  readonly traceRunning = signal(false);

  // ── inference ───────────────────────────────────────────────────────────────────────────────────────────
  readonly marks = signal<InferMark[]>([]);
  readonly inferOptions = signal<InferOptions>(DEFAULT_INFER_OPTIONS);
  readonly inferred = computed(() => {
    const s = this.session();
    if (s.mode !== 'infer') return null;
    const r = infer(s.inferInput, this.marks(), this.inferOptions());
    if (!r.source) return { result: r, spec: null, diagnostics: [] };
    // Inference works in ECMAScript syntax; convert to the selected flavor.
    const js: PatternSpec = { flavor: 'ecmascript', source: r.source, flags: r.flags };
    const flavor = s.pattern.flavor;
    if (flavor === 'ecmascript') return { result: r, spec: { ...js, flags: js.flags + 'gm' }, diagnostics: [] };
    const c = TransformEngine.convert(js, SyntaxEngine.analyze(js).ast, flavor);
    return { result: r, spec: { ...c.spec, flags: c.spec.flags.replace('u', '') + 'gm' }, diagnostics: c.diagnostics };
  });

  private attached = false;

  /** Binds the session this manager works on. Called once by the client. */
  attach(session: Signal<SessionState>, analysis: Signal<ReturnType<typeof SyntaxEngine.analyze>>) {
    this.session = session;
    this.analysis = analysis;
    if (this.attached) return;
    this.attached = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const s = this.session();
      const analysis = this.analysis();
      if (s.mode !== 'tests') return;
      clearTimeout(timer);
      timer = setTimeout(() => untracked(() => this.runTests(s.pattern, s.tests, analysis)), 150);
    }, { injector: this.injector });

    let traceTimer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const s = this.session();
      const analysis = this.analysis();
      if (s.mode !== 'debug') return;
      clearTimeout(traceTimer);
      traceTimer = setTimeout(() => untracked(() => this.runTrace(s.pattern, analysis, s.text)), 200);
    }, { injector: this.injector });
  }

  private async runTests(spec: PatternSpec, tests: TestCase[], analysis: ReturnType<typeof SyntaxEngine.analyze>) {
    const run = ++this.testRun;
    const outcomes = new Map<string, TestOutcome>();
    if (!analysis.valid) {
      for (const t of tests) outcomes.set(t.id, { id: t.id, status: 'error', detail: 'The pattern has errors.' });
      this.testOutcomes.set(outcomes);
      return;
    }
    for (const t of tests) outcomes.set(t.id, { id: t.id, status: 'running', detail: '' });
    this.testOutcomes.set(new Map(outcomes));
    const single = { ...spec, flags: spec.flags.replace('g', '') };
    for (const [i, t] of tests.entries()) {
      const r = await this.matchEngine.run(single, analysis, t.text, -1 - run * 1000 - i, 1, 'tests');
      if (run !== this.testRun) return;
      if (!r) continue;
      let o: TestOutcome;
      if (r.status !== 'ok') o = { id: t.id, status: 'error', detail: r.diagnostics[0]?.message ?? r.status };
      else {
        const m = r.matches[0];
        const full = !!m && m.start === 0 && m.end === t.text.length;
        const pass = t.expect === 'match' ? !!m : t.expect === 'no-match' ? !m : full;
        const detail = m ? `matched "${t.text.slice(m.start, m.end)}" at ${m.start}` : 'no match';
        o = { id: t.id, status: pass ? 'pass' : 'fail', detail };
      }
      outcomes.set(t.id, o);
      this.testOutcomes.set(new Map(outcomes));
    }
  }

  private async runTrace(spec: PatternSpec, analysis: ReturnType<typeof SyntaxEngine.analyze>, text: string) {
    if (!analysis.valid || !spec.source) {
      this.trace.set(null);
      this.traceError.set(analysis.valid ? null : 'Fix the pattern errors to debug it.');
      return;
    }
    this.traceRunning.set(true);
    const out = await this.sandbox.execute(
      { kind: 'trace', backend: 'native', source: spec.source, flags: spec.flags, global: false, limit: DEFAULT_STEP_LIMIT, textVersion: ++this.traceRun, ast: analysis.ast },
      text,
      'trace',
    );
    if ('superseded' in out) return;
    this.traceRunning.set(false);
    if ('timeout' in out) {
      this.traceError.set('The debugger ran out of time.');
      this.trace.set(null);
    } else if (!out.ok) {
      this.traceError.set(out.error ?? 'The debugger failed.');
    } else {
      this.traceError.set(null);
      this.trace.set(out.trace as TraceResult);
    }
  }

  addMark(mark: InferMark) {
    this.marks.update((m) => [...m.filter((x) => !(x.line === mark.line && x.start < mark.end && mark.start < x.end)), mark]);
  }

  clearMarks() {
    this.marks.set([]);
  }

  /** The session that uses the inferred pattern, with the examples as test text, for the client to load. */
  inferredSession(): SessionState | null {
    const inf = this.inferred();
    if (!inf?.spec) return null;
    const s = this.session();
    return { ...s, pattern: inf.spec, text: s.inferInput, mode: 'match' };
  }
}
