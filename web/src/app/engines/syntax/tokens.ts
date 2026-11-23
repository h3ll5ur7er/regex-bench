import { PatternToken, RegexNode, TokenKind } from '../../contracts';

/** Splits the pattern source into coloured tokens, derived from the AST so colours never disagree with it. */
export function tokenize(root: RegexNode): PatternToken[] {
  const out: PatternToken[] = [];
  const push = (start: number, end: number, kind: TokenKind, depth: number, group?: number) => {
    if (end > start) out.push({ span: { start, end }, kind, depth, group });
  };
  const visit = (n: RegexNode, depth: number, group?: number) => {
    switch (n.type) {
      case 'alternation':
        n.alternatives.forEach((a, i) => {
          visit(a, depth, group);
          if (i < n.alternatives.length - 1) push(a.span.end, a.span.end + 1, 'alternation', depth, group);
        });
        break;
      case 'sequence':
        n.items.forEach((i) => visit(i, depth, group));
        break;
      case 'group': {
        const kind: TokenKind = /look/.test(n.kind) ? 'lookaround' : n.kind === 'modifiers' ? 'flags' : 'group';
        const g = n.index ?? group;
        push(n.span.start, n.body.span.start, kind, depth, n.index);
        visit(n.body, depth + 1, g);
        push(n.body.span.end, n.span.end, kind, depth, n.index);
        break;
      }
      case 'quantifier':
        visit(n.body, depth, group);
        push(n.opSpan.start, n.opSpan.end, 'quantifier', depth, group);
        break;
      case 'char':
        push(n.span.start, n.span.end, n.escape ? 'escape' : 'literal', depth, group);
        break;
      case 'dot':
        push(n.span.start, n.span.end, 'meta', depth, group);
        break;
      case 'class':
      case 'shorthand':
      case 'property':
        push(n.span.start, n.span.end, 'class', depth, group);
        break;
      case 'anchor':
        push(n.span.start, n.span.end, 'anchor', depth, group);
        break;
      case 'backreference':
        push(n.span.start, n.span.end, 'backref', depth, typeof n.ref === 'number' ? n.ref : undefined);
        break;
      case 'inlineFlags':
        push(n.span.start, n.span.end, 'flags', depth, group);
        break;
      case 'comment':
        push(n.span.start, n.span.end, 'comment', depth, group);
        break;
      case 'unsupported':
        push(n.span.start, n.span.end, 'unsupported', depth, group);
        break;
      case 'empty':
        break;
    }
  };
  visit(root, 0);
  return out;
}
