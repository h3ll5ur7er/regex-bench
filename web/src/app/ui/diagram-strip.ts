import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { WorkbenchManager } from '../managers/workbench.manager';
import { Icon } from './icon';
import { UiState } from './ui-state';

/** The railroad diagram of the pattern, right under it: structure at a glance (US-05). */
@Component({
  selector: 'rb-diagram-strip',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header>
      <button class="toggle" (click)="ui.setDiagramOpen(!ui.diagramOpen())" [attr.aria-expanded]="ui.diagramOpen()">
        <rb-icon name="chevron" [class.closed]="!ui.diagramOpen()" />
        <span class="label">Railroad diagram</span>
      </button>
      @if (ui.diagramOpen() && d().url) {
        <span class="spacer"></span>
        <div class="zoom" role="group" aria-label="Zoom">
          <button class="btn ghost" [class.on]="zoom() === 'fit'" (click)="zoom.set('fit')">Fit</button>
          <button class="btn ghost" [class.on]="zoom() === '1'" (click)="zoom.set('1')">100%</button>
          <button class="btn ghost" [class.on]="zoom() === '1.5'" (click)="zoom.set('1.5')">150%</button>
        </div>
      }
    </header>
    @if (ui.diagramOpen()) {
      <div class="canvas" [class.loading]="d().loading">
        @if (d().error) {
          <p class="msg">{{ d().error }}</p>
        } @else if (d().url) {
          <img [src]="d().url" [style.width]="width()" [style.max-width]="zoom() === 'fit' ? '100%' : 'none'" alt="Railroad diagram of the pattern" />
        } @else if (d().loading) {
          <p class="msg">Drawing…</p>
        } @else {
          <p class="msg">The structure of your pattern is drawn here.</p>
        }
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    header { display: flex; align-items: center; gap: 8px; }
    .spacer { flex: 1; }
    .toggle {
      display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; cursor: pointer; padding: 4px 6px 4px 2px; border-radius: 6px;
      color: var(--text-3);
      &:hover { color: var(--text); }
    }
    rb-icon { transition: transform .15s; }
    rb-icon.closed { transform: rotate(-90deg); }
    .zoom .btn { height: 24px; padding: 0 8px; font-size: 12px; color: var(--text-3); }
    .zoom .btn.on { color: var(--text); background: var(--surface-3); }
    .canvas {
      margin-top: 4px; overflow: auto; max-height: 220px; min-height: 64px; padding: 8px 12px;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
      display: flex; align-items: center; transition: opacity .2s;
    }
    .canvas.loading img { opacity: .5; }
    img { display: block; height: auto; }
    img { mix-blend-mode: multiply; }
    :host-context([data-theme='dark']) img { filter: invert(1) hue-rotate(180deg) brightness(.9); mix-blend-mode: screen; }
    @media (prefers-color-scheme: dark) {
      :host-context(:root:not([data-theme='light'])) img { filter: invert(1) hue-rotate(180deg) brightness(.9); mix-blend-mode: screen; }
    }
    .msg { margin: 0; color: var(--text-3); font-size: 13px; }
  `,
})
export class DiagramStrip {
  protected readonly wb = inject(WorkbenchManager);
  protected readonly ui = inject(UiState);
  protected readonly d = this.wb.diagram;
  protected readonly zoom = signal<'fit' | '1' | '1.5'>('fit');
  protected readonly width = computed(() => {
    const w = this.d().width;
    if (!w || this.zoom() === 'fit') return w ? `${w}px` : 'auto';
    return `${w * Number(this.zoom()) * 1.25}px`;
  });

  constructor() {
    effect(() => this.wb.diagramVisible.set(this.ui.diagramOpen()));
  }
}
