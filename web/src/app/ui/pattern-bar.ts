import { ChangeDetectionStrategy, Component, computed, effect, inject, viewChild } from '@angular/core';
import { ExplainNode } from '../contracts';
import { SynthesisManager } from '../managers/synthesis.manager';
import { WorkbenchManager } from '../managers/workbench.manager';
import { CodeEditor, EditorMark, TooltipContent } from './code-editor';
import { Icon } from './icon';
import { groupClass, UiState } from './ui-state';

/** The hero of the page: the pattern, its flags and what it currently does. */
@Component({
  selector: 'rb-pattern-bar',
  imports: [CodeEditor, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar" [class.invalid]="hasError()">
      <span class="delim" aria-hidden="true">/</span>
      <rb-code-editor
        #editor
        class="editor"
        label="Regular expression"
        placeholder="Type a regular expression…"
        [singleLine]="!extended()"
        [value]="wb.pattern().source"
        [marks]="marks()"
        [tooltip]="tooltip"
        (changed)="wb.setSource($event)"
      />
      <span class="delim" aria-hidden="true">/</span>
      <div class="flags" role="group" aria-label="Flags">
        @for (f of wb.dialect().flags; track f.letter) {
          <button
            class="flag mono"
            [class.on]="wb.pattern().flags.includes(f.letter)"
            [attr.aria-pressed]="wb.pattern().flags.includes(f.letter)"
            [title]="f.name + ': ' + f.description"
            (click)="wb.toggleFlag(f.letter)"
          >{{ f.letter }}</button>
        }
      </div>
    </div>
    <div class="status-row">
      <div class="status" [class]="status().kind" aria-live="polite">
        <span class="dot"></span>
        <span>{{ status().text }}</span>
        @if (status().detail) {
          <span class="muted">· {{ status().detail }}</span>
        }
      </div>
      @if (offered(); as o) {
        <div class="offer">
          <span>This pattern looks like <b>{{ o.from }}</b> syntax.</span>
          <code class="mono">{{ o.spec.source }}</code>
          <button class="btn primary" (click)="acceptOffer()">Convert</button>
          <button class="btn ghost icon" title="Dismiss" (click)="ui.offeredConversion.set(null)"><rb-icon name="x" /></button>
        </div>
      }
    </div>
    @if (wb.diagnostics().length) {
      <ul class="diagnostics">
        @for (d of wb.diagnostics(); track d.message) {
          <li [class]="d.severity" (mouseenter)="ui.hoverSpan.set(d.span ?? null)" (mouseleave)="ui.hoverSpan.set(null)">
            <span class="sev">{{ d.severity === 'error' ? 'Error' : d.severity === 'warning' ? 'Warning' : 'Note' }}</span>
            <span>{{ d.message }}</span>
            @if (d.hint) {
              <span class="hint">{{ d.hint }}</span>
            }
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host { display: block; }
    .bar {
      display: flex; align-items: center; gap: 2px;
      background: var(--surface); border: 1.5px solid var(--border-strong); border-radius: 12px;
      padding: 4px 6px 4px 14px; box-shadow: var(--shadow);
      transition: border-color .15s, box-shadow .15s;
      &:focus-within { border-color: var(--accent); box-shadow: var(--shadow), var(--focus); }
      &.invalid { border-color: var(--err); }
    }
    .delim { font: 500 22px var(--font-code); color: var(--text-3); user-select: none; }
    .editor { flex: 1; min-width: 0; font-size: 19px; max-height: 40vh; overflow: auto; }
    .editor ::ng-deep .cm-content { padding: 8px 0; }
    .editor ::ng-deep .cm-line { padding: 0 6px; }
    .flags { display: flex; gap: 2px; padding-left: 6px; border-left: 1px solid var(--border); margin-left: 6px; }
    .flag {
      width: 28px; height: 30px; border: 0; border-radius: 6px; background: transparent; color: var(--text-3);
      font-size: 14px; font-weight: 600; cursor: pointer;
      &:hover { background: var(--surface-2); color: var(--text); }
      &.on { background: var(--accent-soft); color: var(--accent); }
    }
    @media (max-width: 640px) {
      .bar { flex-wrap: wrap; padding-left: 10px; }
      .editor { flex: 1 1 calc(100% - 40px); }
      .flags { width: 100%; margin: 2px 0 0; padding: 4px 0 0; border-left: 0; border-top: 1px solid var(--border); justify-content: space-between; }
    }
    .status-row { display: flex; align-items: center; gap: 12px; min-height: 30px; margin-top: 6px; flex-wrap: wrap; }
    .status { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--text-2); font-weight: 500; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-3); }
    .status.ok .dot { background: var(--ok); }
    .status.none .dot { background: var(--text-3); }
    .status.error .dot, .status.timeout .dot { background: var(--err); }
    .status.running .dot { background: var(--accent); animation: pulse 1s infinite; }
    @keyframes pulse { 50% { opacity: .3; } }
    .offer {
      display: flex; align-items: center; gap: 8px; padding: 3px 4px 3px 12px; border-radius: 8px;
      background: var(--accent-soft); font-size: 13px;
      code { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .btn { height: 26px; }
    }
    .diagnostics { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 4px; }
    .diagnostics li {
      display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; padding: 6px 10px; border-radius: 8px; font-size: 13px;
      &.error { background: var(--err-soft); }
      &.warning { background: var(--warn-soft); }
      &.info { background: var(--surface-2); }
    }
    .sev { font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
    .error .sev { color: var(--err); }
    .warning .sev { color: var(--warn); }
    .hint { color: var(--text-2); }
  `,
})
export class PatternBar {
  protected readonly wb = inject(WorkbenchManager);
  protected readonly ui = inject(UiState);
  private readonly synth = inject(SynthesisManager);
  private readonly editor = viewChild.required<CodeEditor>('editor');

  protected readonly extended = computed(() => this.wb.pattern().flags.includes('x') || this.wb.pattern().source.includes('\n'));
  protected readonly hasError = computed(() => this.wb.diagnostics().some((d) => d.severity === 'error'));
  /** The offer only stands while the pattern is the one it was made for. */
  protected readonly offered = computed(() => {
    const o = this.ui.offeredConversion();
    const p = this.wb.pattern();
    return o && o.original.source === p.source && o.original.flavor === p.flavor ? o : null;
  });

  protected readonly status = computed(() => {
    const r = this.wb.result();
    const src = this.wb.pattern().source;
    if (!src) return { kind: 'none', text: 'Type a pattern to start', detail: '' };
    if (!this.wb.analysis().valid && this.wb.pattern().flavor !== 'ecmascript') return { kind: 'error', text: 'Fix the pattern to run it', detail: '' };
    if (!r) return { kind: 'running', text: 'Running…', detail: '' };
    const backend = r.backend === 'native' ? "browser's engine" : r.backend === 'rust' ? 'Rust regex (WASM)' : `browser's engine, translated`;
    const time = r.elapsedMs < 0.05 ? '< 0.1 ms' : r.elapsedMs < 1 ? `${r.elapsedMs.toFixed(2)} ms` : `${r.elapsedMs.toFixed(1)} ms`;
    if (r.status === 'timeout') return { kind: 'timeout', text: 'Stopped: too slow', detail: backend };
    if (r.status === 'error') return { kind: 'error', text: 'The engine rejected the pattern', detail: backend };
    const n = r.matches.length;
    const text = n === 0 ? 'No match' : `${n.toLocaleString()}${r.capped ? '+' : ''} match${n === 1 ? '' : 'es'}`;
    return { kind: n ? 'ok' : 'none', text, detail: `${time} · ${backend}` };
  });

  /** Flattened explanation nodes, to find what the cursor points at. */
  private readonly flatExplain = computed(() => {
    const out: ExplainNode[] = [];
    const walk = (nodes: ExplainNode[]) => nodes.forEach((n) => (out.push(n), walk(n.children)));
    walk(this.wb.analysis().explanation);
    return out;
  });

  protected readonly marks = computed<EditorMark[]>(() => {
    const a = this.wb.analysis();
    const marks: EditorMark[] = a.tokens.map((t) => ({
      from: t.span.start,
      to: t.span.end,
      class: `tk-${t.kind} ${t.group ? 'has-group ' + groupClass(t.group) : ''}`,
    }));
    for (const d of this.wb.diagnostics()) {
      if (d.span && d.severity !== 'info') marks.push({ from: d.span.start, to: Math.max(d.span.end, d.span.start + 1), class: `cm-diag-${d.severity}` });
    }
    const h = this.ui.hoverSpan();
    if (h) marks.push({ from: h.start, to: h.end, class: 'cm-hl' });
    if (this.wb.state().mode === 'debug') {
      const t = this.synth.trace();
      const step = t?.steps[Math.min(this.ui.debugStep(), t.steps.length - 1)];
      if (step && step.kind !== 'start' && step.kind !== 'success') {
        marks.push({ from: step.span.start, to: step.span.end, class: `cm-debug-pattern${step.kind === 'fail' || step.kind === 'backtrack' ? ' cm-debug-fail' : ''}` });
      }
    }
    return marks;
  });

  protected readonly tooltip = (pos: number): TooltipContent | null => {
    const node = this.flatExplain()
      .filter((n) => n.span.start <= pos && pos < n.span.end)
      .sort((a, b) => a.span.end - a.span.start - (b.span.end - b.span.start))[0];
    if (!node) return null;
    return {
      from: node.span.start,
      to: node.span.end,
      render: () => {
        const div = document.createElement('div');
        const code = document.createElement('div');
        code.className = 'tt-row';
        code.textContent = node.code;
        const text = document.createElement('div');
        text.textContent = node.text;
        div.append(code, text);
        return div;
      },
    };
  };

  constructor() {
    effect(() => {
      const req = this.ui.patternInsert();
      if (req) this.editor().insert(req.text);
    });
    effect(() => {
      const req = this.ui.patternSelect();
      if (req) this.editor().selectRange(req.span.start, req.span.end);
    });
  }

  focus() {
    this.editor().focus();
  }

  protected acceptOffer() {
    const o = this.ui.offeredConversion();
    if (!o) return;
    this.wb.setPattern(o.spec);
    this.ui.offeredConversion.set(null);
  }
}
