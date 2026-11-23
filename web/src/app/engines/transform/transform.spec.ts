import { describe, expect, it } from 'vitest';
import { PatternSpec } from '../../contracts';
import { SyntaxEngine } from '../syntax/syntax.engine';
import { TransformEngine } from './transform.engine';
import { parseTemplate, replaceAll } from './template';

function jsRun(spec: PatternSpec, text: string): string[] {
  const a = SyntaxEngine.analyze(spec);
  const t = TransformEngine.toEcmaScript(spec, a.ast);
  return [...text.matchAll(new RegExp(t.source, t.flags.includes('g') ? t.flags : t.flags + 'g'))].map((m) => m[0]);
}

describe('printer: exact translation to ECMAScript', () => {
  it('emulates PCRE $ before a final newline', () => {
    expect(jsRun({ flavor: 'pcre', source: 'b$', flags: '' }, 'ab\n')).toEqual(['b']);
    expect(jsRun({ flavor: 'ecmascript', source: 'b$', flags: '' }, 'ab\n')).toEqual([]);
  });

  it('emulates atomic groups and possessive quantifiers', () => {
    expect(jsRun({ flavor: 'pcre', source: '(?>a+)b', flags: '' }, 'aaab')).toEqual(['aaab']);
    expect(jsRun({ flavor: 'pcre', source: 'a++a', flags: '' }, 'aaaa')).toEqual([]);
    expect(jsRun({ flavor: 'pcre', source: '(x)(?>a+)\\1', flags: '' }, 'xaax')).toEqual(['xaax']);
  });

  it('translates \\A, \\z, \\Z and Python named groups', () => {
    expect(jsRun({ flavor: 'python', source: '\\A(?P<w>\\w+) (?P=w)\\Z', flags: '' }, 'hey hey\n')).toEqual(['hey hey']);
    expect(jsRun({ flavor: 'pcre', source: 'a\\z', flags: 'm' }, 'a\na')).toEqual(['a']);
  });

  it('makes Python \\d Unicode-aware', () => {
    expect(jsRun({ flavor: 'python', source: '\\d+', flags: '' }, '١٢٣ 45')).toEqual(['١٢٣', '45']);
    expect(jsRun({ flavor: 'pcre', source: '\\d+', flags: '' }, '١٢٣ 45')).toEqual(['45']);
  });

  it('hoists leading inline flags and scopes later ones', () => {
    const a = SyntaxEngine.analyze({ flavor: 'pcre', source: '(?i)abc', flags: '' });
    const t = TransformEngine.toEcmaScript({ flavor: 'pcre', source: '(?i)abc', flags: '' }, a.ast);
    expect(t.flags).toContain('i');
    expect(t.source).toBe('abc');
  });

  it('expands POSIX classes and \\h', () => {
    expect(jsRun({ flavor: 'pcre', source: '[[:digit:]x]+\\h', flags: '' }, '12x ')).toEqual(['12x ']);
  });
});

describe('convert', () => {
  it('converts named groups between flavors', () => {
    const spec: PatternSpec = { flavor: 'python', source: '(?P<y>\\d{4})-(?P=y)', flags: 'i' };
    const r = TransformEngine.convert(spec, SyntaxEngine.analyze(spec).ast, 'ecmascript');
    expect(r.spec.source).toBe('(?<y>\\d{4})-\\k<y>');
    expect(r.spec.flags).toBe('i');
  });

  it('warns when the target lacks a construct', () => {
    const spec: PatternSpec = { flavor: 'pcre', source: '(?<=a)b', flags: '' };
    const r = TransformEngine.convert(spec, SyntaxEngine.analyze(spec).ast, 'rust');
    expect(r.diagnostics[0].severity).toBe('error');
  });
});

describe('templates', () => {
  const text = 'ab-cd';
  const m = [{ start: 0, end: 5, groups: [{ index: 1, start: 0, end: 2 }, { index: 2, name: 'x', start: 3, end: 5 }] }];
  const names = [undefined, undefined, 'x'];
  const ctx = { groupCount: 2, names: new Set(['x']) };
  const run = (t: string, s: Parameters<typeof parseTemplate>[1]) => replaceAll(text, m, parseTemplate(t, s, ctx), names).text;

  it('follows each flavor', () => {
    expect(run('$2 $1 $<x> $$ $&', 'ecmascript')).toBe('cd ab cd $ ab-cd');
    expect(run('\\2 \\g<1> \\g<x>\\n', 'python')).toBe('cd ab cd\n');
    expect(run('${x}$1 \\$', 'java')).toBe('cdab $');
    expect(run('$x $1a ${1}a', 'rust')).toBe('cd  aba');
    expect(run('$+|$_', 'dotnet')).toBe('cd|ab-cd');
  });
});
