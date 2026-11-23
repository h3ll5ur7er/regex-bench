import {
  AnchorKind,
  CharClassNode,
  ClassItem,
  Diagnostic,
  FlagModifier,
  GroupInfo,
  GroupKind,
  RegexAst,
  RegexNode,
  ShorthandKind,
  Span,
} from '../../contracts';
import { Dialect } from './dialects';

export interface ParseResult {
  ast: RegexAst;
  diagnostics: Diagnostic[];
}

export const MAX_PATTERN_LENGTH = 50_000;
const MAX_DEPTH = 250;

class ParseError extends Error {
  constructor(
    message: string,
    readonly span: Span,
    readonly hint?: string,
  ) {
    super(message);
  }
}

const SHORTHANDS = new Set<string>(['d', 'D', 'w', 'W', 's', 'S', 'h', 'H', 'v', 'V', 'N', 'R']);
const CONTROL_ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', f: '\f', a: '\x07', e: '\x1b' };

/**
 * A recursive-descent parser for every supported flavor. The dialect decides which constructs are accepted;
 * unsupported ones produce diagnostics with a span, not exceptions, wherever the rest of the pattern can still be
 * read. Only structural errors (an unclosed group) stop parsing.
 */
export function parse(source: string, flags: string, dialect: Dialect): ParseResult {
  return new Parser(source, flags, dialect).run();
}

class Parser {
  private pos = 0;
  private depth = 0;
  private groupCount = 0;
  private readonly groups: GroupInfo[] = [];
  private readonly diagnostics: Diagnostic[] = [];
  private readonly backrefs: { node: Extract<RegexNode, { type: 'backreference' }> }[] = [];
  /** The extended flag applies to this group and its nested groups. */
  private extended: boolean;
  private readonly unicodeMode: boolean;
  private readonly unicodeSets: boolean;

  constructor(
    private readonly src: string,
    flags: string,
    private readonly d: Dialect,
  ) {
    this.extended = flags.includes('x') && d.flags.some((f) => f.letter === 'x');
    this.unicodeMode = d.id !== 'ecmascript' || /[uv]/.test(flags);
    this.unicodeSets = d.id === 'ecmascript' ? flags.includes('v') : d.classSetOperations;
    for (const f of flags) {
      if (!d.flags.some((x) => x.letter === f)) {
        this.warn('unknown-flag', `${d.name} has no flag "${f}".`, undefined, 'error');
      }
    }
  }

  run(): ParseResult {
    let root: RegexNode;
    try {
      if (this.src.length > MAX_PATTERN_LENGTH) {
        throw new ParseError(`The pattern is longer than ${MAX_PATTERN_LENGTH} characters.`, { start: 0, end: 0 });
      }
      root = this.alternation();
      if (this.pos < this.src.length) {
        // Only an unmatched ")" can stop the top-level alternation early.
        throw new ParseError('Unmatched ")".', { start: this.pos, end: this.pos + 1 }, 'Remove it, or escape it as \\).');
      }
      this.resolveBackrefs();
      if (this.d.namedGroupsNumberedLast) this.renumberNamedLast(root);
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      this.diagnostics.push({ severity: 'error', code: 'syntax', message: e.message, span: e.span, hint: e.hint });
      root = { type: 'empty', span: { start: 0, end: this.src.length } };
    }
    return { ast: { root, groups: this.groups }, diagnostics: this.diagnostics };
  }

  // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────

  private peek(offset = 0): string {
    return this.src[this.pos + offset] ?? '';
  }

  private startsWith(s: string): boolean {
    return this.src.startsWith(s, this.pos);
  }

  private eof(): boolean {
    return this.pos >= this.src.length;
  }

  private warn(code: string, message: string, span?: Span, severity: Diagnostic['severity'] = 'warning', hint?: string) {
    this.diagnostics.push({ severity, code, message, span, hint });
  }

  private unsupported(what: string, span: Span, hint?: string) {
    this.warn('unsupported-construct', `${this.d.name} does not support ${what}.`, span, 'error', hint);
  }

