import { describe, expect, it } from 'vitest';
import { SyntaxEngine } from '../syntax/syntax.engine';
import { FlavorId } from '../../contracts';
import { trace } from './trace.engine';

function run(source: string, text: string, flags = '', flavor: FlavorId = 'pcre') {
  return trace(SyntaxEngine.analyze({ flavor, source, flags }).ast, flags, text);
}

describe('TraceEngine', () => {
  it('agrees with RegExp on the first match', () => {
    const cases: [string, string, string][] = [
      ['a+b', 'xaab', ''], ['(a|ab)(c|bcd)(d*)', 'abcd', ''], ['(?<=\\$)\\d+', 'cost $42', ''], ['(\\w)\\1', 'abccd', ''],
      ['a*?b', 'aaab', ''], ['^b', 'a\nb', 'm'], ['x(?!y)', 'xyxz', ''], ['[^a-c]+', 'abcdef', ''], ['(?i)AB', 'xab', ''],
      ['\\bfoo\\b', 'a foo b', ''], ['(a)?b', 'b', ''], ['(?:a|b)*c', 'ababc', ''],
    ];
    for (const [src, text, flags] of cases) {
      const r = run(src, text, flags);
      const js = new RegExp(src.replace('(?i)', ''), flags + (src.startsWith('(?i)') ? 'i' : '') + 'd').exec(text) as RegExpExecArray & { indices: [number, number][] } | null;
      expect.soft(r.match ? [r.match.start, r.match.end] : null, src).toEqual(js ? [js.index, js.index + js[0].length] : null);
      if (js && r.match) expect.soft(r.match.groups, src).toEqual(js.indices.slice(1).map((g) => g ?? null));
    }
  });

  it('handles atomic groups and possessive quantifiers', () => {
    expect(run('(?>a+)ab', 'aaab').match).toBeNull();
    expect(run('a++b', 'aaab').match).toEqual({ start: 0, end: 4, groups: [] });
  });

  it('detects catastrophic backtracking', () => {
    const r = run('(a+)+$', 'a'.repeat(30) + '!');
    expect(r.exhausted).toBe(true);
    expect(run('a+$', 'a'.repeat(30) + '!').exhausted).toBe(false);
  });
});
