import { CharClassNode, ClassItem, Diagnostic, FlagModifier, RegexAst, RegexNode, ShorthandKind } from '../../contracts';
import { Dialect } from '../syntax/dialects';

export interface PrintOptions {
  /** Flags of the source pattern. */
  flags: string;
  /**
   * `exact`: preserve the source's matching semantics at the cost of readability (used to execute a pattern on
   * another engine). `readable`: keep the pattern recognisable, and warn where semantics differ (conversion).
   */
  mode: 'exact' | 'readable';
}

export interface PrintResult {
  source: string;
  flags: string;
  diagnostics: Diagnostic[];
  /** For every capture group of the printed pattern (1-based, index 0 unused): the source group index, or null for helper groups. */
  groupMap: (number | null)[];
}

const POSIX_JS: Record<string, string> = {
  alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z', space: ' \\t\\n\\r\\f\\v',
  punct: '!-\\/:-@\\[-`{-~', xdigit: '0-9A-Fa-f', word: '\\w', blank: ' \\t', cntrl: '\\x00-\\x1f\\x7f',
  graph: '!-~', print: ' -~', ascii: '\\x00-\\x7f',
};

const EXPANSIONS: Partial<Record<ShorthandKind, { cls: string; neg: boolean }>> = {
  h: { cls: '\\t \\xa0\\u1680\\u180e\\u2000-\\u200a\\u202f\\u205f\\u3000', neg: false },
  H: { cls: '\\t \\xa0\\u1680\\u180e\\u2000-\\u200a\\u202f\\u205f\\u3000', neg: true },
  v: { cls: '\\n\\x0b\\f\\r\\x85\\u2028\\u2029', neg: false },
  V: { cls: '\\n\\x0b\\f\\r\\x85\\u2028\\u2029', neg: true },
  N: { cls: '\\n', neg: true },
};

/**
 * Prints an AST for a target dialect. This is how flavors are converted into each other (US-07), and how
 * PCRE/Python/Java/.NET patterns run on the browser's engine with their own semantics.
 */
export function print(ast: RegexAst, source: Dialect, target: Dialect, opts: PrintOptions): PrintResult {
  return new Printer(ast, source, target, opts).run();
}

class Printer {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly groupMap: (number | null)[] = [null];
  /** Source group index → printed group index. */
  private readonly indexMap = new Map<number, number>();
  private readonly outFlags = new Set<string>();
  private readonly swapGreed: boolean;
  private readonly explicitCapture: boolean;
  private readonly multiline: boolean;
  private needsUnicode = false;
  private needsSets = false;
  /** Group indices are known only after a pre-pass, because helper groups shift numbering. */
  private nextIndex = 1;

  constructor(
    private readonly ast: RegexAst,
    private readonly src: Dialect,
    private readonly tgt: Dialect,
    private readonly opts: PrintOptions,
  ) {
    this.swapGreed = opts.flags.includes('U') && !tgt.flags.some((f) => f.letter === 'U');
    this.explicitCapture = opts.flags.includes('n') && src.id === 'dotnet' && tgt.id !== 'dotnet';
    this.multiline = opts.flags.includes('m');
    for (const f of opts.flags) {
      if (f === 'x') continue; // whitespace and comments are already gone from the AST
      if (f === 'U' && this.swapGreed) continue;
      if (f === 'n' && this.explicitCapture) continue;
      if (tgt.flags.some((t) => t.letter === f)) this.outFlags.add(f);
      else if (!'au'.includes(f)) this.note('warning', `${tgt.name} has no "${f}" flag; it was dropped.`);
    }
  }

  run(): PrintResult {
    let root = this.ast.root;
    // Inline flags at the very start apply to the whole pattern: turn them into pattern flags where the target
    // can't express them inline.
    root = this.hoistLeadingFlags(root);
    this.numberGroups(root);
    const source = this.node(root, false);
    if (this.tgt.id === 'ecmascript') {
      if (this.needsSets) this.outFlags.add('v');
      else if (this.needsUnicode || this.opts.mode === 'exact') this.outFlags.add('u');
      if (this.outFlags.has('v')) this.outFlags.delete('u');
    }
    const order = this.tgt.flags.map((f) => f.letter);
    const flags = [...this.outFlags].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join('');
    return { source, flags, diagnostics: this.diagnostics, groupMap: this.groupMap };
  }

