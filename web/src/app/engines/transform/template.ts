import { MatchItem } from '../../contracts';
import { ReplacementSyntax } from '../syntax/dialects';

export type TemplatePart =
  | { type: 'text'; value: string }
  | { type: 'group'; ref: number | string; raw: string }
  | { type: 'whole'; raw: string }
  | { type: 'before'; raw: string }
  | { type: 'after'; raw: string }
  | { type: 'lastGroup'; raw: string }
  | { type: 'input'; raw: string };

export interface TemplateContext {
  groupCount: number;
  names: Set<string>;
}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', f: '\f', v: '\v', a: '\x07', b: '\b', '\\': '\\' };

/**
 * Parses a replacement template with the rules of the flavor's standard replace function:
 * JS `String.prototype.replace`, PHP `preg_replace`, Python `re.sub`, Java `Matcher.replaceAll`,
 * .NET `Regex.Replace`, Rust `Regex::replace_all` and Go `ReplaceAllString`.
 *
 * With `escapes`, `\n`, `\t` and `\\` are read as characters first (used by the list mode, where there is no
 * host language to unescape them).
 */
export function parseTemplate(template: string, syntax: ReplacementSyntax, ctx: TemplateContext, escapes = false): TemplatePart[] {
  const parts: TemplatePart[] = [];
  const text = (v: string) => {
    const last = parts[parts.length - 1];
    if (last?.type === 'text') last.value += v;
    else parts.push({ type: 'text', value: v });
  };
  let i = 0;
  const rest = () => template.slice(i);
  while (i < template.length) {
    const c = template[i];
    let m: RegExpExecArray | null;
    if (c === '\\') {
      if (syntax === 'python') {
        if ((m = /^\\g<(\d+|[\p{L}_][\p{L}\p{N}_]*)>/u.exec(rest()))) {
          parts.push({ type: 'group', ref: /^\d+$/.test(m[1]) ? Number(m[1]) : m[1], raw: m[0] });
          i += m[0].length;
          continue;
        }
        if ((m = /^\\(\d{1,2})/.exec(rest()))) {
          parts.push({ type: 'group', ref: Number(m[1]), raw: m[0] });
          i += m[0].length;
          continue;
        }
        if (template[i + 1] in ESCAPES) {
          text(ESCAPES[template[i + 1]]);
          i += 2;
          continue;
        }
      }
      if (syntax === 'pcre' && (m = /^\\(\d{1,2})/.exec(rest()))) {
        parts.push({ type: 'group', ref: Number(m[1]), raw: m[0] });
        i += m[0].length;
        continue;
      }
      if (escapes && template[i + 1] in ESCAPES) {
        text(ESCAPES[template[i + 1]]);
        i += 2;
        continue;
      }
      if (syntax === 'java' && i + 1 < template.length) {
        text(template[i + 1]);
        i += 2;
        continue;
      }
      text(c);
      i++;
      continue;
    }
    if (c !== '$' || syntax === 'python') {
      text(c);
      i++;
      continue;
    }
    // `$` forms
    const next = template[i + 1] ?? '';
    if (next === '$' && syntax !== 'java') {
      text('$');
      i += 2;
      continue;
    }
    if (syntax === 'ecmascript' || syntax === 'dotnet') {
      const special: Record<string, TemplatePart['type']> = { '&': 'whole', '`': 'before', "'": 'after' };
      if (syntax === 'dotnet') Object.assign(special, { '+': 'lastGroup', _: 'input' });
      if (next in special) {
        parts.push({ type: special[next], raw: '$' + next } as TemplatePart);
        i += 2;
        continue;
      }
    }
    if (syntax === 'ecmascript') {
      if ((m = /^\$<([^>]*)>/.exec(rest())) && ctx.names.size > 0) {
        parts.push({ type: 'group', ref: m[1], raw: m[0] });
        i += m[0].length;
        continue;
      }
      if ((m = /^\$(\d)(\d)?/.exec(rest()))) {
        const two = m[2] !== undefined ? Number(m[1] + m[2]) : NaN;
        if (two >= 1 && two <= ctx.groupCount) {
          parts.push({ type: 'group', ref: two, raw: m[0] });
          i += 3;
          continue;
        }
        const one = Number(m[1]);
        if (one >= 1 && one <= ctx.groupCount) {
          parts.push({ type: 'group', ref: one, raw: '$' + m[1] });
          i += 2;
          continue;
        }
      }
      text('$');
      i++;
      continue;
    }
    if ((m = /^\$\{([^}]*)\}/.exec(rest()))) {
      parts.push({ type: 'group', ref: /^\d+$/.test(m[1]) ? Number(m[1]) : m[1], raw: m[0] });
      i += m[0].length;
      continue;
    }
    if (syntax === 'rust' && (m = /^\$([_0-9a-zA-Z]+)/.exec(rest()))) {
      parts.push({ type: 'group', ref: /^\d+$/.test(m[1]) ? Number(m[1]) : m[1], raw: m[0] });
      i += m[0].length;
      continue;
    }
    if ((m = /^\$(\d+)/.exec(rest()))) {
      // Java, .NET, PCRE: take the longest number that is a group, at least one digit.
      let digits = m[1];
      while (digits.length > 1 && Number(digits) > ctx.groupCount) digits = digits.slice(0, -1);
      parts.push({ type: 'group', ref: Number(digits), raw: '$' + digits });
      i += 1 + digits.length;
      continue;
    }
    text('$');
    i++;
  }
  return parts;
}

