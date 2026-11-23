import { CharClassNode, ClassItem, RegexAst, RegexNode, ShorthandKind, Span } from '../../contracts';

export type StepKind = 'try' | 'match' | 'fail' | 'backtrack' | 'start' | 'success';

export interface TraceStep {
  kind: StepKind;
  /** Pattern span being evaluated. */
  span: Span;
  /** Position in the text. */
  pos: number;
}

export interface TraceResult {
  steps: TraceStep[];
  /** Total steps, which can exceed `steps.length` when the recording was capped. */
  stepCount: number;
  match: { start: number; end: number; groups: ([number, number] | null)[] } | null;
  /** The step limit was hit: very likely catastrophic backtracking. */
  exhausted: boolean;
  /** Steps per start position, to show where the engine spent its time. */
  stepsPerStart: number[];
}

export const DEFAULT_STEP_LIMIT = 100_000;
export const RECORD_LIMIT = 20_000;
export const MAX_TRACE_TEXT = 5_000;

interface Flags {
  i: boolean;
  m: boolean;
  s: boolean;
}

type Caps = ([number, number] | null)[];
type Cont = (pos: number, caps: Caps) => boolean;

class StepLimit extends Error {}

/**
 * TraceEngine: a backtracking interpreter over the AST that records every step (US-12). It follows the
 * semantics shared by backtracking engines (leftmost, greedy/lazy/possessive, atomic groups, lookaround,
 * backreferences), which is what makes it useful to see *why* a pattern is slow or doesn't match.
 */
export function trace(ast: RegexAst, flags: string, text: string, stepLimit = DEFAULT_STEP_LIMIT): TraceResult {
  return new Tracer(ast, flags, text.slice(0, MAX_TRACE_TEXT), stepLimit).run();
}

class Tracer {
  private readonly steps: TraceStep[] = [];
  private count = 0;
  private readonly groupCount: number;
  private readonly names = new Map<string, number>();

  constructor(
    private readonly ast: RegexAst,
    private readonly flags: string,
    private readonly text: string,
    private readonly limit: number,
  ) {
    this.groupCount = ast.groups.length;
    for (const g of ast.groups) if (g.name) this.names.set(g.name, g.index);
  }

  run(): TraceResult {
    const f: Flags = { i: this.flags.includes('i'), m: this.flags.includes('m'), s: this.flags.includes('s') };
    const stepsPerStart: number[] = [];
    let match: TraceResult['match'] = null;
    let exhausted = false;
    try {
      for (let start = 0; start <= this.text.length; start++) {
        const before = this.count;
        this.step('start', this.ast.root.span, start);
        const caps: Caps = new Array(this.groupCount + 1).fill(null);
        const ok = this.m(this.ast.root, start, caps, f, (end, c) => {
          match = { start, end, groups: c.slice(1) };
          this.step('success', this.ast.root.span, end);
          return true;
        });
        stepsPerStart.push(this.count - before);
        if (ok) break;
      }
    } catch (e) {
      if (!(e instanceof StepLimit)) throw e;
      exhausted = true;
    }
    return { steps: this.steps, stepCount: this.count, match, exhausted, stepsPerStart };
  }

  private step(kind: StepKind, span: Span, pos: number) {
    if (++this.count > this.limit) throw new StepLimit();
    if (this.steps.length < RECORD_LIMIT) this.steps.push({ kind, span, pos });
  }

  /** Matches `n` at `pos`, then calls `k`. Returns true when the whole match (via `k`) succeeds. */
  private m(n: RegexNode, pos: number, caps: Caps, f: Flags, k: Cont): boolean {
    switch (n.type) {
      case 'empty':
      case 'comment':
      case 'inlineFlags':
        return k(pos, caps);
      case 'sequence':
        return this.seq(n.items, 0, pos, caps, f, k);
      case 'alternation':
        for (const a of n.alternatives) {
          this.step('try', a.span, pos);
          if (this.m(a, pos, caps, f, k)) return true;
          this.step('backtrack', a.span, pos);
        }
        return false;
      case 'char':
      case 'dot':
      case 'class':
      case 'shorthand':
      case 'property': {
        const cp = this.text.codePointAt(pos);
        const ok = cp !== undefined && this.charMatches(n, String.fromCodePoint(cp), f);
        this.step(ok ? 'match' : 'fail', n.span, pos);
        if (!ok) return false;
        return k(pos + (cp! > 0xffff ? 2 : 1), caps);
      }
      case 'anchor': {
        const ok = this.anchor(n.kind, pos, f);
        this.step(ok ? 'match' : 'fail', n.span, pos);
        return ok && k(pos, caps);
      }
      case 'backreference': {
        const idx = typeof n.ref === 'number' ? n.ref : this.names.get(n.ref) ?? 0;
        const g = caps[idx];
        const sub = g ? this.text.slice(g[0], g[1]) : '';
        const here = this.text.slice(pos, pos + sub.length);
        const ok = f.i ? here.toLowerCase() === sub.toLowerCase() : here === sub;
        this.step(ok ? 'match' : 'fail', n.span, pos);
        return ok && k(pos + sub.length, caps);
      }
      case 'group':
        return this.group(n, pos, caps, f, k);
      case 'quantifier':
        return this.quant(n, n.min, n.max, pos, caps, f, k, -1);
      case 'unsupported':
        this.step('fail', n.span, pos);
        return false;
    }
  }