  private note(severity: Diagnostic['severity'], message: string, span?: { start: number; end: number }, hint?: string) {
    if (this.diagnostics.some((d) => d.message === message)) return;
    this.diagnostics.push({ severity, code: 'conversion', message, span, hint });
  }

  private hoistLeadingFlags(root: RegexNode): RegexNode {
    const first = root.type === 'sequence' ? root.items[0] : root;
    if (first?.type !== 'inlineFlags' || this.tgt.inlineFlags === 'full') return root;
    for (const f of first.modifiers.on) {
      if (this.tgt.flags.some((t) => t.letter === f)) this.outFlags.add(f);
    }
    for (const f of first.modifiers.off) this.outFlags.delete(f);
    if (root.type === 'sequence') return { ...root, items: root.items.slice(1) };
    return { type: 'empty', span: root.span };
  }

  /** Assigns printed group numbers in the order groups will be printed, including helper groups. */
  private numberGroups(n: RegexNode) {
    const visit = (m: RegexNode) => {
      switch (m.type) {
        case 'alternation': m.alternatives.forEach(visit); break;
        case 'sequence': m.items.forEach(visit); break;
        case 'quantifier':
          if (this.emulatesAtomic(m)) this.groupMap.push(null), this.nextIndex++;
          visit(m.body);
          break;
        case 'group':
          if (m.kind === 'atomic' && !this.tgt.atomic && this.canEmulateAtomic()) this.groupMap.push(null), this.nextIndex++;
          if ((m.kind === 'capture' && !this.explicitCapture) || m.kind === 'named') {
            this.indexMap.set(m.index!, this.nextIndex++);
            this.groupMap.push(m.index!);
          }
          visit(m.body);
          break;
      }
    };
    visit(n);
  }

  private canEmulateAtomic(): boolean {
    return this.tgt.lookahead && this.tgt.backreferences;
  }

  private emulatesAtomic(q: RegexNode & { type: 'quantifier' }): boolean {
    return q.possessive && !this.tgt.possessive && !this.tgt.atomic && this.canEmulateAtomic();
  }

  private helperIndex = 0;
  private takeHelper(): number {
    // Helper groups are numbered in print order; find the next null slot.
    for (let i = this.helperIndex + 1; i < this.groupMap.length; i++) {
      if (this.groupMap[i] === null) {
        this.helperIndex = i;
        return i;
      }
    }
    return 0;
  }

  // ── nodes ────────────────────────────────────────────────────────────────────────────────────────────────

  private node(n: RegexNode, inSeq: boolean): string {
    switch (n.type) {
      case 'empty': return '';
      case 'alternation': {
        const s = n.alternatives.map((a) => this.node(a, false)).join('|');
        return inSeq ? `(?:${s})` : s;
      }
      case 'sequence': return this.sequence(n.items);
      case 'char': return this.char(n.value, false);
      case 'dot': return '.';
      case 'shorthand': return this.shorthand(n.kind, false);
      case 'property': return this.property(n.name, n.negated, n.span);
      case 'class': return this.charClass(n);
      case 'anchor': return this.anchor(n);
      case 'group': return this.group(n);
      case 'quantifier': return this.quantifier(n);
      case 'backreference': return this.backref(n);
      case 'inlineFlags': {
        // Reached only when not at the start; handled by `sequence` for scoped targets.
        if (this.tgt.inlineFlags === 'full') return `(?${n.modifiers.on}${n.modifiers.off ? '-' + n.modifiers.off : ''})`;
        this.note('error', `${this.tgt.name} can't change flags in the middle of a pattern.`, n.span);
        return '';
      }
      case 'comment':
        if (this.tgt.comments && this.opts.mode === 'readable') return `(?#${n.text})`;
        return '';
      case 'unsupported':
        this.note('error', `"${n.text}" can't be converted.`, n.span);
        return n.text;
    }
  }

