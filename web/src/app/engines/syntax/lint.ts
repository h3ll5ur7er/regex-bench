import { Diagnostic, RegexNode } from '../../contracts';
import { walk } from './parser';
import { Dialect } from './dialects';

/**
 * Static checks beyond syntax. The most important one finds nested unbounded quantifiers, the classic shape of
 * catastrophic backtracking (`(a+)+`, `(\w*\s?)*`). Linear-time flavors (Rust, Go) are exempt.
 */
export function lint(root: RegexNode, dialect: Dialect): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (dialect.backend !== 'rust') {
    walk(root, (n) => {
      if (n.type !== 'quantifier' || n.max < 2 || n.possessive) return;
      let inner: (RegexNode & { type: 'quantifier' }) | undefined;
      walk(n.body, (m) => {
        if (!inner && m !== n && m.type === 'quantifier' && m.max === Infinity && !m.possessive) inner = m;
        // Atomic groups and lookarounds stop backtracking into them.
      });
      if (inner && !containsAtomic(n.body) && n.max === Infinity) {
        out.push({
          severity: 'warning',
          code: 'catastrophic-backtracking',
          message: 'A repeated group contains another unbounded repetition. On text that almost matches, this can take exponential time.',
          span: n.span,
          hint: 'Make the inner and outer repetitions unable to match the same text, use a possessive quantifier or atomic group, or remove one level of repetition.',
        });
      }
    });
  }
  walk(root, (n) => {
    if (n.type === 'class' && n.items.length === 0 && !n.negated) {
      out.push({ severity: 'warning', code: 'empty-class', message: 'An empty class [] never matches anything.', span: n.span });
    }
    if (n.type === 'alternation') {
      const seen = new Map<string, number>();
      n.alternatives.forEach((a) => {
        const key = JSON.stringify(strip(a));
        if (seen.has(key)) {
          out.push({ severity: 'warning', code: 'duplicate-alternative', message: 'This alternative is the same as an earlier one and can never be the reason for a match.', span: a.span });
        }
        seen.set(key, 1);
      });
    }
  });
  return out;
}

function containsAtomic(n: RegexNode): boolean {
  let found = false;
  walk(n, (m) => {
    if (m.type === 'group' && (m.kind === 'atomic' || /look/.test(m.kind))) found = true;
  });
  return found;
}

/** The AST without spans, for structural comparison. */
function strip(n: RegexNode): unknown {
  return JSON.parse(JSON.stringify(n, (k, v) => (k === 'span' || k === 'opSpan' ? undefined : v)));
}
