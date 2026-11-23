import { describe, expect, it } from 'vitest';
import { DIALECTS } from './dialects';
import { parse } from './parser';
import { SyntaxEngine } from './syntax.engine';

const js = DIALECTS.ecmascript;

describe('parser', () => {
  it('numbers groups and records names', () => {
    const { ast, diagnostics } = parse(String.raw`(?<y>\d{4})-(\d\d)(?:x)`, '', js);
    expect(diagnostics).toEqual([]);
    expect(ast.groups.map((g) => [g.index, g.name])).toEqual([[1, 'y'], [2, undefined]]);
  });

  it('agrees with RegExp on validity for ECMAScript (differential)', () => {
    const cases = [
      'a(b', 'a)b', '[a-', '[z-a]', '*a', 'a**', 'a{2,1}', String.raw`\k<x>(?<x>a)`, '(?<1a>x)', 'a{2}', 'a{,2}',
      String.raw`(a)\2`, '(?<=a+)b', '[^]', '[]', String.raw`\p{L}`, 'x|', '(?:)', String.raw`[\d-z]`,
      'a\\', '(?=a)*', String.raw`\u{1F600}`, String.raw`[\b]`, 'a{', '}',
    ];
    for (const src of cases) {
      for (const flags of ['', 'u']) {
        let native = true;
        try { new RegExp(src, flags); } catch { native = false; }
        const ours = !parse(src, flags, js).diagnostics.some((d) => d.severity === 'error');
        expect.soft(ours, `${src} /${flags}`).toBe(native);
      }
    }
  });

  it('accepts ES2025 modifiers and duplicate names in different alternatives', () => {
    expect(parse('(?i:a)b', '', js).diagnostics).toEqual([]);
    expect(parse('(?<a>x)|(?<a>y)', '', js).diagnostics.every((d) => d.severity !== 'error')).toBe(true);
  });

  it('flags unsupported constructs per flavor', () => {
    const rust = parse('(?<=a)b\\1', '', DIALECTS.rust).diagnostics.map((d) => d.code);
    expect(rust).toContain('unsupported-construct');
    expect(parse('(?P<n>a)(?P=n)', '', DIALECTS.python).diagnostics).toEqual([]);
    expect(parse('(?P<n>a)', '', js).diagnostics[0].code).toBe('unsupported-construct');
  });

  it('numbers named groups last in .NET', () => {
    const { ast } = parse('(?<a>x)(y)', '', DIALECTS.dotnet);
    expect(ast.groups.map((g) => [g.index, g.name])).toEqual([[1, undefined], [2, 'a']]);
  });

  it('ignores whitespace and comments in extended mode', () => {
    const { ast, diagnostics } = parse('a b # comment\n c', 'x', DIALECTS.pcre);
    expect(diagnostics).toEqual([]);
    expect(ast.root.type).toBe('sequence');
    if (ast.root.type === 'sequence') expect(ast.root.items.map((i) => i.type === 'char' && i.value)).toEqual(['a', 'b', 'c']);
  });

  it('warns about catastrophic backtracking', () => {
    expect(SyntaxEngine.analyze({ flavor: 'ecmascript', source: '(a+)+$', flags: '' }).diagnostics.map((d) => d.code))
      .toContain('catastrophic-backtracking');
    expect(SyntaxEngine.analyze({ flavor: 'rust', source: '(a+)+$', flags: '' }).diagnostics).toEqual([]);
  });

  it('explains and tokenizes', () => {
    const a = SyntaxEngine.analyze({ flavor: 'ecmascript', source: String.raw`^(?<year>\d{4})-foo|bar$`, flags: 'm' });
    expect(a.explanation[0].text).toContain('Either of 2');
    expect(a.tokens.map((t) => t.kind)).toContain('quantifier');
    expect(a.tokens.find((t) => t.kind === 'group')?.group).toBe(1);
  });

  it('survives deep nesting with a diagnostic', () => {
    const src = '('.repeat(1000) + ')'.repeat(1000);
    expect(parse(src, '', js).diagnostics[0].message).toMatch(/nested/);
  });
});
