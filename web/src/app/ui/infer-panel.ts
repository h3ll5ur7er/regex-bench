import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SynthesisManager } from '../managers/synthesis.manager';
import { WorkbenchManager } from '../managers/workbench.manager';
import { CodeEditor, EditorMark } from './code-editor';
import { Icon } from './icon';
import { groupClass, UiState } from './ui-state';

/** Regex from data: paste examples, select the parts you care about, get a pattern (US-11). */
@Component({
  selector: 'rb-infer-panel',
  imports: [CodeEditor, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid">
      <div class="input">
        <div class="head">
          <span class="label">Examples, one per line</span>
          <span class="spacer"></span>
          @if (selection(); as sel) {
            <input class="field mono name" placeholder="group name (optional)" [value]="name()" (input)="name.set($any($event.target).value)"
              (keydown.enter)="mark()" aria-label="Group name" />
            <button class="btn primary" (click)="mark()"><rb-icon name="plus" /> Capture "{{ sel.text }}"</button>
          } @else {
            <span class="muted small">Select a part of a line to capture it as a group.</span>
          }
        </div>
        <rb-code-editor class="editor" label="Examples" [lineNumbers]="true" placeholder="2026-11-23 INFO  api/v1/users 200 12ms"
          [value]="wb.state().inferInput" [marks]="marks()" (changed)="onInput($event)" (selected)="onSelect($event)" />
      </div>
      <div class="result">
        @if (synth.inferred(); as inf) {
          @if (inf.spec) {
            <div class="pattern">
              <code class="mono">{{ inf.spec.source }}</code>
            </div>
            <div class="coverage" [class.partial]="covered() < inf.result.lineCount">
              <rb-icon [name]="covered() === inf.result.lineCount ? 'check' : 'x'" />
              Matches {{ covered() }} of {{ inf.result.lineCount }} lines
            </div>
            <div class="options">
              <label><input type="checkbox" [checked]="synth.inferOptions().exactLengths" (change)="opt('exactLengths', $any($event.target).checked)" /> Exact lengths</label>
              <label><input type="checkbox" [checked]="synth.inferOptions().enumerations" (change)="opt('enumerations', $any($event.target).checked)" /> Word lists</label>
              <label><input type="checkbox" [checked]="synth.inferOptions().anchored" (change)="opt('anchored', $any($event.target).checked)" /> Whole line</label>
            </div>
            <ol class="columns">
              @for (c of inf.result.columns; track $index) {
                <li>
                  <code class="mono">{{ c.pattern }}{{ c.optional ? '?' : '' }}</code>
                  <span class="muted">{{ c.examples.join(' · ') }}</span>
                </li>
              }
            </ol>
            <div class="actions">
              @if (synth.marks().length) {
                <button class="btn ghost" (click)="synth.clearMarks()">Clear captures</button>
              }
              <span class="spacer"></span>
              <button class="btn primary" (click)="apply()"><rb-icon name="wand" /> Use this pattern</button>
            </div>
          } @else {
            <p class="muted">Paste a few example lines on the left.</p>
          }
        }
      </div>
    </div>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 12px; height: 100%; min-height: 220px; }
    .input { display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); }
    .head { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px; border-bottom: 1px solid var(--border); min-height: 44px; }
    .name { width: 150px; height: 28px; }
    .head .btn { height: 28px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
    .editor { flex: 1; font-size: 13.5px; }
    .spacer { flex: 1; }
    .small { font-size: 12px; }
    .result { display: flex; flex-direction: column; gap: 10px; min-width: 0; overflow: auto; }
    .pattern { padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
    .pattern code { font-size: 14.5px; word-break: break-all; }
    .coverage { display: flex; gap: 6px; align-items: center; color: var(--ok); font-weight: 600; font-size: 13px; }
    .coverage.partial { color: var(--err); }
    .options { display: flex; gap: 14px; font-size: 13px; color: var(--text-2); flex-wrap: wrap; }
    .options input { accent-color: var(--accent); }
    .columns { margin: 0; padding-left: 22px; font-size: 12.5px; display: grid; gap: 2px; }
    .columns li code { color: var(--accent); margin-right: 8px; }
    .actions { display: flex; gap: 8px; align-items: center; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  `,
})
export class InferPanel {
  protected readonly wb = inject(WorkbenchManager);
  protected readonly synth = inject(SynthesisManager);
  private readonly ui = inject(UiState);
  protected readonly selection = signal<{ line: number; start: number; end: number; text: string } | null>(null);
  protected readonly name = signal('');

  protected readonly covered = computed(() => this.synth.inferred()?.result.coverage.filter(Boolean).length ?? 0);

  /** Line start offsets of the non-empty example lines, as the engine numbers them. */
  private readonly lineStarts = computed(() => {
    const starts: number[] = [];
    let offset = 0;
    for (const l of this.wb.state().inferInput.split('\n')) {
      if (l.replace(/\r$/, '').length > 0) starts.push(offset);
      offset += l.length + 1;
    }
    return starts;
  });

  protected readonly marks = computed<EditorMark[]>(() =>
    this.synth.marks().map((m, i) => {
      const base = this.lineStarts()[m.line] ?? 0;
      return { from: base + m.start, to: base + m.end, class: `cm-mark ${groupClass(i + 1)}` };
    }),
  );

  protected onInput(text: string) {
    this.wb.update({ inferInput: text });
    this.synth.clearMarks();
  }

  protected onSelect({ from, to }: { from: number; to: number }) {
    if (to <= from) return this.selection.set(null);
    const starts = this.lineStarts();
    const text = this.wb.state().inferInput;
    let line = -1;
    for (let i = 0; i < starts.length; i++) if (starts[i] <= from) line = i;
    if (line < 0) return this.selection.set(null);
    const lineStart = starts[line];
    const lineEnd = text.indexOf('\n', lineStart) === -1 ? text.length : text.indexOf('\n', lineStart);
    if (to > lineEnd) return this.selection.set(null);
    this.selection.set({ line, start: from - lineStart, end: to - lineStart, text: text.slice(from, to) });
  }

  protected mark() {
    const s = this.selection();
    if (!s) return;
    const name = this.name().trim().replace(/[^\p{L}\p{N}_]/gu, '_');
    this.synth.addMark({ line: s.line, start: s.start, end: s.end, name: name && /^[\p{L}_]/u.test(name) ? name : undefined });
    this.selection.set(null);
    this.name.set('');
  }

  protected opt(key: 'exactLengths' | 'enumerations' | 'anchored', value: boolean) {
    this.synth.inferOptions.update((o) => ({ ...o, [key]: value }));
  }

  protected apply() {
    const session = this.synth.inferredSession();
    if (!session) return;
    this.wb.load(session);
    this.ui.notify('Pattern applied. Your examples are now the test text.');
  }
}
