import { ClassItem, ExplainNode, RegexNode, TokenKind } from '../../contracts';
import { ReferenceAccess as R } from '../../access/reference.access';
import { Dialect } from './dialects';

export interface ExplainContext {
  source: string;
  flags: string;
  dialect: Dialect;
}

/** Builds a plain-language explanation tree that mirrors the AST, with spans for two-way highlighting. */
export function explain(root: RegexNode, ctx: ExplainContext): ExplainNode[] {
  if (root.type === 'empty') return [];
  return root.type === 'sequence' ? explainSequence(root.items, ctx) : [explainNode(root, ctx)];
}

function code(ctx: ExplainContext, start: number, end: number): string {
  const s = ctx.source.slice(start, end);
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
}

export function describeChar(c: string): string {
  const names: Record<string, string> = {
    '\n': 'a line feed', '\r': 'a carriage return', '\t': 'a tab', ' ': 'a space', '\f': 'a form feed',
    '\v': 'a vertical tab', '\0': 'a null character', '\b': 'a backspace', '\x1b': 'an escape character',
  };
  if (names[c]) return names[c];
  const cp = c.codePointAt(0)!;
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return `the control character U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  if (/[​-‏‪-‮⁦-⁩﻿]/.test(c)) return `the invisible character U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  return `"${c}"`;
}

function node(kind: TokenKind, ctx: ExplainContext, n: { span: { start: number; end: number } }, text: string, children: ExplainNode[] = [], group?: number): ExplainNode {
  return { kind, code: code(ctx, n.span.start, n.span.end), text, span: n.span, children, group };
}

function explainSequence(items: RegexNode[], ctx: ExplainContext): ExplainNode[] {
  const out: ExplainNode[] = [];
  let run: Extract<RegexNode, { type: 'char' }>[] = [];
  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) out.push(explainNode(run[0], ctx));
    else {
      const span = { start: run[0].span.start, end: run[run.length - 1].span.end };
      const text = run.map((c) => c.value).join('');
      const printable = run.every((c) => describeChar(c.value).startsWith('"'));
      out.push({
        kind: 'literal', span, code: code(ctx, span.start, span.end), children: [],
        text: printable ? `The text "${text}"` : `The characters ${run.map((c) => describeChar(c.value)).join(', ')}`,
      });
    }
    run = [];
  };
  for (const item of items) {
    if (item.type === 'char') run.push(item);
    else {
      flush();
      out.push(explainNode(item, ctx));
    }
  }
  flush();
  return out;
}

function quantText(min: number, max: number): string {
  if (min === 0 && max === Infinity) return 'zero or more times';
  if (min === 1 && max === Infinity) return 'one or more times';
  if (min === 0 && max === 1) return 'optionally (zero or one time)';
  if (min === max) return min === 1 ? 'exactly once' : `exactly ${min} times`;
  if (max === Infinity) return `${min} or more times`;
  return `between ${min} and ${max} times`;
}

function classItemText(item: ClassItem, ctx: ExplainContext): string {
  switch (item.type) {
    case 'char': return describeChar(item.value);
    case 'range': return `a character from ${describeChar(item.from)} to ${describeChar(item.to)}`;
    case 'shorthand': return R.shorthand(item.kind);
    case 'property': return `${item.negated ? 'not ' : ''}a character with Unicode property ${item.name}`;
    case 'posix': return `${item.negated ? 'not ' : ''}${R.posix(item.name)}`;
    case 'class': return `${item.node.negated ? 'none of' : 'one of'} [${item.node.items.map((i) => classItemText(i, ctx)).join(', ')}]`;
    case 'setop': return item.op === '&&' ? 'intersected with' : item.op === '--' ? 'minus' : 'symmetric difference with';
  }
}

