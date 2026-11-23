import { Injectable, signal } from '@angular/core';
import { PatternSpec, Span } from '../contracts';

export type Theme = 'system' | 'light' | 'dark';
export type Dialog = 'share' | 'library' | 'help' | null;
export type SideTab = 'explain' | 'matches' | 'reference';

/** Client-side view state shared between the workbench's components. Not business state. */
@Injectable({ providedIn: 'root' })
export class UiState {
  /** A span of the pattern to highlight (from hovering the explanation or the diagram). */
  readonly hoverSpan = signal<Span | null>(null);
  readonly debugStep = signal(0);
  readonly dialog = signal<Dialog>(null);
  readonly sideTab = signal<SideTab>('explain');
  readonly toast = signal<{ text: string; kind: 'ok' | 'error' } | null>(null);
  readonly diagramOpen = signal(loadBool('diagram', true));
  readonly theme = signal<Theme>(loadTheme());
  /** A converted pattern offered after a flavor switch. */
  readonly offeredConversion = signal<{ spec: PatternSpec; from: string; original: PatternSpec } | null>(null);
  /** Requests for the pattern editor: insert text, or select a range. */
  readonly patternInsert = signal<{ text: string; n: number } | null>(null);
  readonly patternSelect = signal<{ span: Span; n: number } | null>(null);

  private toastTimer?: ReturnType<typeof setTimeout>;
  notify(text: string, kind: 'ok' | 'error' = 'ok') {
    clearTimeout(this.toastTimer);
    this.toast.set({ text, kind });
    this.toastTimer = setTimeout(() => this.toast.set(null), 2600);
  }

  insertIntoPattern(text: string) {
    this.patternInsert.set({ text, n: Date.now() });
  }

  selectInPattern(span: Span) {
    this.patternSelect.set({ span, n: Date.now() });
  }

  setTheme(t: Theme) {
    this.theme.set(t);
    save('theme', t);
    applyTheme(t);
  }

  setDiagramOpen(open: boolean) {
    this.diagramOpen.set(open);
    save('diagram', String(open));
  }
}

export function applyTheme(t: Theme) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

/** Group n always uses the same colour class everywhere. */
export function groupClass(n: number | undefined): string {
  return n === undefined ? '' : n === 0 ? 'g0' : 'g' + (((n - 1) % 8) + 1);
}

function save(key: string, value: string) {
  try {
    localStorage.setItem('regex-bench:ui:' + key, value);
  } catch {
    /* preferences are optional */
  }
}

function load(key: string): string | null {
  try {
    return localStorage.getItem('regex-bench:ui:' + key);
  } catch {
    return null;
  }
}

function loadBool(key: string, def: boolean): boolean {
  const v = load(key);
  return v === null ? def : v === 'true';
}

function loadTheme(): Theme {
  const v = load('theme');
  return v === 'light' || v === 'dark' ? v : 'system';
}