  /** Reads one code point (so astral characters stay whole in Unicode-aware flavors). */
  private readChar(): string {
    const cp = this.src.codePointAt(this.pos)!;
    const ch = this.unicodeMode ? String.fromCodePoint(cp) : this.src[this.pos];
    this.pos += ch.length;
    return ch;
  }

  /** In extended mode, skips whitespace and `#` comments between tokens. */
  private skipExtended() {
    if (!this.extended) return;
    for (;;) {
      const c = this.peek();
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') {
        this.pos++;
      } else if (c === '#') {
        while (!this.eof() && this.peek() !== '\n') this.pos++;
      } else {
        return;
      }
    }
  }

  // ── structure ────────────────────────────────────────────────────────────────────────────────────────────

  private alternation(): RegexNode {
    const start = this.pos;
    const alternatives = [this.sequence()];
    while (this.peek() === '|') {
      this.pos++;
      alternatives.push(this.sequence());
    }
    if (alternatives.length === 1) return alternatives[0];
    return { type: 'alternation', alternatives, span: { start, end: this.pos } };
  }

  private sequence(): RegexNode {
    const start = this.pos;
    const items: RegexNode[] = [];
    const savedExtended = this.extended;
    for (;;) {
      this.skipExtended();
      if (this.eof() || this.peek() === '|' || this.peek() === ')') break;
      const atom = this.atom(items);
      if (!atom) continue;
      this.skipExtended();
      items.push(this.quantified(atom));
    }
    // (?x) inside an alternative lasts until the end of the enclosing group, which also ends this sequence.
    if (this.peek() === ')' || this.eof()) this.extended = savedExtended;
    if (items.length === 0) return { type: 'empty', span: { start, end: this.pos } };
    if (items.length === 1) return items[0];
    return { type: 'sequence', items, span: { start, end: this.pos } };
  }

  private quantified(atom: RegexNode): RegexNode {
    let node = atom;
    for (;;) {
      const opStart = this.pos;
      const q = this.quantifierToken();
      if (!q) return node;
      if (node.type === 'quantifier') {
        // `a**` is an error in most flavors; a possessive/lazy suffix was already consumed by quantifierToken.
        throw new ParseError('A quantifier cannot follow another quantifier.', { start: opStart, end: this.pos },
          'Wrap the quantified part in a group: (?:a*)*');
      }
      if (node.type === 'anchor' || node.type === 'inlineFlags' || node.type === 'empty') {
        if (node.type === 'anchor' && node.kind !== 'keepOut') {
          this.warn('quantified-anchor', 'Quantifying an anchor has no effect.', { start: opStart, end: this.pos });
        } else {
          throw new ParseError('There is nothing to repeat before this quantifier.', { start: opStart, end: this.pos },
            'Escape it to match the character itself, e.g. \\+ or \\*.');
        }
      }
      if (node.type === 'group' && /look/.test(node.kind) && this.d.id === 'ecmascript' && (this.unicodeMode || /behind/.test(node.kind))) {
        throw new ParseError('A lookaround cannot be quantified here.', { start: opStart, end: this.pos });
      }
      if (node.type === 'group' && /look/.test(node.kind) && this.d.id !== 'ecmascript') {
        this.warn('quantified-lookaround', 'Quantifying a lookaround has no useful effect.', { start: opStart, end: this.pos });
      }
      let lazy = false;
      let possessive = false;
      if (this.peek() === '?') {
        lazy = true;
        this.pos++;
      } else if (this.peek() === '+') {
        possessive = true;
        this.pos++;
        if (!this.d.possessive) this.unsupported('possessive quantifiers', { start: this.pos - 1, end: this.pos },
          'Use an atomic group (?>…) if available, or remove the second +.');
      }
      const opSpan = { start: opStart, end: this.pos };
      if (q.min > q.max) {
        throw new ParseError(`The quantifier's minimum (${q.min}) is larger than its maximum (${q.max}).`, opSpan);
      }
      node = { type: 'quantifier', body: node, min: q.min, max: q.max, lazy, possessive,
        span: { start: node.span.start, end: this.pos }, opSpan };
      this.skipExtended();
    }
  }

  private quantifierToken(): { min: number; max: number } | null {
    const c = this.peek();
    if (c === '*') return this.pos++, { min: 0, max: Infinity };
    if (c === '+') return this.pos++, { min: 1, max: Infinity };
    if (c === '?') return this.pos++, { min: 0, max: 1 };
    if (c !== '{') return null;
    const m = /^\{(\d*)(?:(,)(\d*))?\}/.exec(this.src.slice(this.pos, this.pos + 40));
    if (!m) return null;
    const [whole, lo, comma, hi] = m;
    if (lo === '' && (!comma || !this.d.quantifierOmittedMin)) return null;
    this.pos += whole.length;
    const min = lo === '' ? 0 : Number(lo);
    const max = comma ? (hi === '' ? Infinity : Number(hi)) : min;
    return { min, max };
  }

  private atom(seq: RegexNode[]): RegexNode | null {
    const start = this.pos;
    const c = this.peek();
    switch (c) {
      case '(':
        return this.group();
      case '[':
        return this.charClass();
      case '.':
        this.pos++;
        return { type: 'dot', span: { start, end: this.pos } };
      case '^':
        this.pos++;
        return { type: 'anchor', kind: 'lineStart', span: { start, end: this.pos } };
      case '$':
        this.pos++;
        return { type: 'anchor', kind: 'lineEnd', span: { start, end: this.pos } };
      case '\\':
        return this.escape(seq);
      case '*':
      case '+':
      case '?':
        throw new ParseError('There is nothing to repeat before this quantifier.', { start, end: start + 1 },
          `Escape it as \\${c} to match a literal "${c}".`);
      case '{': {
        if (this.quantifierToken()) {
          const span = { start, end: this.pos };
          throw new ParseError('There is nothing to repeat before this quantifier.', span);
        }
        if (this.d.id === 'ecmascript' && this.unicodeMode) {
          throw new ParseError('A lone "{" is not allowed in Unicode mode.', { start, end: start + 1 }, 'Escape it as \\{.');
        }
        this.pos++;
        return { type: 'char', value: '{', span: { start, end: this.pos } };
      }
      case ']':
      case '}':
        if (this.d.id === 'ecmascript' && this.unicodeMode) {
          throw new ParseError(`A lone "${c}" is not allowed in Unicode mode.`, { start, end: start + 1 }, `Escape it as \\${c}.`);
        }
        this.pos++;
        return { type: 'char', value: c, span: { start, end: this.pos } };
      default: {
        const value = this.readChar();
        return { type: 'char', value, span: { start, end: this.pos } };
      }
    }
  }

  // ── groups ───────────────────────────────────────────────────────────────────────────────────────────────

  private group(): RegexNode {
    const start = this.pos;
    if (++this.depth > MAX_DEPTH) {
      throw new ParseError(`Groups are nested more than ${MAX_DEPTH} levels deep.`, { start, end: start + 1 });
    }
    this.pos++; // (
    let kind: GroupKind = 'capture';
    let name: string | undefined;
    let modifiers: FlagModifier | undefined;
    const savedExtended = this.extended;

    if (this.peek() === '*' && this.d.id === 'pcre') {
      return this.skipUnsupported(start, 'backtracking control verbs like (*FAIL)');
    }
    if (this.peek() === '?') {
      this.pos++;
      const rest = this.src.slice(this.pos, this.pos + 3);
      if (rest.startsWith(':')) {
        kind = 'noncapture';
        this.pos++;
      } else if (rest.startsWith('=') || rest.startsWith('!')) {
        kind = rest[0] === '=' ? 'lookahead' : 'negativeLookahead';
        this.pos++;
        if (!this.d.lookahead) this.unsupported('lookahead', { start, end: this.pos }, 'Rust and Go use RE2 semantics, which have no lookaround.');
      } else if (rest.startsWith('<=') || rest.startsWith('<!')) {
        kind = rest[1] === '=' ? 'lookbehind' : 'negativeLookbehind';
        this.pos += 2;
        if (!this.d.lookbehind) this.unsupported('lookbehind', { start, end: this.pos }, 'Rust and Go use RE2 semantics, which have no lookaround.');
      } else if (rest.startsWith('>')) {
        kind = 'atomic';
        this.pos++;
        if (!this.d.atomic) this.unsupported('atomic groups', { start, end: this.pos }, 'Emulate one with (?=(…))\\1 where lookahead and backreferences exist.');
      } else if (rest.startsWith('P<') || rest.startsWith('<') || rest.startsWith("'")) {
        const style = rest.startsWith('P<') ? 'pAngle' : rest.startsWith('<') ? 'angle' : 'quote';
        this.pos += style === 'pAngle' ? 2 : 1;
        const close = style === 'quote' ? "'" : '>';
        name = this.groupName(close);
        kind = 'named';
        if (!this.d.namedGroup[style]) {
          const preferred = this.d.namedGroup.angle ? '(?<name>…)' : this.d.namedGroup.pAngle ? '(?P<name>…)' : null;
          this.unsupported(`the named-group syntax ${style === 'pAngle' ? '(?P<name>…)' : style === 'angle' ? '(?<name>…)' : "(?'name'…)"}`,
            { start, end: this.pos }, preferred ? `Write it as ${preferred}.` : undefined);
        }
      } else if (rest.startsWith('P=')) {
        this.pos += 2;
        const ref = this.groupName(')');
        this.depth--;
        if (!this.d.namedBackref.pEquals) this.unsupported('(?P=name) backreferences', { start, end: this.pos });
        return this.backref(ref, { start, end: this.pos });
      } else if (rest.startsWith('#')) {
        if (!this.d.comments) this.unsupported('comment groups', { start, end: start + 3 });
        const close = this.src.indexOf(')', this.pos);
        if (close < 0) throw new ParseError('Unclosed comment group.', { start, end: this.src.length });
        const text = this.src.slice(this.pos + 1, close);
        this.pos = close + 1;
        this.depth--;
        return { type: 'comment', text, span: { start, end: this.pos } };
      } else if (/^[a-zA-Z^-]/.test(rest) && !rest.startsWith('P>') && !rest.startsWith('R)')) {
        const m = /^\^?([a-zA-Z]*)(?:-([a-zA-Z]*))?([:)])/.exec(this.src.slice(this.pos, this.pos + 32));
        if (!m) return this.skipUnsupported(start, 'this group syntax');
        this.pos += m[0].length;
        modifiers = { on: m[1], off: m[2] ?? '' };
        const flagsSpan = { start, end: this.pos };
        for (const f of modifiers.on + modifiers.off) {
          if (!this.d.inlineFlagLetters.includes(f)) this.warn('unknown-flag', `Unknown inline flag "${f}".`, flagsSpan, 'error');
        }
        if (this.d.inlineFlags === 'none') this.unsupported('inline flags', flagsSpan);
        if (m[3] === ')') {
          if (this.d.inlineFlags !== 'full') {
            this.unsupported('inline flags that apply to the rest of the pattern', flagsSpan,
              'Use the scoped form (?i:…) or set the flag on the whole pattern.');
          }
          if (modifiers.on.includes('x')) this.extended = true;
          if (modifiers.off.includes('x')) this.extended = false;
          this.depth--;
          return { type: 'inlineFlags', modifiers, span: flagsSpan };
        }
        kind = 'modifiers';
        if (modifiers.on.includes('x')) this.extended = true;
        if (modifiers.off.includes('x')) this.extended = false;
      } else {
        return this.skipUnsupported(start, 'recursion, conditionals and branch-reset groups');
      }
    }

    let index: number | undefined;
    if (kind === 'capture' || kind === 'named') {
      index = ++this.groupCount;
      const info: GroupInfo = { index, name, span: { start, end: start } };
      if (name && this.groups.some((g) => g.name === name)) {
        if (this.d.id === 'ecmascript') {
          this.warn('duplicate-group-name', `The group name "${name}" is used more than once.`, { start, end: this.pos },
            'warning', 'This is only allowed in different alternatives (ES2025).');
        } else {
          this.warn('duplicate-group-name', `The group name "${name}" is used more than once.`, { start, end: this.pos }, 'error');
        }
      }
      this.groups.push(info);
    }
    const body = this.alternation();
    if (this.peek() !== ')') {
      throw new ParseError('This group is never closed.', { start, end: start + 1 }, 'Add a ")" where the group should end.');
    }
    this.pos++;
    this.depth--;
    this.extended = savedExtended;
    const span = { start, end: this.pos };
    if (index !== undefined) this.groups[index - 1].span = span;
    if ((kind === 'lookbehind' || kind === 'negativeLookbehind') && !this.d.unboundedLookbehind && hasUnbounded(body)) {
      this.warn('unbounded-lookbehind', `${this.d.name} requires lookbehind to have a bounded length.`, span, 'error',
        'Replace * and + inside the lookbehind with bounded repetitions like {0,10}.');
    }
    return { type: 'group', kind, body, span, index, name, modifiers };
  }

  private groupName(close: string): string {
    const start = this.pos;
    const end = this.src.indexOf(close, start);
    if (end < 0) throw new ParseError('The group name is never closed.', { start, end: this.src.length });
    const name = this.src.slice(start, end);
    this.pos = end + 1;
    if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name)) {
      throw new ParseError(`"${name}" is not a valid group name.`, { start, end },
        'Names start with a letter or _ and contain letters, digits and _.');
    }
    return name;
  }

  /** Skips a construct we recognise but don't model, keeping the rest of the pattern readable. */
  private skipUnsupported(start: number, what: string): RegexNode {
    let depth = 0;
    while (!this.eof()) {
      const c = this.peek();
      if (c === '\\') this.pos += 2;
      else {
        this.pos++;
        if (c === '(') depth++;
        else if (c === ')' && --depth === 0) break;
      }
    }
    this.depth--;
    const span = { start, end: this.pos };
    const supportedHere = this.d.id === 'pcre';
    this.warn('not-modelled', supportedHere
      ? `regex-bench can't explain or visualise ${what} yet.`
      : `${this.d.name} does not support ${what}.`, span, supportedHere ? 'warning' : 'error');
    return { type: 'unsupported', text: this.src.slice(start, this.pos), span };
  }

  // ── escapes ──────────────────────────────────────────────────────────────────────────────────────────────

  private escape(seq: RegexNode[]): RegexNode | null {
    const start = this.pos;
    this.pos++; // backslash
    if (this.eof()) throw new ParseError('The pattern ends with a lone backslash.', { start, end: this.pos }, 'Write \\\\ for a literal backslash.');
    const c = this.peek();
    const span = () => ({ start, end: this.pos });

    // Anchors
    const anchors: Record<string, AnchorKind> = { b: 'wordBoundary', B: 'notWordBoundary', A: 'stringStart', z: 'stringEnd', Z: 'stringEndNewline', G: 'matchStart', K: 'keepOut' };
    if (c in anchors) {
      this.pos++;
      if ('AzZGK'.includes(c) && !this.d.anchors[c as 'A']) {
        this.unsupported(`\\${c}`, span(), c === 'A' ? 'Use ^ without the multiline flag.' : c === 'z' ? 'Use $ without the multiline flag.' : undefined);
      }
      return { type: 'anchor', kind: anchors[c], span: span() };
    }
    // Shorthand classes
    if (SHORTHANDS.has(c) && (this.d.shorthands.includes(c as ShorthandKind) || 'dDwWsS'.includes(c))) {
      this.pos++;
      return { type: 'shorthand', kind: c as ShorthandKind, span: span() };
    }
    if (c === 'Q' && this.d.quoting) {
      this.pos++;
      const end = this.src.indexOf('\\E', this.pos);
      const stop = end < 0 ? this.src.length : end;
      const text = this.src.slice(this.pos, stop);
      this.pos = end < 0 ? stop : stop + 2;
      const chars: RegexNode[] = [...text].map((ch, i) => ({ type: 'char', value: ch, span: { start: start + 2 + i, end: start + 3 + i }, escape: '\\Q' }));
      if (chars.length === 0) return null;
      // Return all but the last char to the sequence directly so a following quantifier binds to one char.
      seq.push(...chars.slice(0, -1));
      return chars[chars.length - 1];
    }
    const prop = this.property(start);
    if (prop) return prop;
    // Backreferences
    if (c === 'k' && /[<'{]/.test(this.peek(1))) {
      const open = this.peek(1);
      const style = open === '<' ? 'kAngle' : open === "'" ? 'kQuote' : 'kBrace';
      this.pos += 2;
      const ref = this.groupName(open === '<' ? '>' : open === "'" ? "'" : '}');
      if (!this.d.namedBackref[style]) this.unsupported(`\\k${open}name${open === '<' ? '>' : open === '{' ? '}' : "'"} backreferences`, span());
      return this.backref(ref, span());
    }
    if (c === 'g' && this.d.namedBackref.gBrace) {
      const m = /^g(?:\{(-?\d+|[\p{L}_][\p{L}\p{N}_]*)\}|(-?\d+))/u.exec(this.src.slice(this.pos, this.pos + 64));
      if (m) {
        this.pos += m[0].length;
        const raw = m[1] ?? m[2];
        let ref: number | string = /^-?\d+$/.test(raw) ? Number(raw) : raw;
        if (typeof ref === 'number' && ref < 0) ref = this.groupCount + 1 + ref; // relative reference
        return this.backref(ref, span());
      }
    }
    if (c >= '1' && c <= '9') {
      const m = /^\d+/.exec(this.src.slice(this.pos, this.pos + 8))!;
      this.pos += m[0].length;
      return this.backref(Number(m[0]), span());
    }
    // Character escapes
    const value = this.charEscape(false);
    return { type: 'char', value, span: span(), escape: this.src.slice(start, this.pos) };
  }

  private property(start: number): RegexNode & { type: 'property' } | null {
    const c = this.peek();
    if (c !== 'p' && c !== 'P') return null;
    if (this.d.unicodeProperties === 'never' || (this.d.unicodeProperties === 'unicodeFlag' && !this.unicodeMode)) {
      if (this.d.id === 'python') {
        this.pos++;
        this.unsupported('\\p{…} Unicode properties', { start, end: this.pos }, 'Use the third-party "regex" module, or a character class.');
        return { type: 'property', name: '?', negated: c === 'P', span: { start, end: this.pos } };
      }
      return null; // JS without u: \p is just "p"
    }
    this.pos++;
    let name: string;
    if (this.peek() === '{') {
      const end = this.src.indexOf('}', this.pos);
      if (end < 0) throw new ParseError('Unclosed \\p{…}.', { start, end: this.src.length });
      name = this.src.slice(this.pos + 1, end);
      this.pos = end + 1;
    } else {
      name = this.peek();
      this.pos++;
    }
    let negated = c === 'P';
    if (name.startsWith('^')) {
      negated = !negated;
      name = name.slice(1);
    }
    return { type: 'property', name, negated, span: { start, end: this.pos } };
  }

  private backref(ref: number | string, span: Span): RegexNode {
    if (!this.d.backreferences) {
      this.unsupported('backreferences', span, 'Rust and Go guarantee linear time and therefore have no backreferences.');
    }
    const node = { type: 'backreference' as const, ref, span };
    this.backrefs.push({ node });
    return node;
  }

  /** Reads the escape after a backslash that denotes a single character. */
  private charEscape(inClass: boolean): string {
    const start = this.pos - 1;
    const c = this.peek();
    this.pos++;
    if (c in CONTROL_ESCAPES && (c !== 'a' && c !== 'e' || this.d.id !== 'ecmascript')) return CONTROL_ESCAPES[c];
    if (c === 'v') return '\v';
    if (c === 'b' && inClass) return '\b';
    if (c === '0' && !/[0-7]/.test(this.peek())) return '\0';
    if (c === '0' || (inClass && c >= '1' && c <= '7')) {
      const m = /^[0-7]{0,2}/.exec(this.src.slice(this.pos))!;
      this.pos += m[0].length;
      return String.fromCharCode(parseInt(c + m[0], 8));
    }
    if (c === 'x') {
      if (this.peek() === '{' && this.d.hexBrace) {
        const end = this.src.indexOf('}', this.pos);
        const hex = this.src.slice(this.pos + 1, end);
        if (end < 0 || !/^[0-9a-fA-F]{1,6}$/.test(hex)) throw new ParseError('Invalid \\x{…} escape.', { start, end: this.pos });
        this.pos = end + 1;
        return String.fromCodePoint(parseInt(hex, 16));
      }
      const hex = this.src.slice(this.pos, this.pos + 2);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        this.pos += 2;
        return String.fromCharCode(parseInt(hex, 16));
      }
      if (this.unicodeMode) throw new ParseError('\\x needs two hex digits.', { start, end: this.pos }, 'For example \\x41 for "A".');
      return 'x';
    }
    if (c === 'u' && this.d.unicodeEscape) {
      if (this.peek() === '{' && this.d.id === 'ecmascript' && this.unicodeMode) {
        const end = this.src.indexOf('}', this.pos);
        const hex = this.src.slice(this.pos + 1, end);
        if (end < 0 || !/^[0-9a-fA-F]{1,6}$/.test(hex)) throw new ParseError('Invalid \\u{…} escape.', { start, end: this.pos });
        this.pos = end + 1;
        return String.fromCodePoint(parseInt(hex, 16));
      }
      const hex = this.src.slice(this.pos, this.pos + 4);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        this.pos += 4;
        return String.fromCharCode(parseInt(hex, 16));
      }
      if (this.unicodeMode) throw new ParseError('\\u needs four hex digits.', { start, end: this.pos });
      return 'u';
    }
    if (c === 'c' && /[A-Za-z]/.test(this.peek())) {
      const letter = this.peek();
      this.pos++;
      return String.fromCharCode(letter.charCodeAt(0) % 32);
    }
    if (/[A-Za-z0-9]/.test(c)) {
      const span = { start, end: this.pos };
      if (this.d.id === 'ecmascript' && this.unicodeMode) {
        throw new ParseError(`\\${c} is not a valid escape in Unicode mode.`, span, `Write "${c}" without the backslash.`);
      }
      this.warn('unknown-escape', `\\${c} is not a known escape; it matches "${c}".`, span, 'warning', `Write "${c}" without the backslash.`);
      return c;
    }
    // Escaped metacharacter or other punctuation: the character itself. Re-read astral characters whole.
    this.pos--;
    return this.readChar();
  }

  // ── character classes ────────────────────────────────────────────────────────────────────────────────────

  private charClass(): CharClassNode {
    const start = this.pos;
    this.pos++; // [
    if (++this.depth > MAX_DEPTH) throw new ParseError('Character classes nested too deeply.', { start, end: start + 1 });
    let negated = false;
    if (this.peek() === '^') {
      negated = true;
      this.pos++;
    }
    const items: ClassItem[] = [];
    let first = true;
    for (;;) {
      if (this.eof()) {
        throw new ParseError('This character class is never closed.', { start, end: start + 1 }, 'Add a "]" where the class should end, or escape the "[" as \\[.');
      }
      const c = this.peek();
      if (c === ']' && !(first && this.d.id !== 'ecmascript')) {
        this.pos++;
        break;
      }
      first = false;
      const opStart = this.pos;
      if (this.unicodeSets && (this.startsWith('&&') || (this.d.id !== 'java' && (this.startsWith('--') || this.startsWith('~~'))))) {
        const op = this.src.slice(this.pos, this.pos + 2) as '&&' | '--' | '~~';
        this.pos += 2;
        items.push({ type: 'setop', op, span: { start: opStart, end: this.pos } });
        continue;
      }
      if (c === '[' && this.d.posixClasses && /^\[:\^?[a-z]+:\]/.test(this.src.slice(this.pos, this.pos + 16))) {
        const m = /^\[:(\^?)([a-z]+):\]/.exec(this.src.slice(this.pos, this.pos + 16))!;
        this.pos += m[0].length;
        items.push({ type: 'posix', name: m[2], negated: m[1] === '^', span: { start: opStart, end: this.pos } });
        continue;
      }
      if (c === '[' && this.unicodeSets) {
        const node = this.charClass();
        items.push({ type: 'class', node, span: node.span });
        continue;
      }
      const item = this.classAtom();
      if (item.type === 'char' && this.peek() === '-' && this.peek(1) !== ']' && this.peek(1) !== '') {
        const save = this.pos;
        this.pos++;
        const to = this.classAtom();
        if (to.type === 'char') {
          const span = { start: opStart, end: this.pos };
          if ((to.value.codePointAt(0) ?? 0) < (item.value.codePointAt(0) ?? 0)) {
            throw new ParseError(`The range ${item.value}-${to.value} is out of order.`, span, `Write ${to.value}-${item.value}.`);
          }
          items.push({ type: 'range', from: item.value, to: to.value, span });
          continue;
        }
        if (this.d.id === 'ecmascript' && this.unicodeMode) {
          throw new ParseError('A range needs a single character on both sides.', { start: opStart, end: this.pos });
        }
        this.pos = save; // "-" followed by a class like \d: both are literal items
      }
      if (item.type !== 'char' && this.d.id === 'ecmascript' && this.unicodeMode && this.peek() === '-' && this.peek(1) !== ']') {
        throw new ParseError('A range needs a single character on both sides.', { start: opStart, end: this.pos + 1 });
      }
      items.push(item);
    }
    this.depth--;
    return { type: 'class', negated, items, span: { start, end: this.pos } };
  }

  private classAtom(): ClassItem {
    const start = this.pos;
    if (this.peek() !== '\\') {
      const value = this.readChar();
      return { type: 'char', value, span: { start, end: this.pos } };
    }
    this.pos++;
    if (this.eof()) throw new ParseError('The pattern ends with a lone backslash.', { start, end: this.pos });
    const c = this.peek();
    if ('dDwWsS'.includes(c) || (SHORTHANDS.has(c) && 'hHvV'.includes(c) && this.d.shorthands.includes(c as ShorthandKind))) {
      this.pos++;
      return { type: 'shorthand', kind: c as ShorthandKind, span: { start, end: this.pos } };
    }
    const prop = this.property(start);
    if (prop) return { type: 'property', name: prop.name, negated: prop.negated, span: prop.span };
    const value = this.charEscape(true);
    return { type: 'char', value, span: { start, end: this.pos } };
  }

  // ── post-processing ──────────────────────────────────────────────────────────────────────────────────────

  private resolveBackrefs() {
    for (const { node } of this.backrefs) {
      if (typeof node.ref === 'number') {
        if ((node.ref > this.groupCount || node.ref < 1) && this.d.id === 'ecmascript' && !this.unicodeMode) {
          this.warn('legacy-octal', `There is no group ${node.ref}; without the u flag JavaScript reads this as a legacy escape.`, node.span,
            'warning', 'Turn on the u flag to make this an error, or fix the group number.');
        } else if (node.ref > this.groupCount || node.ref < 1) {
          this.warn('missing-group', `There is no group ${node.ref} to refer back to.`, node.span, 'error',
            this.groupCount ? `Groups are numbered 1 to ${this.groupCount}.` : 'Add a capture group (…) first.');
        }
      } else if (!this.groups.some((g) => g.name === node.ref)) {
        this.warn('missing-group', `There is no group named "${node.ref}".`, node.span, 'error');
      }
    }
  }

  /** .NET numbers unnamed groups first, then named groups in order. */
  private renumberNamedLast(root: RegexNode) {
    const unnamed = this.groups.filter((g) => !g.name);
    const named = this.groups.filter((g) => g.name);
    const order = [...unnamed, ...named];
    const remap = new Map<number, number>();
    order.forEach((g, i) => remap.set(g.index, i + 1));
    walk(root, (n) => {
      if (n.type === 'group' && n.index !== undefined) n.index = remap.get(n.index);
    });
    order.forEach((g, i) => (g.index = i + 1));
    this.groups.sort((a, b) => a.index - b.index);
  }
}

export function hasUnbounded(node: RegexNode): boolean {
  let found = false;
  walk(node, (n) => {
    if (n.type === 'quantifier' && n.max === Infinity) found = true;
  });
  return found;
}

/** Visits every node depth-first, parents before children. */
export function walk(node: RegexNode, visit: (n: RegexNode, parent?: RegexNode) => void, parent?: RegexNode) {
  visit(node, parent);
  switch (node.type) {
    case 'alternation':
      for (const a of node.alternatives) walk(a, visit, node);
      break;
    case 'sequence':
      for (const a of node.items) walk(a, visit, node);
      break;
    case 'group':
    case 'quantifier':
      walk(node.body, visit, node);
      break;
  }
}