  private seq(items: RegexNode[], i: number, pos: number, caps: Caps, f: Flags, k: Cont): boolean {
    if (i === items.length) return k(pos, caps);
    const item = items[i];
    if (item.type === 'inlineFlags') {
      return this.seq(items, i + 1, pos, caps, applyFlags(f, item.modifiers), k);
    }
    return this.m(item, pos, caps, f, (p, c) => this.seq(items, i + 1, p, c, f, k));
  }

  private group(n: RegexNode & { type: 'group' }, pos: number, caps: Caps, f: Flags, k: Cont): boolean {
    this.step('try', n.span, pos);
    const inner = n.kind === 'modifiers' && n.modifiers ? applyFlags(f, n.modifiers) : f;
    switch (n.kind) {
      case 'capture':
      case 'named': {
        const idx = n.index!;
        return this.m(n.body, pos, caps, inner, (end, c) => {
          const saved = c[idx];
          c[idx] = [pos, end];
          if (k(end, c)) return true;
          c[idx] = saved;
          this.step('backtrack', n.span, end);
          return false;
        });
      }
      case 'noncapture':
      case 'modifiers':
        return this.m(n.body, pos, caps, inner, k);
      case 'atomic': {
        let end = -1;
        let snapshot: Caps = caps;
        const ok = this.m(n.body, pos, caps.slice(), inner, (e, c) => ((end = e), (snapshot = c.slice()), true));
        if (!ok) return false;
        return k(end, snapshot);
      }
      case 'lookahead':
      case 'negativeLookahead': {
        let snapshot: Caps = caps;
        const found = this.m(n.body, pos, caps.slice(), inner, (_e, c) => ((snapshot = c.slice()), true));
        const ok = n.kind === 'lookahead' ? found : !found;
        this.step(ok ? 'match' : 'fail', n.span, pos);
        return ok && k(pos, n.kind === 'lookahead' ? snapshot : caps);
      }
      case 'lookbehind':
      case 'negativeLookbehind': {
        let found = false;
        let snapshot: Caps = caps;
        for (let start = pos; start >= 0 && !found; start--) {
          found = this.m(n.body, start, caps.slice(), inner, (e, c) => (e === pos ? ((snapshot = c.slice()), true) : false));
        }
        const ok = n.kind === 'lookbehind' ? found : !found;
        this.step(ok ? 'match' : 'fail', n.span, pos);
        return ok && k(pos, n.kind === 'lookbehind' ? snapshot : caps);
      }
    }
  }

  private quant(n: RegexNode & { type: 'quantifier' }, min: number, max: number, pos: number, caps: Caps, f: Flags, k: Cont, lastPos: number): boolean {
    // An iteration that consumed nothing ends the loop, as in every backtracking engine.
    if (pos === lastPos && min <= 0) return k(pos, caps);
    if (n.possessive) {
      let p = pos;
      let c = caps.slice();
      let count = 0;
      while (count < max) {
        let next = -1;
        let nc: Caps = c;
        const ok = this.m(n.body, p, c.slice(), f, (e, cc) => ((next = e), (nc = cc.slice()), true));
        if (!ok || next === p) break;
        p = next;
        c = nc;
        count++;
      }
      if (count < min) return false;
      return k(p, c);
    }
    const iterate = () =>
      max > 0 && this.m(n.body, pos, caps, f, (p, c) => this.quant(n, min - 1, max - 1, p, c, f, k, pos));
    if (min > 0) return iterate();
    if (n.lazy) {
      if (k(pos, caps)) return true;
      this.step('backtrack', n.opSpan, pos);
      return iterate();
    }
    if (iterate()) return true;
    this.step('backtrack', n.opSpan, pos);
    return k(pos, caps);
  }

