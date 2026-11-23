import { Injectable } from '@angular/core';
import { PatternSpec, SessionState } from '../contracts';
import { validateSession } from '../utilities/session-validation';

const NS = 'regex-bench:v1:';
const HISTORY_LIMIT = 50;

export interface HistoryEntry {
  pattern: PatternSpec;
  at: number;
}

export interface LibraryEntry {
  id: string;
  name: string;
  session: SessionState;
  savedAt: number;
}

/**
 * WorkspaceAccess: saving and restoring what the user works on (V5). Today `localStorage`, namespaced and
 * validated on read (STRIDE H15); quota errors trim history instead of failing (Residuality S06).
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceAccess {
  loadSession(): SessionState | null {
    return validateSession(this.read('session'));
  }

  saveSession(s: SessionState) {
    this.write('session', s);
  }

  history(): HistoryEntry[] {
    const raw = this.read('history');
    return Array.isArray(raw) ? (raw as HistoryEntry[]).filter((h) => typeof h?.pattern?.source === 'string').slice(0, HISTORY_LIMIT) : [];
  }

  recordHistory(pattern: PatternSpec) {
    const list = this.history().filter((h) => !(h.pattern.source === pattern.source && h.pattern.flavor === pattern.flavor));
    list.unshift({ pattern, at: Date.now() });
    this.write('history', list.slice(0, HISTORY_LIMIT));
  }

  library(): LibraryEntry[] {
    const raw = this.read('library');
    if (!Array.isArray(raw)) return [];
    return raw
      .map((e) => {
        const session = validateSession(e?.session);
        return session && typeof e.name === 'string' ? { id: String(e.id), name: e.name.slice(0, 200), session, savedAt: Number(e.savedAt) || 0 } : null;
      })
      .filter((e): e is LibraryEntry => !!e);
  }

  saveToLibrary(name: string, session: SessionState): LibraryEntry {
    const entry = { id: crypto.randomUUID(), name, session, savedAt: Date.now() };
    this.write('library', [entry, ...this.library()]);
    return entry;
  }

  removeFromLibrary(id: string) {
    this.write('library', this.library().filter((e) => e.id !== id));
  }

  clearAll() {
    for (const k of ['session', 'history', 'library']) this.storage()?.removeItem(NS + k);
  }

  private storage(): Storage | null {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }

  private read(key: string): unknown {
    try {
      const v = this.storage()?.getItem(NS + key);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown) {
    const s = this.storage();
    if (!s) return;
    try {
      s.setItem(NS + key, JSON.stringify(value));
    } catch {
      // Quota exceeded: drop history first, then give up quietly. Editing must never fail because of storage.
      try {
        s.removeItem(NS + 'history');
        s.setItem(NS + key, JSON.stringify(value));
      } catch {
        /* nothing more to free */
      }
    }
  }
}