/** Expands a parsed template for one match. */
export function expandTemplate(parts: TemplatePart[], m: MatchItem, text: string, names: (string | undefined)[]): string {
  let out = '';
  for (const p of parts) {
    switch (p.type) {
      case 'text': out += p.value; break;
      case 'whole': out += text.slice(m.start, m.end); break;
      case 'before': out += text.slice(0, m.start); break;
      case 'after': out += text.slice(m.end); break;
      case 'input': out += text; break;
      case 'lastGroup': {
        const g = [...m.groups].reverse().find((x) => x);
        if (g) out += text.slice(g.start, g.end);
        break;
      }
      case 'group': {
        const idx = typeof p.ref === 'number' ? p.ref : names.indexOf(p.ref);
        if (idx === 0) out += text.slice(m.start, m.end);
        const g = idx > 0 ? m.groups[idx - 1] : null;
        if (g) out += text.slice(g.start, g.end);
        break;
      }
    }
  }
  return out;
}

export interface ReplaceOutput {
  text: string;
  /** Where each replacement landed in the output, for highlighting. */
  spans: { start: number; end: number }[];
  truncated: boolean;
}

export const MAX_OUTPUT = 5_000_000;

export function replaceAll(text: string, matches: MatchItem[], parts: TemplatePart[], names: (string | undefined)[]): ReplaceOutput {
  let out = '';
  let last = 0;
  const spans: { start: number; end: number }[] = [];
  for (const m of matches) {
    out += text.slice(last, m.start);
    const r = expandTemplate(parts, m, text, names);
    spans.push({ start: out.length, end: out.length + r.length });
    out += r;
    last = m.end;
    if (out.length > MAX_OUTPUT) return { text: out.slice(0, MAX_OUTPUT), spans, truncated: true };
  }
  out += text.slice(last);
  return { text: out, spans, truncated: false };
}

export function listAll(text: string, matches: MatchItem[], parts: TemplatePart[], names: (string | undefined)[]): ReplaceOutput {
  let out = '';
  const spans: { start: number; end: number }[] = [];
  for (const m of matches) {
    const r = expandTemplate(parts, m, text, names);
    spans.push({ start: out.length, end: out.length + r.length });
    out += r;
    if (out.length > MAX_OUTPUT) return { text: out.slice(0, MAX_OUTPUT), spans, truncated: true };
  }
  return { text: out, spans, truncated: false };
}
