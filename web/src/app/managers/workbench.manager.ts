import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { DEFAULT_SESSION, Diagnostic, FlavorId, MatchResult, Mode, PatternSpec, SessionState, TestCase } from '../contracts';
import { DiagramAccess, DiagramImage } from '../access/diagram.access';
import { ReferenceAccess } from '../access/reference.access';
import { DiagramEngine } from '../engines/diagram/diagram.engine';
import { MatchEngine } from '../engines/match/match.engine';
import { dialectOf } from '../engines/syntax/dialects';
import { SyntaxEngine } from '../engines/syntax/syntax.engine';
import { TransformEngine } from '../engines/transform/transform.engine';

/**
 * WorkbenchManager: the evaluation workflow (US-01…06, 14, 16, 18). Whenever the pattern, flags, flavor, mode or
 * text change it parses (SyntaxEngine), runs (MatchEngine, in the sandbox), transforms (TransformEngine) and
 * draws (DiagramEngine → DiagramAccess). It debounces input and drops stale results.
 */
@Injectable({ providedIn: 'root' })
export class WorkbenchManager {
  private readonly matchEngine = inject(MatchEngine);
  private readonly diagramAccess = inject(DiagramAccess);

  readonly state = signal<SessionState>(DEFAULT_SESSION);
  private readonly textVersion = signal(0);

  readonly pattern = computed(() => this.state().pattern);
  readonly dialect = computed(() => dialectOf(this.state().pattern.flavor));
  readonly analysis = computed(() => SyntaxEngine.analyze(this.pattern()));
  readonly result = signal<MatchResult | null>(null);
  readonly running = signal(false);

  /** Diagnostics from parsing and from running, errors first. */
  readonly diagnostics = computed<Diagnostic[]>(() => {
    const all = [...this.analysis().diagnostics, ...(this.result()?.diagnostics ?? [])];
    const seen = new Set<string>();
    const order = { error: 0, warning: 1, info: 2 };
    return all.filter((d) => !seen.has(d.message) && seen.add(d.message)).sort((a, b) => order[a.severity] - order[b.severity]);
  });

  readonly replaceOutput = computed(() => {
    const r = this.result();
    const s = this.state();
    if (s.mode !== 'replace' || !r || r.status !== 'ok') return null;
    return TransformEngine.replace(s.pattern, s.replacement, s.text, r.matches, r.groupNames);
  });

  readonly listOutput = computed(() => {
    const r = this.result();
    const s = this.state();
    if (s.mode !== 'list' || !r || r.status !== 'ok') return null;
    return TransformEngine.list(s.pattern, s.listTemplate, s.text, r.matches, r.groupNames);
  });

  readonly code = computed(() => {
    const s = this.state();
    return s.mode === 'code' ? TransformEngine.code(s.pattern, s.replacement, s.text) : null;
  });

  readonly convertTarget = signal<FlavorId>('python');
  readonly conversion = computed(() => {
    const s = this.state();
    if (s.mode !== 'convert' || !this.analysis().valid) return null;
    return TransformEngine.convert(s.pattern, this.analysis().ast, this.convertTarget());
  });

  readonly notation = computed(() => DiagramEngine.toNotation(this.analysis().ast));
  readonly diagram = signal<DiagramImage & { loading: boolean }>({ loading: false });
  /** The diagram renders only while it is visible. */
  readonly diagramVisible = signal(true);

  readonly reference = computed(() => ReferenceAccess.quickReference(this.state().pattern.flavor));

  constructor() {
    // Run the pattern when anything that affects matching changes.
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const spec = this.pattern();
      const analysis = this.analysis();
      const version = this.textVersion();
      const text = untracked(() => this.state().text);
      clearTimeout(timer);
      const canRun = analysis.valid || (spec.flavor === 'ecmascript' && spec.source.length > 0);
      if (!canRun || spec.source.length === 0) {
        this.result.set(null);
        return;
      }
      // Small inputs feel instant; larger ones wait for a pause in typing.
      timer = setTimeout(async () => {
        this.running.set(true);
        const r = await this.matchEngine.run(spec, analysis, text, version);
        if (r) {
          this.result.set(r);
          this.running.set(false);
        }
      }, text.length > 200_000 ? 250 : 40);
    });

    let diagramTimer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const n = this.notation();
      const visible = this.diagramVisible();
      const valid = this.analysis().valid;
      clearTimeout(diagramTimer);
      if (!visible || !valid) return;
      if (n.empty) {
        this.diagram.set({ loading: false });
        return;
      }
      if (n.tooLarge) {
        this.diagram.set({ loading: false, error: 'This pattern is too large to draw.' });
        return;
      }
      untracked(() => this.diagram.update((d) => ({ ...d, loading: true })));
      diagramTimer = setTimeout(async () => {
        const img = await this.diagramAccess.render(n.source);
        if (this.notation() === n) this.diagram.set({ ...img, loading: false });
      }, 120);
    });
  }

  load(state: SessionState) {
    this.state.set(state);
    this.textVersion.update((v) => v + 1);
  }

  setPattern(pattern: PatternSpec) {
    this.state.update((s) => ({ ...s, pattern }));
  }

  setSource(source: string) {
    this.state.update((s) => ({ ...s, pattern: { ...s.pattern, source } }));
  }

  toggleFlag(letter: string) {
    this.state.update((s) => {
      const flags = s.pattern.flags.includes(letter) ? s.pattern.flags.replace(letter, '') : s.pattern.flags + letter;
      const order = dialectOf(s.pattern.flavor).flags.map((f) => f.letter);
      const sorted = [...flags].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join('');
      return { ...s, pattern: { ...s.pattern, flags: sorted } };
    });
  }

  /** Switches flavor, keeping the pattern and the flags the new flavor also has. */
  setFlavor(flavor: FlavorId) {
    this.state.update((s) => {
      const letters = dialectOf(flavor).flags.map((f) => f.letter);
      const flags = [...s.pattern.flags].filter((f) => letters.includes(f)).join('');
      return { ...s, pattern: { flavor, source: s.pattern.source, flags } };
    });
  }

  /** Switches flavor and converts the pattern to it. */
  convertTo(flavor: FlavorId) {
    const a = this.analysis();
    if (!a.valid) return this.setFlavor(flavor);
    const c = TransformEngine.convert(this.pattern(), a.ast, flavor);
    this.state.update((s) => ({ ...s, pattern: c.spec }));
  }

  setText(text: string) {
    this.state.update((s) => ({ ...s, text }));
    this.textVersion.update((v) => v + 1);
  }

  setMode(mode: Mode) {
    this.state.update((s) => ({ ...s, mode }));
  }

  update(patch: Partial<Pick<SessionState, 'replacement' | 'listTemplate' | 'tests' | 'inferInput'>>) {
    this.state.update((s) => ({ ...s, ...patch }));
  }

  addTest(text: string, expect: TestCase['expect']) {
    const tests = this.state().tests;
    const id = 't' + (Math.max(0, ...tests.map((t) => Number(t.id.slice(1)) || 0)) + 1);
    this.update({ tests: [...tests, { id, text, expect }] });
  }

  updateTest(id: string, patch: Partial<Omit<TestCase, 'id'>>) {
    this.update({ tests: this.state().tests.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  }

  removeTest(id: string) {
    this.update({ tests: this.state().tests.filter((t) => t.id !== id) });
  }
}
