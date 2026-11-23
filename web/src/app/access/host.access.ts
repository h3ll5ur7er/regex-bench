import { Injectable } from '@angular/core';

export const FILE_SIZE_LIMIT = 50 * 1024 * 1024;

/**
 * HostAccess: what differs between a browser tab, the installed PWA and the Tauri desktop app (V6).
 * File opening uses the file picker, which works in every host, so the desktop app needs no file-system
 * permission at all (STRIDE H17).
 */
@Injectable({ providedIn: 'root' })
export class HostAccess {
  readonly isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  /** Asks the user for a text file. Resolves to null when cancelled. */
  openTextFile(): Promise<{ name: string; text: string } | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.txt,.log,.csv,.json,.md,.xml,.yaml,.yml,text/*';
      input.onchange = async () => {
        const file = input.files?.[0];
        resolve(file ? await this.readFile(file) : null);
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  async readFile(file: File): Promise<{ name: string; text: string }> {
    if (file.size > FILE_SIZE_LIMIT) throw new Error(`${file.name} is larger than ${FILE_SIZE_LIMIT / 1024 / 1024} MB.`);
    return { name: file.name, text: await file.text() };
  }

  /** Copies text; falls back to a selection-based copy where the Clipboard API is denied (Residuality T15). */
  async copy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  download(name: string, text: string, type = 'text/plain') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
