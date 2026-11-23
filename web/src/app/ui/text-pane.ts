import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { LibraryManager } from '../managers/library.manager';
import { SynthesisManager } from '../managers/synthesis.manager';
import { WorkbenchManager } from '../managers/workbench.manager';
import { CodeEditor, EditorMark, TooltipContent } from './code-editor';
import { Icon } from './icon';
import { groupClass, UiState } from './ui-state';

const MAX_MARKED_MATCHES = 5_000;

/** The test text with every match and group highlighted in its group's colour. */
@Component({
  selector: 'rb-text-pane',
  imports: [CodeEditor, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header>
      <span class="label">Test text</span>
      <span class="muted size">{{ size() }}</span>
      <span class="spacer"></span>
      <button class="btn ghost" (click)="open()" title="Open a text file"><rb-icon name="file" /> Open file</button>
    </header>
    <div class="body" [class.dragging]="dragging()"
         (dragover)="$event.preventDefault(); dragging.set(true)" (dragleave)="dragging.set(false)" (drop)="drop($event)">
      <rb-code-editor
        class="editor"
        label="Test text"
        placeholder="Paste or type text to test the pattern against, or drop a file here."
        [lineNumbers]="true"
        [value]="wb.state().text"
        [marks]="marks()"
        [tooltip]="tooltip"
        [reveal]="reveal()"
        (changed)="wb.setText($event)"
      />
      @if (dragging()) {
        <div class="drop">Drop a text file to load it</div>
      }
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 0; }
    header { display: flex; align-items: center; gap: 10px; padding: 6px 8px 6px 14px; border-bottom: 1px solid var(--border); }
    .spacer { flex: 1; }
    .size { font-size: 12px; }
    .body { position: relative; flex: 1; min-height: 0; display: flex; }
    .editor { flex: 1; font-size: 14px; }
    .drop {
      position: absolute; inset: 8px; display: grid; place-items: center; border: 2px dashed var(--accent);
      border-radius: var(--radius); background: color-mix(in srgb, var(--accent-soft) 85%, transparent); font-weight: 600; pointer-events: none;
    }
  `,
})
export class TextPane {
  protected readonly wb = inject(WorkbenchManager);
  private readonly lib = inject(LibraryManager);
  private readonly synth = inject(SynthesisManager);
  private readonly ui = inject(UiState);
  protected readonly dragging = signal(false);

  protected readonly size = computed(() => {
    const t = this.wb.state().text;
    const lines = t ? t.split('\n').length : 0;
    return `${lines.toLocaleString()} line${lines === 1 ? '' : 's'} · ${t.length.toLocaleString()} chars`;
  });

  /** In debug mode the editor follows the debugger's position. */
  private readonly debugPos = computed(() => {
    if (this.wb.state().mode !== 'debug') return null;
    const t = this.synth.trace();
    return t?.steps[Math.min(this.ui.debugStep(), t.steps.length - 1)] ?? null;
  });

  protected readonly reveal = computed(() => this.debugPos()?.pos ?? null);

  protected readonly marks = computed<EditorMark[]>(() => {
    const step = this.debugPos();
    if (this.wb.state().mode === 'debug') {
      const t = this.synth.trace();
      const marks: EditorMark[] = [];
      if (t?.match) marks.push({ from: t.match.start, to: t.match.end, class: 'cm-match' });
      if (step) marks.push({ from: step.pos, to: step.pos, class: 'cm-debug-pos' });
      return marks;
    }
    const r = this.wb.result();
    if (!r || r.status !== 'ok') return [];
    const marks: EditorMark[] = [];
    const matches = r.matches.slice(0, MAX_MARKED_MATCHES);
    matches.forEach((m, i) => {
      marks.push({ from: m.start, to: m.end, class: i % 2 ? 'cm-match alt' : 'cm-match' });
      for (const g of m.groups) {
        if (g) marks.push({ from: g.start, to: g.end, class: `cm-group ${groupClass(g.index)}${g.start === g.end ? ' empty-group' : ''}` });
      }
    });
    return marks;
  });

  protected readonly tooltip = (pos: number): TooltipContent | null => {
    const r = this.wb.result();
    if (!r || r.status !== 'ok' || this.wb.state().mode === 'debug') return null;
    const idx = r.matches.findIndex((m) => m.start <= pos && pos < m.end);
    if (idx < 0) return null;
    const m = r.matches[idx];
    const text = this.wb.state().text;
    return {
      from: m.start,
      to: m.end,
      render: () => {
        const el = (tag: string, cls: string, content = '') => {
          const e = document.createElement(tag);
          e.className = cls;
          e.textContent = content;
          return e;
        };
        const div = document.createElement('div');
        const title = el('div', 'tt-title', `Match ${idx + 1}`);
        title.append(el('span', 'tt-muted', `${m.start}–${m.end}`));
        div.append(title);
        const grid = el('div', 'tt-grid');
        m.groups.forEach((g, i) => {
          const gc = groupClass(i + 1);
          const name = g?.name ?? r.groupNames[i + 1];
          grid.append(el('span', `swatch ${gc}`), el('span', 'tt-name', name ? `${i + 1} · ${name}` : `${i + 1}`));
          const value = g ? text.slice(g.start, g.end) : null;
          const shown = value === null ? 'did not participate' : value.length > 80 ? value.slice(0, 80) + '…' : value || '(empty)';
          grid.append(el('span', `tt-value ${gc}${value === null || value === '' ? ' none' : ''}`, shown));
        });
        if (m.groups.length) div.append(grid);
        return div;
      },
    };
  };

  protected async open() {
    try {
      const f = await this.lib.openFile();
      if (f) {
        this.wb.setText(f.text);
        this.ui.notify(`Loaded ${f.name}`);
      }
    } catch (e) {
      this.ui.notify((e as Error).message, 'error');
    }
  }

  protected async drop(e: DragEvent) {
    e.preventDefault();
    this.dragging.set(false);
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    try {
      const f = await this.lib.readDroppedFile(file);
      this.wb.setText(f.text);
      this.ui.notify(`Loaded ${f.name}`);
    } catch (err) {
      this.ui.notify((err as Error).message, 'error');
    }
  }
}
