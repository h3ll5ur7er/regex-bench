import { DEFAULT_SESSION, FlavorId, Mode, SessionState, TestCase } from '../contracts';

const FLAVORS: FlavorId[] = ['ecmascript', 'pcre', 'python', 'java', 'dotnet', 'rust', 'go'];
const MODES: Mode[] = ['match', 'replace', 'list', 'tests', 'debug', 'code', 'convert', 'infer'];

export const LIMITS = { pattern: 50_000, text: 5_000_000, template: 10_000, tests: 500, testText: 10_000, flags: 12 };

/**
 * Validates untrusted session data (share links, storage) into a fresh object (STRIDE H02, H15).
 * Unknown keys are dropped; anything malformed falls back to the default for that field; oversized strings are
 * rejected rather than truncated, so a link never silently means something else.
 */
export function validateSession(raw: unknown): SessionState | null {
  if (!isObject(raw) || raw['version'] !== 1) return null;
  const p = raw['pattern'];
  if (!isObject(p)) return null;
  const flavor = FLAVORS.find((f) => f === p['flavor']);
  const source = str(p['source'], LIMITS.pattern);
  const flags = str(p['flags'], LIMITS.flags);
  if (!flavor || source === null || flags === null || !/^[a-zA-Z]*$/.test(flags)) return null;
  const text = str(raw['text'], LIMITS.text);
  if (text === null) return null;
  const tests = Array.isArray(raw['tests']) ? raw['tests'].slice(0, LIMITS.tests).map(testCase).filter((t): t is TestCase => !!t) : [];
  return {
    version: 1,
    pattern: { flavor, source, flags },
    text,
    mode: MODES.find((m) => m === raw['mode']) ?? 'match',
    replacement: str(raw['replacement'], LIMITS.template) ?? DEFAULT_SESSION.replacement,
    listTemplate: str(raw['listTemplate'], LIMITS.template) ?? DEFAULT_SESSION.listTemplate,
    tests,
    inferInput: str(raw['inferInput'], LIMITS.text) ?? '',
  };
}

function testCase(raw: unknown, i: number): TestCase | null {
  if (!isObject(raw)) return null;
  const text = str(raw['text'], LIMITS.testText);
  const expect = (['match', 'no-match', 'full-match'] as const).find((e) => e === raw['expect']);
  if (text === null || !expect) return null;
  return { id: `t${i + 1}`, text, expect };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length <= max ? v : null;
}
