import { inject, Injectable, signal } from '@angular/core';
import { SessionState } from '../contracts';
import { HostAccess } from '../access/host.access';
import { ShareAccess } from '../access/share.access';
import { HistoryEntry, LibraryEntry, WorkspaceAccess } from '../access/workspace.access';

/**
 * LibraryManager: the keep-and-share workflow (US-08, 09, 10, 16): restore on start, autosave, history,
 * a named library, share links and opening files.
 */
@Injectable({ providedIn: 'root' })
export class LibraryManager {
  private readonly workspace = inject(WorkspaceAccess);
  private readonly share = inject(ShareAccess);
  private readonly host = inject(HostAccess);

  readonly history = signal<HistoryEntry[]>([]);
  readonly library = signal<LibraryEntry[]>([]);
  readonly isDesktop = this.host.isDesktop;

  /** The session to start with: a share link wins over the last session. */
  async restore(hash: string): Promise<{ session: SessionState | null; fromLink: boolean; badLink: boolean }> {
    this.refresh();
    const linked = hash ? await this.share.fromFragment(hash) : null;
    if (linked) return { session: linked, fromLink: true, badLink: false };
    return { session: this.workspace.loadSession(), fromLink: false, badLink: hash.startsWith('#s') };
  }

  private autosaveTimer?: ReturnType<typeof setTimeout>;
  autosave(state: SessionState) {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this.workspace.saveSession(state), 400);
  }

  private historyTimer?: ReturnType<typeof setTimeout>;
  /** Records a pattern in the history once it has been stable for a moment. */
  noteStablePattern(state: SessionState) {
    clearTimeout(this.historyTimer);
    if (!state.pattern.source) return;
    this.historyTimer = setTimeout(() => {
      this.workspace.recordHistory(state.pattern);
      this.history.set(this.workspace.history());
    }, 3000);
  }

  async createLink(state: SessionState, includeText: boolean): Promise<{ url: string; copied: boolean }> {
    const url = await this.share.toLink(state, includeText);
    return { url, copied: await this.host.copy(url) };
  }

  saveToLibrary(name: string, state: SessionState) {
    this.workspace.saveToLibrary(name, state);
    this.refresh();
  }

  remove(id: string) {
    this.workspace.removeFromLibrary(id);
    this.refresh();
  }

  clearAll() {
    this.workspace.clearAll();
    this.refresh();
  }

  openFile() {
    return this.host.openTextFile();
  }

  readDroppedFile(file: File) {
    return this.host.readFile(file);
  }

  copy(text: string) {
    return this.host.copy(text);
  }

  download(name: string, text: string) {
    this.host.download(name, text);
  }

  private refresh() {
    this.history.set(this.workspace.history());
    this.library.set(this.workspace.library());
  }
}