function explainNode(n: RegexNode, ctx: ExplainContext): ExplainNode {
  const multiline = ctx.flags.includes('m');
  switch (n.type) {
    case 'empty':
      return node('meta', ctx, n, 'Nothing (always matches the empty text here)');
    case 'char':
      return node(n.escape ? 'escape' : 'literal', ctx, n, `The character ${describeChar(n.value)}`);
    case 'dot':
      return node('meta', ctx, n, ctx.flags.includes('s') ? 'Any character, including line breaks' : 'Any character except a line break');
    case 'shorthand':
      return node('class', ctx, n, R.shorthand(n.kind).replace(/^./, (c) => c.toUpperCase()));
    case 'property':
      return node('class', ctx, n, `${n.negated ? 'Any character without' : 'A character with'} the Unicode property ${n.name}`);
    case 'class': {
      const items = n.items.map((i) => classItemText(i, ctx));
      const text = `${n.negated ? 'Any character except' : 'One of'}: ${items.join('; ')}`;
      return node('class', ctx, n, text, n.items.map((i) => ({
        kind: 'class' as const, span: i.span, code: code(ctx, i.span.start, i.span.end), text: classItemText(i, ctx), children: [],
      })));
    }
    case 'anchor': {
      let key: string = n.kind;
      if (n.kind === 'lineStart' && multiline) key = 'lineStartMultiline';
      if (n.kind === 'lineEnd') key = multiline ? 'lineEndMultiline' : ctx.dialect.dollarBeforeFinalNewline ? 'lineEndBeforeNewline' : 'lineEnd';
      const t = R.anchor(key);
      return node('anchor', ctx, n, n.kind === 'keepOut' ? `Matches ${t}` : `Asserts ${t}`);
    }
    case 'alternation':
      return node('alternation', ctx, n, `Either of ${n.alternatives.length} alternatives`, n.alternatives.map((a, i) => {
        const children = a.type === 'sequence' ? explainSequence(a.items, ctx) : a.type === 'empty' ? [] : [explainNode(a, ctx)];
        return { kind: 'alternation' as const, span: a.span, code: code(ctx, a.span.start, a.span.end) || '(empty)',
          text: `Alternative ${i + 1}${a.type === 'empty' ? ': nothing' : ''}`, children };
      }));
    case 'sequence':
      return node('meta', ctx, n, 'In sequence', explainSequence(n.items, ctx));
    case 'group': {
      const body = n.body.type === 'sequence' ? explainSequence(n.body.items, ctx) : n.body.type === 'empty' ? [] : [explainNode(n.body, ctx)];
      let text = R.group(n.kind);
      if (n.kind === 'capture') text = `Capture group ${n.index}`;
      if (n.kind === 'named') text = `Capture group ${n.index} named "${n.name}"`;
      if (n.kind === 'modifiers' && n.modifiers) text = `Group with ${flagText(n.modifiers.on, n.modifiers.off)}`;
      const kind: TokenKind = /look/.test(n.kind) ? 'lookaround' : 'group';
      return node(kind, ctx, n, text, body, n.index);
    }
    case 'quantifier': {
      const mode = n.possessive ? ', possessive: never gives back' : n.lazy ? ', as few as possible' : n.max !== n.min ? ', as many as possible' : '';
      const inner = explainNode(n.body, ctx);
      return {
        kind: 'quantifier', span: n.span, code: code(ctx, n.span.start, n.span.end), group: inner.group,
        text: `${inner.text}, ${quantText(n.min, n.max)}${mode}`,
        children: inner.children.length ? inner.children : [],
      };
    }
    case 'backreference':
      return node('backref', ctx, n, typeof n.ref === 'number'
        ? `The same text that group ${n.ref} matched` : `The same text that the group "${n.ref}" matched`, [], typeof n.ref === 'number' ? n.ref : undefined);
    case 'inlineFlags':
      return node('flags', ctx, n, `From here on: ${flagText(n.modifiers.on, n.modifiers.off)}`);
    case 'comment':
      return node('comment', ctx, n, `Comment: ${n.text}`);
    case 'unsupported':
      return node('unsupported', ctx, n, 'A construct regex-bench does not explain yet');
  }
}

function flagText(on: string, off: string): string {
  const parts: string[] = [];
  if (on) parts.push(`${[...on].map(R.flag).join(', ')} on`);
  if (off) parts.push(`${[...off].map(R.flag).join(', ')} off`);
  return parts.join('; ');
}
