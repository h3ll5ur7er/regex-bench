import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { LibraryManager } from '../managers/library.manager';
import { WorkbenchManager } from '../managers/workbench.manager';
import { dialectOf } from '../engines/syntax/dialects';
import { Icon } from './icon';
import { UiState } from './ui-state';

@Component({
  selector: 'rb-share-dialog',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>Share</h2>
    <p class="muted">The link carries everything after the <code class="mono">#</code>. Browsers never send that part to a server: nothing is uploaded, ever.</p>
    <label class="check"><input type="checkbox" [checked]="includeText()" (change)="includeText.set($any($event.target).checked)" /> Include the test text ({{ wb.state().text.length.toLocaleString() }} chars)</label>
    <div class="row">
      <input class="field mono" readonly [value]="url()" aria-label="Share link" (focus)="$any($event.target).select()" />
      <button class="btn primary" (click)="create()"><rb-icon name="copy" /> {{ url() ? 'Copy again' : 'Create and copy' }}</button>
    </div>
    @if (url()) {
      <p class="muted small">{{ url().length.toLocaleString() }} characters{{ url().length > 8000 ? ' · long links may be cut by chat apps; try without the text' : '' }}</p>
    }
  `,
  styles: `
    .row { display: flex; gap: 8px; margin-top: 12px; }
    .row input { flex: 1; min-width: 0; }
    .check { display: flex; gap: 8px; align-items: center; }
    .small { font-size: 12px; }
  `,
})
export class ShareDialog {
  protected readonly wb = inject(WorkbenchManager);
  private readonly lib = inject(LibraryManager);
  private readonly ui = inject(UiState);
  protected readonly includeText = signal(this.wb.state().text.length < 20_000);
  protected readonly url = signal('');

  protected async create() {
    const url = await this.lib.createLink(this.wb.state(), this.includeText());
    this.url.set(url);
    const copied = await this.lib.copy(url);
    this.ui.notify(copied ? 'Link copied' : 'Select the link and copy it', copied ? 'ok' : 'error');
  }
}

@Component({
  selector: 'rb-library-dialog',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>Library</h2>
    <div class="row">
      <input class="field" placeholder="Name this pattern…" [value]="name()" (input)="name.set($any($event.target).value)" (keydown.enter)="save()" aria-label="Name" />
      <button class="btn primary" [disabled]="!name().trim()" (click)="save()">Save</button>
    </div>
    <h3 class="label">Saved</h3>
    @for (e of lib.library(); track e.id) {
      <div class="item">
        <button class="open" (click)="load(e.session)">
          <b>{{ e.name }}</b>
          <code class="mono">{{ e.session.pattern.source }}</code>
        </button>
        <span class="muted small">{{ flavorName(e.session.pattern.flavor) }}</span>
        <button class="btn ghost icon" title="Delete" (click)="lib.remove(e.id)"><rb-icon name="trash" /></button>
      </div>
    } @empty {
      <p class="muted">Nothing saved yet. Name the current pattern above to keep it.</p>
    }
    <h3 class="label">Recent patterns</h3>
    @for (h of lib.history(); track $index) {
      <div class="item">
        <button class="open" (click)="loadPattern(h.pattern)">
          <code class="mono">{{ h.pattern.source }}</code>
        </button>
        <span class="muted small">{{ flavorName(h.pattern.flavor) }}</span>
      </div>
    } @empty {
      <p class="muted">Patterns you use are remembered here, on this device only.</p>
    }
    <div class="foot">
      <span class="muted small">Stored in this browser only.</span>
      <button class="btn ghost" (click)="clear()">Clear all data</button>
    </div>
  `,
  styles: `
    .row { display: flex; gap: 8px; }
    .row input { flex: 1; }
    h3 { margin: 18px 0 6px; }
    .item { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border); padding: 4px 0; }
    .open { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; border: 0; background: transparent; padding: 6px; border-radius: 6px; cursor: pointer; text-align: left; }
    .open:hover { background: var(--surface-2); }
    .open code { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--accent); }
    .small { font-size: 12px; }
    .foot { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; }
  `,
})
export class LibraryDialog {
  protected readonly lib = inject(LibraryManager);
  private readonly wb = inject(WorkbenchManager);
  private readonly ui = inject(UiState);
  protected readonly name = signal('');
  protected readonly flavorName = (id: Parameters<typeof dialectOf>[0]) => dialectOf(id).name;

  protected save() {
    if (!this.name().trim()) return;
    this.lib.saveToLibrary(this.name().trim(), this.wb.state());
    this.name.set('');
    this.ui.notify('Saved to your library');
  }

  protected load(s: Parameters<WorkbenchManager['load']>[0]) {
    this.wb.load(s);
    this.ui.dialog.set(null);
  }

  protected loadPattern(p: Parameters<WorkbenchManager['setPattern']>[0]) {
    this.wb.setPattern(p);
    this.ui.dialog.set(null);
  }

  protected clear() {
    if (confirm('Delete your library, history and saved session from this browser?')) this.lib.clearAll();
  }
}

@Component({
  selector: 'rb-help-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>regex-bench</h2>
    <p>A regex workbench that runs entirely on your device. Nothing you type leaves it: no server, no tracking, no CDN. It works offline once loaded, and installs as an app.</p>
    <h3 class="label">How to read it</h3>
    <ul>
      <li>Every token of the pattern has a <b>colour by kind</b>: <span class="tk-class">classes</span>, <span class="tk-quantifier">quantifiers</span>, <span class="tk-anchor">anchors</span>, <span class="tk-escape">escapes</span>, <span class="tk-alternation">alternation</span>.</li>
      <li>Every <b>group has its own colour</b>, the same in the pattern, the text, the match list and the explanation.</li>
      <li>Hover the pattern or a match for details. Hover a line of the explanation to see its tokens.</li>
    </ul>
    <h3 class="label">Engines</h3>
    <ul>
      <li><b>ECMAScript</b> runs on your browser's engine.</li>
      <li><b>PCRE, Python, Java, .NET</b> are translated exactly into ECMAScript (atomic groups, possessive quantifiers, <code>\\A</code>, <code>\\Z</code> and their <code>$</code> are emulated) and run on your browser's engine.</li>
      <li><b>Rust and Go</b> run on the Rust <code>regex</code> crate compiled to WebAssembly: linear time, no backtracking.</li>
      <li>Every run is sandboxed in a worker and stopped after 1.5 s, so a runaway pattern never freezes the page.</li>
    </ul>
    <h3 class="label">Keyboard</h3>
    <table>
      <tr><td><kbd>/</kbd></td><td>Focus the pattern</td></tr>
      <tr><td><kbd>Alt</kbd> + <kbd>1</kbd>…<kbd>7</kbd></td><td>Replace, List, Tests, Debug, Code, Convert, From data</td></tr>
      <tr><td><kbd>Alt</kbd> + <kbd>0</kbd></td><td>Close the tool panel</td></tr>
      <tr><td><kbd>Ctrl</kbd> + <kbd>S</kbd></td><td>Save to the library</td></tr>
      <tr><td><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd></td><td>Share</td></tr>
      <tr><td><kbd>?</kbd></td><td>This help</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Close dialogs</td></tr>
    </table>
  `,
  styles: `
    ul { padding-left: 18px; margin: 6px 0; } li { margin: 4px 0; }
    h3 { margin: 18px 0 6px; }
    table { border-collapse: collapse; } td { padding: 3px 12px 3px 0; }
  `,
})
export class HelpDialog {}
