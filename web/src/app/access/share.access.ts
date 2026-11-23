import { Injectable } from '@angular/core';
import { SessionState } from '../contracts';
import { compress, decompress } from '../utilities/compression';
import { validateSession } from '../utilities/session-validation';

const PREFIX = 's1.';

/**
 * ShareAccess: `toLink`/`fromLink` (V5). The state travels in the URL fragment, which browsers never send to a
 * server. The format is versioned (`s1.`) so it can change without breaking old links.
 */
@Injectable({ providedIn: 'root' })
export class ShareAccess {
  async toLink(state: SessionState, includeText: boolean): Promise<string> {
    const payload: SessionState = includeText ? state : { ...state, text: '', inferInput: '' };
    const code = await compress(JSON.stringify(payload));
    const url = new URL(document.baseURI);
    url.hash = PREFIX + code;
    return url.toString();
  }

  /** Reads a session from a fragment, or null when there is none or it is invalid. */
  async fromFragment(hash: string): Promise<SessionState | null> {
    const code = hash.replace(/^#/, '');
    if (!code.startsWith(PREFIX)) return null;
    try {
      return validateSession(JSON.parse(await decompress(code.slice(PREFIX.length))));
    } catch {
      return null;
    }
  }
}
