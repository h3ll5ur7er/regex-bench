import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FlavorId, Mode } from '../contracts';
import { FLAVORS } from '../engines/syntax/dialects';
import { LibraryManager } from '../managers/library.manager';
import { SynthesisManager } from '../managers/synthesis.manager';
import { WorkbenchManager } from '../managers/workbench.manager';
import { CodeEditor, EditorMark } from './code-editor';
import { DebugPanel } from './debug-panel';
import { Icon } from './icon';
import { InferPanel } from './infer-panel';
import { UiState } from './ui-state';

interface ToolTab {
  mode: Mode;
  label: string;
  key: string;
}

export const TOOL_TABS: ToolTab[] = [
  { mode: 'replace', label: 'Replace', key: '1' },
  { mode: 'list', label: 'List', key: '2' },
  { mode: 'tests', label: 'Tests', key: '3' },
  { mode: 'debug', label: 'Debug', key: '4' },
  { mode: 'code', label: 'Code', key: '5' },
  { mode: 'convert', label: 'Convert', key: '6' },
  { mode: 'infer', label: 'From data', key: '7' },
];

/** The tools below the text: what to do with the matches. */
@Component({
  selector: 'rb-tools-panel',
  imports: [CodeEditor, Icon, DebugPanel, InferPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav role="tablist" aria-label="Tools">
      @for (t of tabs; track t.mode) {
        <button role="tab" [attr.aria-selected]="mode() === t.mode" [class.on]="mode() === t.mode" (click)="toggle(t.mode)"
          [title]="t.label + ' (Alt+' + t.key + ')'">
          {{ t.label }}
          @if (t.mode === 'tests' && testSummary(); as s) {
            <span class="pill" [class.bad]="s.failed">{{ s.passed }}/{{ s.total }}</span>
          }
        </button>
      }
    </nav>
    @if (mode() !== 'match') {
      <div class="panel">
        @switch (mode()) {
          @case ('replace') {
            <div class="row">
              <span class="label">With</span>
              <rb-code-editor class="template" label="Replacement template" [singleLine]="true" placeholder="Replacement, e.g. $1"
                [value]="wb.state().replacement" (changed)="wb.update({ replacement: $event })" />
              <span class="hint muted">{{ replaceHint() }}</span>
            </div>
            <div class="output">
              <rb-code-editor class="out" label="Result" [readOnly]="true" [lineNumbers]="true" [value]="wb.replaceOutput()?.text ?? ''" [marks]="replaceMarks()" />
              <button class="btn copy" (click)="copy(wb.replaceOutput()?.text ?? '')"><rb-icon name="copy" /> Copy</button>
            </div>
          }
          @case ('list') {
            <div class="row">
              <span class="label">Each match as</span>
              <rb-code-editor class="template" label="List template" [singleLine]="true" placeholder="e.g. $1\\t$2\\n"
                [value]="wb.state().listTemplate" (changed)="wb.update({ listTemplate: $event })" />
              <span class="hint muted">\\n, \\t work here</span>
            </div>
            <div class="output">
              <rb-code-editor class="out" label="List" [readOnly]="true" [lineNumbers]="true" [value]="wb.listOutput()?.text ?? ''" />
              <div class="actions">
                <button class="btn" (click)="copy(wb.listOutput()?.text ?? '')"><rb-icon name="copy" /> Copy</button>
                <button class="btn" (click)="lib.download('matches.txt', wb.listOutput()?.text ?? '')"><rb-icon name="download" /> Save</button>
              </div>
            </div>
          }
          @case ('tests') {
            <div class="tests">
              @for (t of wb.state().tests; track t.id) {
                <div class="test" [class]="outcome(t.id)?.status ?? ''">
                  <span class="badge">{{ badge(t.id) }}</span>
                  <select class="field" [value]="t.expect" (change)="wb.updateTest(t.id, { expect: $any($event.target).value })" aria-label="Expectation">
                    <option value="match">should match</option>
                    <option value="full-match">should match fully</option>
                    <option value="no-match">should not match</option>
                  </select>
                  <input class="field mono" [value]="t.text" (input)="wb.updateTest(t.id, { text: $any($event.target).value })" aria-label="Test text" />
                  <span class="detail muted">{{ outcome(t.id)?.detail }}</span>
                  <button class="btn ghost icon" title="Remove" (click)="wb.removeTest(t.id)"><rb-icon name="trash" /></button>
                </div>
              }
              <div class="test-actions">
                <button class="btn" (click)="wb.addTest('', 'match')"><rb-icon name="plus" /> Add test</button>
                <span class="muted">Tests run on every change. A failing test turns red.</span>
              </div>
            </div>
          }
          @case ('debug') {
            <rb-debug-panel />
          }
          @case ('code') {
            @if (wb.code(); as c) {
              <div class="output">
                <pre class="code mono"><span class="lang label">{{ c.language }}</span>{{ c.code }}</pre>
                <button class="btn copy" (click)="copy(c.code)"><rb-icon name="copy" /> Copy</button>
              </div>
            }
          }
          @case ('convert') {
            <div class="row">
              <span class="label">To</span>
              <div class="chips">
                @for (f of flavors; track f.id) {
                  @if (f.id !== wb.pattern().flavor) {
                    <button class="chip" [class.on]="wb.convertTarget() === f.id" (click)="wb.convertTarget.set(f.id)">{{ f.name }}</button>
                  }
                }
              </div>
            </div>
            @if (wb.conversion(); as c) {
              <div class="converted">
                <code class="mono big">{{ c.spec.source }}</code>
                @if (c.spec.flags) {
                  <span class="muted mono">flags: {{ c.spec.flags }}</span>
                }
                <span class="spacer"></span>
                <button class="btn" (click)="copy(c.spec.source)"><rb-icon name="copy" /> Copy</button>
                <button class="btn primary" (click)="switchTo(wb.convertTarget())">Switch to {{ targetName() }}</button>
              </div>
              @if (c.diagnostics.length) {
                <ul class="notes">
                  @for (d of c.diagnostics; track d.message) {
                    <li [class]="d.severity">{{ d.message }}</li>
                  }
                </ul>
              } @else {
                <p class="muted">Converts exactly: same matches, same groups.</p>
              }
            } @else {
              <p class="muted">Fix the pattern's errors to convert it.</p>
            }
          }
          @case ('infer') {
            <rb-infer-panel />
          }
        }
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 0; }
    nav { display: flex; gap: 2px; padding: 6px 8px; border-top: 1px solid var(--border); flex-wrap: wrap; }
    nav button {
      border: 0; background: transparent; padding: 5px 10px; border-radius: 6px; cursor: pointer; color: var(--text-2); font-weight: 500;
      display: inline-flex; gap: 6px; align-items: center;
      &:hover { background: var(--surface-2); color: var(--text); }
      &.on { background: var(--accent-soft); color: var(--accent); }
    }
    .pill { font-size: 11px; padding: 0 6px; border-radius: 10px; background: var(--ok-soft); color: var(--ok); font-weight: 600; }
    .pill.bad { background: var(--err-soft); color: var(--err); }
    .panel { flex: 1; min-height: 0; overflow: auto; padding: 8px 12px 12px; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border); }
    .row { display: flex; align-items: center; gap: 10px; }
    .template { flex: 1; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); font-size: 14px; }
    .template:focus-within { border-color: var(--accent); }
    .hint { font-size: 12px; white-space: nowrap; }
    .output { position: relative; flex: 1; min-height: 80px; display: flex; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); }
    .out { flex: 1; font-size: 13.5px; }
    .copy, .actions { position: absolute; top: 6px; right: 6px; }
    .actions { display: flex; gap: 6px; }
    .tests { display: grid; gap: 6px; }
    .test { display: grid; grid-template-columns: 22px 170px minmax(120px, 1fr) minmax(0, 1fr) 32px; gap: 8px; align-items: center; }
    .badge { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; background: var(--surface-3); color: var(--text-3); }
    .pass .badge { background: var(--ok-soft); color: var(--ok); }
    .fail .badge, .error .badge { background: var(--err-soft); color: var(--err); }
    .fail input { border-color: var(--err); }
    .detail { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .test-actions { display: flex; gap: 12px; align-items: center; font-size: 12px; margin-top: 4px; }
    .code { margin: 0; padding: 32px 14px 14px; overflow: auto; flex: 1; font-size: 13px; line-height: 1.55; position: relative; }
    .lang { position: absolute; top: 10px; left: 14px; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .chip {
      border: 1px solid var(--border); background: var(--surface); padding: 4px 10px; border-radius: 16px; cursor: pointer; font-size: 13px;
      &.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 600; }
    }
    .converted { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); flex-wrap: wrap; }
    .big { font-size: 15px; word-break: break-all; }
    .spacer { flex: 1; }
    .notes { margin: 0; padding-left: 18px; font-size: 13px; li.error { color: var(--err); } li.warning { color: var(--warn); } li.info { color: var(--text-2); } }
  `,
})
export class ToolsPanel {
  protected readonly wb = inject(WorkbenchManager);
  protected readonly synth = inject(SynthesisManager);
  protected readonly lib = inject(LibraryManager);
  private readonly ui = inject(UiState);
  protected readonly tabs = TOOL_TABS;
  protected readonly flavors = FLAVORS;
  protected readonly mode = computed(() => this.wb.state().mode);

  protected readonly replaceHint = computed(() => {
    switch (this.wb.dialect().replacement) {
      case 'ecmascript': return '$1  $<name>  $&  $$';
      case 'python': return '\\1  \\g<name>';
      case 'pcre': return '$1  \\1  ${1}';
      case 'java': return '$1  ${name}  \\$';
      case 'dotnet': return '$1  ${name}  $&  $$';
      case 'rust': return '$1  $name  ${name}  $$';
    }
  });

  protected readonly replaceMarks = computed<EditorMark[]>(() =>
    (this.wb.replaceOutput()?.spans ?? []).slice(0, 5000).map((s) => ({ from: s.start, to: s.end, class: 'cm-replaced' })),
  );

  protected readonly testSummary = computed(() => {
    const o = [...this.synth.testOutcomes().values()];
    if (!o.length || this.wb.state().tests.length === 0) return null;
    const passed = o.filter((x) => x.status === 'pass').length;
    return { passed, failed: o.some((x) => x.status === 'fail' || x.status === 'error'), total: this.wb.state().tests.length };
  });

  protected readonly targetName = computed(() => FLAVORS.find((f) => f.id === this.wb.convertTarget())?.name ?? '');

  protected outcome(id: string) {
    return this.synth.testOutcomes().get(id);
  }

  protected badge(id: string): string {
    const s = this.outcome(id)?.status;
    return s === 'pass' ? '✓' : s === 'fail' ? '✗' : s === 'error' ? '!' : '·';
  }

  toggle(mode: Mode) {
    this.wb.setMode(this.mode() === mode ? 'match' : mode);
  }

  protected async copy(text: string) {
    this.ui.notify((await this.lib.copy(text)) ? 'Copied' : 'Copy failed', 'ok');
  }

  protected switchTo(f: FlavorId) {
    this.wb.convertTo(f);
    this.wb.setMode('match');
  }
}