  private sequence(items: RegexNode[]): string {
    let out = '';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type === 'inlineFlags' && this.tgt.inlineFlags === 'scoped') {
        // (?i) for the rest of the group → (?i:rest)
        const rest = this.sequence(items.slice(i + 1));
        return out + `(?${this.modifierText(item.modifiers)}:${rest})`;
      }
      let printed = this.node(item, true);
      // `\1` followed by a digit would read as `\10`.
      const next = items[i + 1];
      if (item.type === 'backreference' && next?.type === 'char' && /\d/.test(next.value)) printed = `(?:${printed})`;
      out += printed;
    }
    return out;
  }

  private modifierText(m: FlagModifier): string {
    const ok = (f: string) => this.tgt.inlineFlagLetters.includes(f);
    const on = [...m.on].filter(ok).join('');
    const off = [...m.off].filter(ok).join('');
    for (const f of [...m.on, ...m.off].filter((f) => !ok(f))) this.note('warning', `${this.tgt.name} has no inline "${f}" flag; it was dropped.`);
    return on + (off ? '-' + off : '');
  }

  private group(n: RegexNode & { type: 'group' }): string {
    const body = this.node(n.body, false);
    switch (n.kind) {
      case 'capture':
        return this.explicitCapture ? `(?:${body})` : `(${body})`;
      case 'named': {
        const name = n.name!;
        if (this.tgt.namedGroup.angle) return `(?<${name}>${body})`;
        if (this.tgt.namedGroup.pAngle) return `(?P<${name}>${body})`;
        return `(?'${name}'${body})`;
      }
      case 'noncapture': return `(?:${body})`;
      case 'lookahead':
      case 'negativeLookahead':
      case 'lookbehind':
      case 'negativeLookbehind': {
        const op = { lookahead: '?=', negativeLookahead: '?!', lookbehind: '?<=', negativeLookbehind: '?<!' }[n.kind];
        const supported = n.kind.includes('ahead') ? this.tgt.lookahead : this.tgt.lookbehind;
        if (!supported) this.note('error', `${this.tgt.name} has no lookaround; this part can't be converted.`, n.span,
          'Restructure the pattern, or check the condition in code after matching.');
        return `(${op}${body})`;
      }
      case 'atomic': {
        if (this.tgt.atomic) return `(?>${body})`;
        if (this.canEmulateAtomic()) {
          const h = this.takeHelper();
          if (this.opts.mode === 'readable') this.note('info', `${this.tgt.name} has no atomic groups; emulated with (?=(…))\\${h}.`, n.span);
          return `(?=(${body}))\\${h}`;
        }
        this.note('warning', `${this.tgt.name} has no atomic groups; converted to a plain group (same matches, different performance).`, n.span);
        return `(?:${body})`;
      }
      case 'modifiers': {
        const m = n.modifiers!;
        if (this.tgt.inlineFlags !== 'none') return `(?${this.modifierText(m)}:${body})`;
        this.note('error', `${this.tgt.name} has no inline flags.`, n.span);
        return `(?:${body})`;
      }
    }
  }

  private quantifier(n: RegexNode & { type: 'quantifier' }): string {
    let body = this.node(n.body, true);
    if (needsGroupForQuantifier(n.body)) body = `(?:${body})`;
    let op: string;
    if (n.min === 0 && n.max === Infinity) op = '*';
    else if (n.min === 1 && n.max === Infinity) op = '+';
    else if (n.min === 0 && n.max === 1) op = '?';
    else if (n.min === n.max) op = `{${n.min}}`;
    else if (n.max === Infinity) op = `{${n.min},}`;
    else op = `{${n.min},${n.max}}`;
    const lazy = this.swapGreed ? !n.lazy : n.lazy;
    if (n.possessive) {
      if (this.tgt.possessive) return body + op + '+';
      if (this.tgt.atomic) return `(?>${body}${op})`;
      if (this.canEmulateAtomic()) {
        const h = this.takeHelper();
        if (this.opts.mode === 'readable') this.note('info', `${this.tgt.name} has no possessive quantifiers; emulated with (?=(…))\\${h}.`, n.opSpan);
        return `(?=(${body}${op}))\\${h}`;
      }
      this.note('warning', `${this.tgt.name} has no possessive quantifiers; converted to a greedy one.`, n.opSpan);
      return body + op;
    }
    return body + op + (lazy && n.min !== n.max ? '?' : '');
  }

  private backref(n: RegexNode & { type: 'backreference' }): string {
    if (!this.tgt.backreferences) {
      this.note('error', `${this.tgt.name} has no backreferences.`, n.span);
    }
    if (typeof n.ref === 'string') {
      const b = this.tgt.namedBackref;
      if (b.kAngle) return `\\k<${n.ref}>`;
      if (b.pEquals) return `(?P=${n.ref})`;
      if (b.kQuote) return `\\k'${n.ref}'`;
      const g = this.ast.groups.find((x) => x.name === n.ref);
      return `\\${this.indexMap.get(g?.index ?? 0) ?? 0}`;
    }
    return `\\${this.indexMap.get(n.ref) ?? n.ref}`;
  }

  private anchor(n: RegexNode & { type: 'anchor' }): string {
    const exact = this.opts.mode === 'exact';
    const t = this.tgt;
    switch (n.kind) {
      case 'lineStart': return '^';
      case 'lineEnd':
        if (!this.multiline && this.src.dollarBeforeFinalNewline !== t.dollarBeforeFinalNewline) {
          if (this.src.dollarBeforeFinalNewline) {
            // PCRE-like $ (end or before a final \n) on a strict target
            if (exact || t.lookahead) return t.lookahead ? '(?=\\n?(?![\\s\\S]))' : '$';
          } else if (t.anchors.z) {
            if (exact) return '\\z';
            this.note('info', `In ${t.name}, $ also matches before a final line break. Use \\z for the exact ${this.src.name} meaning.`, n.span);
          }
        }
        return '$';
      case 'wordBoundary': return '\\b';
      case 'notWordBoundary': return '\\B';
      case 'stringStart':
        if (t.anchors.A) return '\\A';
        if (!this.multiline) return '^';
        if (t.lookbehind) return '(?<![\\s\\S])';
        this.note('error', `${t.name} can't express \\A with the multiline flag on.`, n.span);
        return '^';
      case 'stringEnd':
        if (t.anchors.z) return '\\z';
        if (!this.multiline && !t.dollarBeforeFinalNewline) return '$';
        if (t.lookahead) return '(?![\\s\\S])';
        this.note('error', `${t.name} can't express \\z here.`, n.span);
        return '$';
      case 'stringEndNewline':
        if (t.anchors.Z) return '\\Z';
        if (t.lookahead) return '(?=\\n?(?![\\s\\S]))';
        this.note('error', `${t.name} can't express \\Z.`, n.span);
        return '$';
      case 'matchStart':
        if (t.anchors.G) return '\\G';
        this.note(exact ? 'warning' : 'error', `${t.name} has no \\G; it was dropped.`, n.span, exact ? 'Use the y (sticky) flag in JavaScript.' : undefined);
        return '';
      case 'keepOut':
        if (t.anchors.K) return '\\K';
        this.note(exact ? 'warning' : 'error', `${t.name} has no \\K; the reported match includes the text before it.`, n.span,
          'Use a lookbehind for the part before \\K.');
        return '';
    }
  }

  // ── characters ───────────────────────────────────────────────────────────────────────────────────────────

  private shorthand(kind: ShorthandKind, inClass: boolean): string {
    const exact = this.opts.mode === 'exact';
    const unicode = this.src.unicodeShorthands && !this.opts.flags.includes('a');
    if (exact && unicode && !this.tgt.unicodeShorthands && 'dDwW'.includes(kind)) {
      this.needsUnicode = true;
      const cls = kind.toLowerCase() === 'd' ? '\\p{Nd}' : '\\p{L}\\p{N}\\p{Mn}\\p{Pc}';
      const neg = kind === 'D' || kind === 'W';
      if (inClass && !neg) return cls;
      if (inClass) return this.classInClass(`[^${cls}]`);
      return neg ? `[^${cls}]` : (kind.toLowerCase() === 'd' ? cls : `[${cls}]`);
    }
    if (this.tgt.shorthands.includes(kind) || 'dDwWsS'.includes(kind)) return '\\' + kind;
    if (kind === 'R') {
      if (inClass) {
        this.note('error', '\\R can\'t be used inside a class.');
        return '';
      }
      return '(?:\\r\\n|[\\n\\x0b\\f\\r\\x85\\u2028\\u2029])';
    }
    const e = EXPANSIONS[kind]!;
    if (!inClass) return `[${e.neg ? '^' : ''}${e.cls}]`;
    if (!e.neg) return e.cls;
    return this.classInClass(`[^${e.cls}]`);
  }

  private classInClass(cls: string): string {
    if (this.tgt.id === 'ecmascript') {
      this.needsSets = true;
      return cls;
    }
    if (this.tgt.classSetOperations) return cls;
    this.note('warning', `A negated shorthand inside a class can't be expressed exactly in ${this.tgt.name}.`);
    return cls.slice(2, -1);
  }

  private property(name: string, negated: boolean, span: { start: number; end: number }): string {
    if (this.tgt.unicodeProperties === 'never') {
      this.note('error', `${this.tgt.name} has no Unicode properties (\\p{${name}}).`, span);
    }
    if (this.tgt.id === 'ecmascript') this.needsUnicode = true;
    return `\\${negated ? 'P' : 'p'}{${name}}`;
  }

  private char(c: string, inClass: boolean): string {
    const cp = c.codePointAt(0)!;
    const special = inClass ? '\\]^-[' : '\\^$.|?*+()[]{}';
    if (special.includes(c)) return '\\' + c;
    if (c === '\n') return '\\n';
    if (c === '\r') return '\\r';
    if (c === '\t') return '\\t';
    if (c === '\f') return '\\f';
    if (c === '\v') return '\\x0b';
    if (cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp < 0xa0)) return '\\x' + cp.toString(16).padStart(2, '0');
    if (cp > 0xffff && this.tgt.id === 'ecmascript') this.needsUnicode = true;
    if (inClass && this.tgt.id === 'ecmascript' && this.needsSets && '&!#$%*+,.:;<=>?@`~'.includes(c)) return '\\' + c;
    return c;
  }

  private charClass(n: CharClassNode): string {
    const hasSetOp = n.items.some((i) => i.type === 'setop' || i.type === 'class');
    if (hasSetOp && this.tgt.id === 'ecmascript') this.needsSets = true;
    if (hasSetOp && !this.tgt.classSetOperations) {
      this.note('error', `${this.tgt.name} has no nested classes or set operations.`, n.span);
    }
    let body: string;
    if (hasSetOp && this.tgt.id === 'ecmascript' && n.items.some((i) => i.type === 'setop')) {
      // JS v-mode: operands of && and -- must be single nested classes or characters.
      const operands: ClassItem[][] = [[]];
      const ops: string[] = [];
      for (const i of n.items) {
        if (i.type === 'setop') {
          ops.push(i.op);
          operands.push([]);
        } else operands[operands.length - 1].push(i);
      }
      body = operands
        .map((items, k) => {
          const inner = items.map((i) => this.classItem(i)).join('');
          const single = items.length === 1 && (items[0].type === 'class' || items[0].type === 'char');
          return (single ? inner : `[${inner}]`) + (k < ops.length ? ops[k] : '');
        })
        .join('');
    } else {
      body = n.items.map((i) => this.classItem(i)).join('');
    }
    return `[${n.negated ? '^' : ''}${body}]`;
  }

  private classItem(i: ClassItem): string {
    switch (i.type) {
      case 'char': return this.char(i.value, true);
      case 'range': return `${this.char(i.from, true)}-${this.char(i.to, true)}`;
      case 'shorthand': return this.shorthand(i.kind, true);
      case 'property': return this.property(i.name, i.negated, i.span);
      case 'posix':
        if (this.tgt.posixClasses) return `[:${i.negated ? '^' : ''}${i.name}:]`;
        if (i.negated) return this.classInClass(`[^${POSIX_JS[i.name] ?? ''}]`);
        return POSIX_JS[i.name] ?? '';
      case 'class': return this.charClass(i.node);
      case 'setop': return i.op;
    }
  }
}

function needsGroupForQuantifier(n: RegexNode): boolean {
  return n.type === 'sequence' || n.type === 'alternation';
}
