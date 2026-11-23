import { Diagnostic, FlavorId, MatchItem, PatternSpec, RegexAst } from '../../contracts';
import { DIALECTS, dialectOf } from '../syntax/dialects';
import { generateCode, CodeSnippet } from './codegen';
import { print, PrintResult } from './printer';
import { listAll, parseTemplate, replaceAll, ReplaceOutput } from './template';

export interface Conversion {
  spec: PatternSpec;
  diagnostics: Diagnostic[];
}

/** TransformEngine: everything that turns a pattern and its matches into another representation (V3). */
export const TransformEngine = {
  /** Converts a pattern to another flavor, keeping it readable and warning where meaning changes (US-07). */
  convert(spec: PatternSpec, ast: RegexAst, target: FlavorId): Conversion {
    const r = print(ast, dialectOf(spec.flavor), dialectOf(target), { flags: spec.flags, mode: 'readable' });
    return { spec: { flavor: target, source: r.source, flags: r.flags }, diagnostics: r.diagnostics };
  },

  /** Translates a pattern into an exactly equivalent ECMAScript pattern for execution on the browser's engine. */
  toEcmaScript(spec: PatternSpec, ast: RegexAst): PrintResult {
    return print(ast, dialectOf(spec.flavor), DIALECTS.ecmascript, { flags: spec.flags, mode: 'exact' });
  },

  replace(spec: PatternSpec, template: string, text: string, matches: MatchItem[], names: (string | undefined)[]): ReplaceOutput {
    const parts = parseTemplate(template, dialectOf(spec.flavor).replacement, context(names));
    return replaceAll(text, matches, parts, names);
  },

  list(spec: PatternSpec, template: string, text: string, matches: MatchItem[], names: (string | undefined)[]): ReplaceOutput {
    const parts = parseTemplate(template, dialectOf(spec.flavor).replacement, context(names), true);
    return listAll(text, matches, parts, names);
  },

  code(spec: PatternSpec, replacement: string, text: string): CodeSnippet {
    return generateCode(spec, replacement, text);
  },
};

function context(names: (string | undefined)[]) {
  return { groupCount: Math.max(0, names.length - 1), names: new Set(names.filter((n): n is string => !!n)) };
}
