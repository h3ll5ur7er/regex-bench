import { Diagnostic, ExplainNode, PatternSpec, PatternToken, RegexAst } from '../../contracts';
import { dialectOf } from './dialects';
import { explain } from './explain';
import { lint } from './lint';
import { parse } from './parser';
import { tokenize } from './tokens';

export interface Analysis {
  ast: RegexAst;
  diagnostics: Diagnostic[];
  tokens: PatternToken[];
  explanation: ExplainNode[];
  /** True when the pattern has no error diagnostics. */
  valid: boolean;
}

/** SyntaxEngine: parses a pattern with its flavor's dialect and derives everything the UI shows about it. */
export const SyntaxEngine = {
  analyze(spec: PatternSpec): Analysis {
    const dialect = dialectOf(spec.flavor);
    const { ast, diagnostics } = parse(spec.source, spec.flags, dialect);
    const valid = !diagnostics.some((d) => d.severity === 'error');
    if (valid) diagnostics.push(...lint(ast.root, dialect));
    return {
      ast,
      diagnostics,
      tokens: tokenize(ast.root),
      explanation: explain(ast.root, { source: spec.source, flags: spec.flags, dialect }),
      valid,
    };
  },
};
