/**
 * InferenceEngine: synthesises a regex from example lines (US-11, V7).
 *
 * 1. Each line is split into tokens: words (letters/digits/_), whitespace runs and single punctuation.
 * 2. Lines are aligned token by token. Lines with the same shape align directly; other shapes are aligned
 *    against the most common one with an edit-distance alignment, and tokens that some lines lack become
 *    optional.
 * 3. Each aligned column is generalised as little as possible: a constant stays literal, a small set of words
 *    becomes an alternation (INFO|WARN|ERROR), otherwise the narrowest class with a length range is used. Words are
 *    split further where all lines agree on their inner shape (v1 → v\d).
 * 4. Marked spans become capture groups around the columns they cover.
 * 5. The result is verified against every line.
 */

export interface InferMark {
  line: number;
  start: number;
  end: number;
  name?: string;
}

export interface InferOptions {
  /** Keep exact length ranges (`\d{2,3}`) instead of `+`. */
  exactLengths: boolean;
  /** Turn small sets of words into alternations. */
  enumerations: boolean;
  anchored: boolean;
}

export const DEFAULT_INFER_OPTIONS: InferOptions = { exactLengths: true, enumerations: true, anchored: true };

export interface InferColumn {
  pattern: string;
  optional: boolean;
  /** A few example values seen in this column. */
  examples: string[];
}

export interface InferResult {
  /** ECMAScript syntax with `(?<name>…)` groups; the manager converts it to the selected flavor. */
  source: string;
  flags: string;
  columns: InferColumn[];
  /** Per input line: does the pattern match the whole line? */
  coverage: boolean[];
  lineCount: number;
}

export const MAX_INFER_LINES = 5_000;
export const MAX_INFER_LINE_LENGTH = 2_000;

type TokenKind = 'word' | 'space' | 'punct';
interface Token {
  kind: TokenKind;
  text: string;
  start: number;
  end: number;
}

const TOKEN_RE = /([\p{L}\p{N}_]+)|(\s+)|([^\p{L}\p{N}_\s])/gu;

