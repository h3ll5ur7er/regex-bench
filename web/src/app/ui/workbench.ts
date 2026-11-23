import { ChangeDetectionStrategy, Component, computed, effect, inject, OnInit, untracked, viewChild } from '@angular/core';
import { FlavorId } from '../contracts';
import { FLAVORS, dialectOf } from '../engines/syntax/dialects';
import { TransformEngine } from '../engines/transform/transform.engine';
import { LibraryManager } from '../managers/library.manager';
import { SynthesisManager } from '../managers/synthesis.manager';
import { WorkbenchManager } from '../managers/workbench.manager';
import { DiagramStrip } from './diagram-strip';
import { HelpDialog, LibraryDialog, ShareDialog } from './dialogs';
import { Icon } from './icon';
import { PatternBar } from './pattern-bar';
import { SidePanel } from './side-panel';
import { TextPane } from './text-pane';
import { TOOL_TABS, ToolsPanel } from './tools-panel';
import { applyTheme, Theme, UiState } from './ui-state';

/** The Workbench UI client: one screen, the pattern on top, the text and its results below. */
@Component({
  selector: 'rb-workbench',
  imports: [PatternBar, DiagramStrip, TextPane, SidePanel, ToolsPanel, Icon, ShareDialog, LibraryDialog, HelpDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)' },
  template: `
    <header class="top">
      <div class="brand">
        <span class="logo" aria-hidden="true">.*</span>
        <span class="name">regex<span>bench</span></span>
      </div>
      <label class="flavor">
        <span class="sr-only">Flavor</span>
        <select class="field" [value]="wb.pattern().flavor" (change)="changeFlavor($any($event.target).value)">
          @for (f of flavors; track f.id) {
            <option [value]="f.id">{{ f.name }}</option>
          }
        </select>
        <span class="used-by muted">{{ wb.dialect().usedBy }}</span>
      </label>
      <span class="spacer"></span>
      <span class="local" title="Everything runs on this device. Nothing is sent anywhere."><span class="led"></span>On-device</span>
      <button class="btn ghost" (click)="ui.dialog.set('library')" title="Library and history (Ctrl+S)"><rb-icon name="library" /> <span class="hide-sm">Library</span></button>
      <button class="btn" (click)="ui.dialog.set('share')" title="Share a link (Ctrl+Shift+S)"><rb-icon name="share" /> <span class="hide-sm">Share</span></button>
      <button class="btn ghost icon" (click)="cycleTheme()" [title]="'Theme: ' + ui.theme()"><rb-icon [name]="themeIcon()" /></button>
      <button class="btn ghost icon" (click)="ui.dialog.set('help')" title="Help (?)"><rb-icon name="help" /></button>
    </header>

    <main>
      <section class="pattern">
        <rb-pattern-bar #patternBar />
        <rb-diagram-strip />
      </section>
      <section class="work">
        <div class="left card">
          <rb-text-pane class="text" [class.squeezed]="wb.state().mode !== 'match'" />
          <rb-tools-panel class="tools" [class.open]="wb.state().mode !== 'match'" />
        </div>
        <rb-side-panel class="right card" />
      </section>
    </main>

    @if (ui.dialog(); as d) {
      <div class="backdrop" (click)="ui.dialog.set(null)">
        <div class="dialog card" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
          <button class="btn ghost icon close" title="Close (Esc)" (click)="ui.dialog.set(null)"><rb-icon name="x" /></button>
          @switch (d) {
            @case ('share') { <rb-share-dialog /> }
            @case ('library') { <rb-library-dialog /> }
            @case ('help') { <rb-help-dialog /> }
          }
        </div>
      </div>
    }
    @if (ui.toast(); as t) {
      <div class="toast" [class.error]="t.kind === 'error'" role="status">{{ t.text }}</div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100vh; height: 100dvh; }
    .top { display: flex; align-items: center; gap: 10px; padding: 10px 20px; }
    .brand { display: flex; align-items: center; gap: 10px; margin-right: 8px; }
    .logo {
      display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px;
      background: linear-gradient(135deg, var(--accent), #c026d3); color: #fff; font: 700 15px var(--font-code); letter-spacing: -1px;
    }
    .name { font-weight: 700; font-size: 16px; letter-spacing: -.01em; span { color: var(--text-3); font-weight: 500; } }
    .flavor { display: flex; align-items: center; gap: 10px; }
    .flavor select { font-weight: 600; }
    .used-by { font-size: 12px; }
    .spacer { flex: 1; }
    .local { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-3); margin-right: 6px; }
    .led { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }
    main { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 14px; padding: 4px 20px 16px; }
    .pattern { display: flex; flex-direction: column; gap: 8px; }
    .work { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 34%); gap: 14px; }
    .left { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    .text { flex: 1; min-height: 120px; }
    .text.squeezed { flex: 1 1 40%; }
    .tools { flex: none; }
    .tools.open { flex: 1 1 60%; min-height: 0; }
    .right { min-height: 0; overflow: hidden; }
    .backdrop { position: fixed; inset: 0; background: rgb(10 12 18 / 45%); display: grid; place-items: start center; padding-top: 10vh; z-index: 10; animation: fade .12s; }
    .dialog { position: relative; width: min(560px, calc(100vw - 32px)); max-height: 78vh; overflow: auto; padding: 22px 24px; box-shadow: var(--shadow-lg); }
    .dialog :is(h2) { margin: 0 0 8px; font-size: 18px; }
    .close { position: absolute; top: 12px; right: 12px; }
    .toast {
      position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); padding: 9px 16px; border-radius: 999px;
      background: var(--text); color: var(--bg); font-weight: 500; box-shadow: var(--shadow-lg); z-index: 20; animation: rise .18s;
      &.error { background: var(--err); color: #fff; }
    }
    @keyframes fade { from { opacity: 0; } }
    @keyframes rise { from { opacity: 0; transform: translate(-50%, 8px); } }
    @media (max-width: 980px) {
      :host { height: auto; min-height: 100vh; }
      .work { grid-template-columns: 1fr; }
      .left { min-height: 70vh; }
      .right { min-height: 50vh; }
      .used-by, .local, .hide-sm { display: none; }
      .top, main { padding-left: 12px; padding-right: 12px; }
    }
    @media (max-width: 640px) {
      .top { gap: 4px; }
      .name { display: none; }
      .brand { margin-right: 2px; }
      .flavor select { max-width: 160px; }
      .top .btn:not(.icon) { width: 32px; padding: 0; justify-content: center; }
    }
  `,
})
export class Workbench implements OnInit {
  protected readonly wb = inject(WorkbenchManager);
  protected readonly ui = inject(UiState);
  private readonly lib = inject(LibraryManager);
  private readonly synth = inject(SynthesisManager);
  private readonly patternBar = viewChild.required<PatternBar>('patternBar');
  protected readonly flavors = FLAVORS;
  private ready = false;

