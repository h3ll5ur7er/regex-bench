import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ExplainNode } from '../contracts';
import { WorkbenchManager } from '../managers/workbench.manager';
import { groupClass, SideTab, UiState } from './ui-state';

const MAX_LISTED = 500;

/** A recursive explanation tree; hovering a row highlights its tokens in the pattern. */
@Component({
  selector: 'rb-explain-tree',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul [class.root]="root()">
      @for (n of nodes(); track $index) {
        <li>
          <div class="row" (mouseenter)="ui.hoverSpan.set(n.span)" (mouseleave)="ui.hoverSpan.set(null)" (click)="ui.selectInPattern(n.span)">
            <code class="code mono" [class]="'tk-' + n.kind + ' ' + (n.group ? 'has-group ' + gc(n.group) : '')">
              @if (n.group) {
                <span class="swatch"></span>
              }
              {{ n.code || '∅' }}
            </code>
            <span class="text">{{ n.text }}</span>
          </div>
          @if (n.children.length) {
            <rb-explain-tree [nodes]="n.children" [root]="false" />
          }
        </li>
      }
    </ul>
  `,
  styles: `
    ul { list-style: none; margin: 0; padding: 0 0 0 16px; border-left: 1px dashed var(--border); margin-left: 9px; }
    ul.root { padding: 0; border: 0; margin: 0; }
    .row { display: flex; gap: 10px; align-items: baseline; padding: 4px 8px; border-radius: 6px; cursor: pointer; }
    .row:hover { background: var(--surface-2); }
    .code {
      display: inline-flex; align-items: center; gap: 5px; flex: none; max-width: 45%; overflow: hidden; text-overflow: ellipsis;
      white-space: pre; padding: 1px 6px; border-radius: 5px; background: var(--surface-2); font-size: 12.5px;
    }
    .text { color: var(--text-2); font-size: 13px; }
  `,
})
export class ExplainTree {
  readonly nodes = input.required<ExplainNode[]>();
  readonly root = input(true);
  protected readonly ui = inject(UiState);
  protected readonly gc = groupClass;
}

/** Explanation, match details and the quick reference, side by side with the text. */
@Component({
  selector: 'rb-side-panel',
  imports: [ExplainTree],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav role="tablist">
      @for (t of tabs; track t.id) {
        <button role="tab" [attr.aria-selected]="ui.sideTab() === t.id" [class.on]="ui.sideTab() === t.id" (click)="ui.sideTab.set(t.id)">
          {{ t.label }}
          @if (t.id === 'matches' && matchCount()) {
            <span class="count">{{ matchCount() }}</span>
          }
        </button>
      }
    </nav>
    <div class="content">
      @switch (ui.sideTab()) {
        @case ('explain') {
          @if (wb.analysis().explanation.length) {
            <rb-explain-tree [nodes]="wb.analysis().explanation" />
          } @else {
            <p class="empty">The explanation of your pattern appears here, token by token.</p>
          }
        }
        @case ('matches') {
          @if (matches().length) {
            <ol class="matches">
              @for (m of matches(); track m.index) {
                <li>
                  <div class="mhead">
                    <span class="swatch g0"></span>
                    <b>Match {{ m.index + 1 }}</b>
                    <span class="muted mono">{{ m.start }}–{{ m.end }}</span>
                  </div>
                  <div class="value mono">{{ m.value }}</div>
                  @for (g of m.groups; track g.label) {
                    <div class="grow" [class]="gc(g.index)">
                      <span class="swatch"></span>
                      <span class="gname">{{ g.label }}</span>
                      <span class="mono gval" [class.none]="g.value === null">{{ g.value === null ? 'did not participate' : g.value }}</span>
                    </div>
                  }
                </li>
              }
            </ol>
            @if (hidden()) {
              <p class="muted more">and {{ hidden().toLocaleString() }} more matches</p>
            }
          } @else {
            <p class="empty">Matches and their groups are listed here.</p>
          }
        }
        @case ('reference') {
          <p class="muted ref-intro">{{ wb.dialect().name }} · click to insert</p>
          @for (s of wb.reference(); track s.id) {
            <section>
              <h3 class="label">{{ s.title }}</h3>
              @for (e of s.entries; track e.token) {
                <button class="entry" (click)="ui.insertIntoPattern(e.token)" [title]="e.description">
                  <code class="mono">{{ e.token }}</code>
                  <span>{{ e.title }}</span>
                </button>
              }
            </section>
          }
        }
      }
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 0; }
    nav { display: flex; gap: 2px; padding: 6px 8px; border-bottom: 1px solid var(--border); }
    nav button {
      border: 0; background: transparent; padding: 5px 10px; border-radius: 6px; cursor: pointer; color: var(--text-2); font-weight: 500;
      display: inline-flex; gap: 6px; align-items: center;
      &:hover { background: var(--surface-2); color: var(--text); }
      &.on { background: var(--surface-3); color: var(--text); }
    }
    .count { font-size: 11px; padding: 0 6px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); font-weight: 600; }
    .content { flex: 1; overflow: auto; padding: 10px; }
    .empty { color: var(--text-3); padding: 12px; margin: 0; }
    .matches { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .matches li { border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
    .mhead { display: flex; gap: 8px; align-items: center; font-size: 13px; }
    .value { margin: 4px 0 6px; padding: 4px 8px; background: var(--match); border-radius: 5px; white-space: pre-wrap; word-break: break-all; font-size: 13px; }
    .grow { display: grid; grid-template-columns: 10px minmax(60px, auto) 1fr; gap: 8px; align-items: center; font-size: 12.5px; padding: 2px 0; }
    .gname { color: var(--text-2); font-weight: 500; }
    .gval { background: var(--gc); border-radius: 4px; padding: 1px 6px; white-space: pre-wrap; word-break: break-all; }
    .gval.none { background: transparent; color: var(--text-3); font-family: var(--font-ui); font-style: italic; }
    .more { text-align: center; }
    .ref-intro { margin: 2px 4px 8px; font-size: 12px; }
    section { margin-bottom: 14px; }
    h3 { margin: 0 4px 4px; }
    .entry {
      display: flex; gap: 10px; width: 100%; align-items: baseline; border: 0; background: transparent; text-align: left;
      padding: 4px 6px; border-radius: 6px; cursor: pointer; color: var(--text-2);
      &:hover { background: var(--surface-2); color: var(--text); }
      code { min-width: 92px; color: var(--accent); font-size: 12.5px; }
    }
  `,
})
export class SidePanel {
  protected readonly wb = inject(WorkbenchManager);
  protected readonly ui = inject(UiState);
  protected readonly gc = groupClass;
  protected readonly tabs: { id: SideTab; label: string }[] = [
    { id: 'explain', label: 'Explain' },
    { id: 'matches', label: 'Matches' },
    { id: 'reference', label: 'Reference' },
  ];

  protected readonly matchCount = computed(() => {
    const r = this.wb.result();
    return r?.status === 'ok' && r.matches.length ? r.matches.length.toLocaleString() + (r.capped ? '+' : '') : '';
  });

  protected readonly matches = computed(() => {
    const r = this.wb.result();
    if (!r || r.status !== 'ok') return [];
    const text = this.wb.state().text;
    return r.matches.slice(0, MAX_LISTED).map((m, index) => ({
      index,
      start: m.start,
      end: m.end,
      value: text.slice(m.start, m.end),
      groups: m.groups.map((g, i) => ({
        index: i + 1,
        label: r.groupNames[i + 1] ? `${i + 1} · ${r.groupNames[i + 1]}` : `${i + 1}`,
        value: g ? text.slice(g.start, g.end) : null,
      })),
    }));
  });

  protected readonly hidden = computed(() => {
    const r = this.wb.result();
    return r?.status === 'ok' ? Math.max(0, r.matches.length - MAX_LISTED) : 0;
  });
}
