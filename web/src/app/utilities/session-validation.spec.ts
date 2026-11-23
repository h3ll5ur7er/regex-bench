import { describe, expect, it } from 'vitest';
import { DEFAULT_SESSION } from '../contracts';
import { compress, decompress } from './compression';
import { LIMITS, validateSession } from './session-validation';

describe('validateSession (STRIDE H02/H15)', () => {
  it('accepts a valid session and returns a fresh object without unknown keys', () => {
    const raw = { ...DEFAULT_SESSION, extra: 'x', __proto__: { polluted: true } };
    const s = validateSession(JSON.parse(JSON.stringify(raw)));
    expect(s).toEqual(DEFAULT_SESSION);
    expect(s && 'extra' in s).toBe(false);
  });

  it('rejects malformed or oversized data', () => {
    expect(validateSession(null)).toBeNull();
    expect(validateSession({ ...DEFAULT_SESSION, version: 2 })).toBeNull();
    expect(validateSession({ ...DEFAULT_SESSION, pattern: { ...DEFAULT_SESSION.pattern, flavor: 'perl' } })).toBeNull();
    expect(validateSession({ ...DEFAULT_SESSION, pattern: { ...DEFAULT_SESSION.pattern, flags: 'g"><script>' } })).toBeNull();
    expect(validateSession({ ...DEFAULT_SESSION, pattern: { ...DEFAULT_SESSION.pattern, source: 'a'.repeat(LIMITS.pattern + 1) } })).toBeNull();
    expect(validateSession({ ...DEFAULT_SESSION, text: 42 })).toBeNull();
  });

  it('drops invalid test cases and falls back for optional fields', () => {
    const s = validateSession({ ...DEFAULT_SESSION, tests: [{ text: 'a', expect: 'match' }, { text: 1 }, 'x'], mode: 'evil', replacement: {} });
    expect(s?.tests).toEqual([{ id: 't1', text: 'a', expect: 'match' }]);
    expect(s?.mode).toBe('match');
    expect(s?.replacement).toBe(DEFAULT_SESSION.replacement);
  });
});

describe('compression', () => {
  it('round-trips unicode text', async () => {
    const text = JSON.stringify(DEFAULT_SESSION) + ' ü 😀 ‮';
    expect(await decompress(await compress(text))).toBe(text);
  });
});