  protected readonly themeIcon = computed(() => ({ system: 'system', light: 'sun', dark: 'moon' })[this.ui.theme()]);

  constructor() {
    applyTheme(this.ui.theme());
    this.synth.attach(this.wb.state, this.wb.analysis);
    // The client wires the managers together: autosave and history follow the workbench session.
    effect(() => {
      const s = this.wb.state();
      if (!this.ready) return;
      untracked(() => {
        this.lib.autosave(s);
        if (this.wb.analysis().valid) this.lib.noteStablePattern(s);
      });
    });
  }

  async ngOnInit() {
    const { session, fromLink, badLink } = await this.lib.restore(location.hash);
    if (session) this.wb.load(session);
    if (fromLink) {
      history.replaceState(null, '', location.pathname + location.search);
      this.ui.notify('Opened from a shared link');
    } else if (badLink) {
      this.ui.notify('That link is damaged or from a newer version', 'error');
    }
    this.ready = true;
  }

  protected changeFlavor(flavor: FlavorId) {
    const before = this.wb.pattern();
    const analysis = this.wb.analysis();
    this.wb.setFlavor(flavor);
    this.ui.offeredConversion.set(null);
    // If the pattern reads differently in the new flavor, offer the converted pattern.
    if (analysis.valid && before.source) {
      const c = TransformEngine.convert(before, analysis.ast, flavor);
      const fine = !c.diagnostics.some((d) => d.severity === 'error');
      if (fine && c.spec.source !== before.source) {
        this.ui.offeredConversion.set({ spec: c.spec, from: dialectOf(before.flavor).name, original: this.wb.pattern() });
      }
    }
  }

  protected cycleTheme() {
    const order: Theme[] = ['system', 'light', 'dark'];
    this.ui.setTheme(order[(order.indexOf(this.ui.theme()) + 1) % 3]);
  }

  protected onKey(e: KeyboardEvent) {
    const inEditor = (e.target as HTMLElement)?.closest?.('.cm-editor, input, textarea, select');
    if (e.key === 'Escape' && this.ui.dialog()) {
      this.ui.dialog.set(null);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      this.ui.dialog.set(e.shiftKey ? 'share' : 'library');
      return;
    }
    if (e.altKey && /^[0-7]$/.test(e.key)) {
      e.preventDefault();
      const tab = TOOL_TABS.find((t) => t.key === e.key);
      this.wb.setMode(tab ? tab.mode : 'match');
      return;
    }
    if (inEditor) return;
    if (e.key === '/') {
      e.preventDefault();
      this.patternBar().focus();
    } else if (e.key === '?') {
      this.ui.dialog.set('help');
    }
  }
}