  private anchor(kind: string, pos: number, f: Flags): boolean {
    const t = this.text;
    const isWord = (i: number) => i >= 0 && i < t.length && /\w/.test(t[i]);
    switch (kind) {
      case 'lineStart': return pos === 0 || (f.m && t[pos - 1] === '\n');
      case 'lineEnd': return pos === t.length || (f.m && t[pos] === '\n');
      case 'wordBoundary': return isWord(pos - 1) !== isWord(pos);
      case 'notWordBoundary': return isWord(pos - 1) === isWord(pos);
      case 'stringStart': return pos === 0;
      case 'stringEnd': return pos === t.length;
      case 'stringEndNewline': return pos === t.length || (pos === t.length - 1 && t[pos] === '\n');
      default: return true;
    }
  }

  private charMatches(n: RegexNode, c: string, f: Flags): boolean {
    switch (n.type) {
      case 'char': return f.i ? c.toLowerCase() === n.value.toLowerCase() : c === n.value;
      case 'dot': return f.s || (c !== '\n' && c !== '\r' && c !== '\u2028' && c !== '\u2029');
      case 'shorthand': return shorthand(n.kind, c);
      case 'property': return property(n.name, n.negated, c);
      case 'class': return classMatches(n, c, f);
      default: return false;
    }
  }
}

function applyFlags(f: Flags, m: { on: string; off: string }): Flags {
  const r = { ...f };
  for (const x of m.on) if (x in r) r[x as keyof Flags] = true;
  for (const x of m.off) if (x in r) r[x as keyof Flags] = false;
  return r;
}

const SHORTHAND_RE: Record<string, RegExp> = {
  d: /\d/, D: /\D/, w: /\w/, W: /\W/, s: /\s/, S: /\S/, h: /[\t \xa0 ᠎ -   　]/,
  H: /[^\t \xa0 ᠎ -   　]/, v: /[\n\x0b\f\r\x85\u2028\u2029]/, V: /[^\n\x0b\f\r\x85\u2028\u2029]/, N: /[^\n]/, R: /[\n\x0b\f\r\x85\u2028\u2029]/,
};

function shorthand(kind: ShorthandKind, c: string): boolean {
  return SHORTHAND_RE[kind].test(c);
}

const propertyCache = new Map<string, RegExp | null>();
function property(name: string, negated: boolean, c: string): boolean {
  if (!propertyCache.has(name)) {
    try {
      propertyCache.set(name, new RegExp(`^\\p{${name}}$`, 'u'));
    } catch {
      propertyCache.set(name, null);
    }
  }
  const re = propertyCache.get(name);
  return re ? re.test(c) !== negated : false;
}

const POSIX: Record<string, RegExp> = {
  alpha: /[a-zA-Z]/, digit: /\d/, alnum: /[a-zA-Z0-9]/, upper: /[A-Z]/, lower: /[a-z]/, space: /\s/, punct: /[!-\/:-@[-`{-~]/,
  xdigit: /[0-9a-fA-F]/, word: /\w/, blank: /[ \t]/, cntrl: /[\x00-\x1f\x7f]/, graph: /[!-~]/, print: /[ -~]/, ascii: /[\x00-\x7f]/,
};

function classMatches(n: CharClassNode, c: string, f: Flags): boolean {
  // Evaluate operands joined by set operations left to right; plain items form a union.
  let acc: boolean | null = null;
  let op: string | null = null;
  let union = false;
  const flush = () => {
    acc = acc === null ? union : op === '&&' ? acc && union : op === '--' ? acc && !union : op === '~~' ? acc !== union : acc || union;
    union = false;
  };
  for (const item of n.items) {
    if (item.type === 'setop') {
      flush();
      op = item.op;
      continue;
    }
    if (itemMatches(item, c, f)) union = true;
  }
  flush();
  return n.negated ? !acc : !!acc;
}

function itemMatches(item: ClassItem, c: string, f: Flags): boolean {
  switch (item.type) {
    case 'char': return f.i ? c.toLowerCase() === item.value.toLowerCase() : c === item.value;
    case 'range': {
      const inRange = (x: string) => x >= item.from && x <= item.to;
      return inRange(c) || (f.i && (inRange(c.toLowerCase()) || inRange(c.toUpperCase())));
    }
    case 'shorthand': return shorthand(item.kind, c);
    case 'property': return property(item.name, item.negated, c);
    case 'posix': return POSIX[item.name] ? POSIX[item.name].test(c) !== item.negated : false;
    case 'class': return classMatches(item.node, c, f);
    case 'setop': return false;
  }
}