export function tokenize(line: string): Token[] {
  const out: Token[] = [];
  for (const m of line.matchAll(TOKEN_RE)) {
    const kind: TokenKind = m[1] ? 'word' : m[2] ? 'space' : 'punct';
    out.push({ kind, text: m[0], start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

/** The alignment key of a token: punctuation must match exactly, words and spaces by kind. */
function key(t: Token): string {
  return t.kind === 'punct' ? 'p' + t.text : t.kind;
}

interface Column {
  key: string;
  /** Per line: the token in this column, or null when the line lacks it. */
  cells: (Token | null)[];
}

export function infer(input: string, marks: InferMark[] = [], options: InferOptions = DEFAULT_INFER_OPTIONS): InferResult {
  const lines = input.split(/\r?\n/).filter((l) => l.length > 0).slice(0, MAX_INFER_LINES).map((l) => l.slice(0, MAX_INFER_LINE_LENGTH));
  if (lines.length === 0) return { source: '', flags: '', columns: [], coverage: [], lineCount: 0 };
  const tokens = lines.map(tokenize);
  const columns = align(tokens);

  // Marks → column ranges.
  const groups: { from: number; to: number; name?: string }[] = [];
  for (const mark of marks) {
    if (mark.line < 0 || mark.line >= lines.length) continue;
    let from = -1;
    let to = -1;
    columns.forEach((c, ci) => {
      const t = c.cells[mark.line];
      if (t && t.end > mark.start && t.start < mark.end) {
        if (from < 0) from = ci;
        to = ci;
      }
    });
    if (from >= 0 && !groups.some((g) => g.from <= to && from <= g.to)) groups.push({ from, to, name: mark.name });
  }
  groups.sort((a, b) => a.from - b.from);

  const parts = columns.map((c) => generalize(c, options));
  let source = '';
  for (let i = 0; i < columns.length; i++) {
    const open = groups.find((g) => g.from === i);
    if (open) source += open.name ? `(?<${open.name}>` : '(';
    const optional = columns[i].cells.some((t) => t === null);
    source += optional ? `(?:${parts[i]})?` : parts[i];
    if (groups.some((g) => g.to === i)) source += ')';
  }
  if (options.anchored) source = `^${source}$`;

  let coverage: boolean[];
  try {
    const re = new RegExp(source, 'u');
    coverage = lines.map((l) => re.test(l));
  } catch {
    coverage = lines.map(() => false);
  }
  return {
    source,
    flags: source.includes('\\p{') ? 'u' : '',
    columns: columns.map((c, i) => ({
      pattern: parts[i],
      optional: c.cells.some((t) => t === null),
      examples: [...new Set(c.cells.filter((t): t is Token => !!t).map((t) => t.text))].slice(0, 4),
    })),
    coverage,
    lineCount: lines.length,
  };
}

/** Aligns all token sequences into columns, starting from the most common shape. */
function align(tokens: Token[][]): Column[] {
  const shapes = new Map<string, number>();
  for (const t of tokens) {
    const s = t.map(key).join(' ');
    shapes.set(s, (shapes.get(s) ?? 0) + 1);
  }
  const reference = [...shapes.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
  const refIdx = tokens.findIndex((t) => t.map(key).join(' ') === reference);
  let columns: Column[] = tokens[refIdx].map((t) => ({ key: key(t), cells: [] }));
  tokens.forEach((line, li) => {
    columns = merge(columns, line, li, tokens.length);
  });
  return columns;
}

/**
 * Aligns one line against the current columns with an edit-distance DP. Matching keys align; a column the line
 * lacks gets a null cell; a token the columns lack becomes a new optional column.
 */
function merge(columns: Column[], line: Token[], li: number, total: number): Column[] {
  const n = columns.length;
  const m = line.length;
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) cost[i][0] = i;
  for (let j = 0; j <= m; j++) cost[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = columns[i - 1].key === key(line[j - 1]) ? 0 : Infinity;
      cost[i][j] = Math.min(cost[i - 1][j - 1] + same, cost[i - 1][j] + 1, cost[i][j - 1] + 1);
    }
  }
  const out: Column[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && columns[i - 1].key === key(line[j - 1]) && cost[i][j] === cost[i - 1][j - 1]) {
      const c = columns[i - 1];
      c.cells[li] = line[j - 1];
      out.push(c);
      i--;
      j--;
    } else if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
      const c = columns[i - 1];
      c.cells[li] = null;
      out.push(c);
      i--;
    } else {
      const cells: (Token | null)[] = new Array(total).fill(null);
      cells[li] = line[j - 1];
      out.push({ key: key(line[j - 1]), cells });
      j--;
    }
  }
  return out.reverse();
}

const ESCAPE_RE = /[\\^$.*+?()[\]{}|]/g;
export function escapeLiteral(s: string): string {
  return s.replace(ESCAPE_RE, '\\$&');
}

function quant(min: number, max: number, exact: boolean): string {
  if (min === 1 && max === 1) return '';
  if (min === max) return `{${min}}`;
  if (!exact) return min === 0 ? '*' : '+';
  return max - min > 8 ? (min <= 1 ? '+' : `{${min},}`) : `{${min},${max}}`;
}

function generalize(col: Column, o: InferOptions): string {
  const values = col.cells.filter((t): t is Token => !!t).map((t) => t.text);
  const distinct = [...new Set(values)];
  if (distinct.length === 1) {
    const v = distinct[0];
    if (col.key === 'space') return v === ' ' ? ' ' : /^ +$/.test(v) ? ` {${v.length}}` : '\\s+';
    return escapeLiteral(v);
  }
  if (col.key === 'space') {
    const lengths = values.map((v) => v.length);
    return values.every((v) => /^ +$/.test(v)) ? ' ' + quant(Math.min(...lengths), Math.max(...lengths), o.exactLengths) : '\\s+';
  }
  // A few repeated words: an enumeration such as INFO|WARN|ERROR or GET|POST.
  const repeated = values.length >= distinct.length * 2 && distinct.every((v) => /^\p{L}+$/u.test(v));
  const keywords = distinct.every((v) => /^[A-Z]{2,}$/.test(v));
  if (o.enumerations && distinct.length <= 5 && (repeated || keywords)) {
    return `(?:${distinct.sort().map(escapeLiteral).join('|')})`;
  }
  // Words with the same inner shape (v1, v2 / 2026, 1999 / ab12): generalise each part.
  const shapes = values.map(subShape);
  if (shapes.every((s) => s.kinds === shapes[0].kinds) && shapes[0].parts.length > 1) {
    return shapes[0].parts
      .map((_, i) => {
        const partValues = shapes.map((s) => s.parts[i]);
        const d = new Set(partValues);
        if (d.size === 1) return escapeLiteral(partValues[0]);
        return charClass(partValues) + lengthQuant(partValues, o);
      })
      .join('');
  }
  return charClass(values) + lengthQuant(values, o);
}

function lengthQuant(values: string[], o: InferOptions): string {
  const lengths = values.map((v) => [...v].length);
  return quant(Math.min(...lengths), Math.max(...lengths), o.exactLengths);
}

/** Splits a word into runs of digits, lowercase, uppercase and other letters. */
function subShape(word: string): { kinds: string; parts: string[] } {
  const parts = word.match(/\d+|[a-z]+|[A-Z]+|[^\da-zA-Z]+/g) ?? [word];
  const kinds = parts.map((p) => (/^\d/.test(p) ? 'd' : /^[a-z]/.test(p) ? 'l' : /^[A-Z]/.test(p) ? 'u' : 'o')).join('');
  return { kinds, parts };
}

/** The narrowest familiar class that contains every character of every value. */
function charClass(values: string[]): string {
  const all = values.join('');
  if (/^\d+$/.test(all)) return '\\d';
  if (/^[a-z]+$/.test(all)) return '[a-z]';
  if (/^[A-Z]+$/.test(all)) return '[A-Z]';
  if (/^[0-9a-f]+$/.test(all)) return '[0-9a-f]';
  if (/^[0-9A-F]+$/.test(all)) return '[0-9A-F]';
  if (/^[a-zA-Z]+$/.test(all)) return '[a-zA-Z]';
  if (/^[a-z0-9]+$/.test(all)) return '[a-z0-9]';
  if (/^[A-Z0-9]+$/.test(all)) return '[A-Z0-9]';
  if (/^[a-zA-Z0-9]+$/.test(all)) return '[a-zA-Z0-9]';
  if (/^\w+$/.test(all)) return '\\w';
  return '[\\p{L}\\p{N}_]';
}
