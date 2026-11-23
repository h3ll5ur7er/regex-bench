import { ClassItem, RegexAst, RegexNode } from '../../contracts';

export interface DiagramNotation {
  /** A complete PlantUML source, ready for DiagramAccess. */
  source: string;
  nodeCount: number;
  tooLarge: boolean;
  /** Nothing to draw (an empty pattern). */
  empty: boolean;
}

export const MAX_DIAGRAM_NODES = 600;

/**
 * DiagramEngine: turns an AST into a railroad-diagram notation (V4). Today that is PlantUML's `@startregex`,
 * printed from the AST in a normalised form PlantUML understands. The pattern source is never pasted in:
 * every literal is escaped, so nothing in a pattern can become a PlantUML directive (STRIDE H10).
 */
export const DiagramEngine = {
  toNotation(ast: RegexAst): DiagramNotation {
    let count = 0;
    const visit = (n: RegexNode): string => {
      count++;
      switch (n.type) {
        case 'empty': return '';
        case 'alternation': {
          const alts = n.alternatives.map(visit).filter((a) => a !== '');
          if (alts.length === 0) return '';
          const joined = alts.join('|');
          return alts.length < n.alternatives.length ? `(?:${joined})?` : joined;
        }
        case 'sequence': return n.items.map((i) => (i.type === 'alternation' ? `(?:${visit(i)})` : visit(i))).join('');
        case 'char': return lit(n.value);
        case 'dot': return '.';
        case 'shorthand': return 'dDwWsS'.includes(n.kind) ? '\\' + n.kind : `[${SHORTHAND_LABEL[n.kind] ?? n.kind}]`;
        case 'property': return `[${n.negated ? '^' : ''}${safeLabel('\\p{' + n.name + '}')}]`;
        case 'class': return classText(n.negated, n.items);
        case 'anchor': return ANCHORS[n.kind];
        case 'group': {
          const body = visit(n.body) || '[ε]';
          switch (n.kind) {
            case 'capture': return `(${body})`;
            case 'named': return `(?<${n.name}>${body})`;
            case 'lookahead': return `(?=${body})`;
            case 'negativeLookahead': return `(?!${body})`;
            case 'lookbehind': return `(?<=${body})`;
            case 'negativeLookbehind': return `(?<!${body})`;
            default: return `(?:${body})`;
          }
        }
        case 'quantifier': {
          let body = visit(n.body);
          if (n.body.type === 'sequence' || n.body.type === 'alternation') body = `(?:${body})`;
          const op = n.min === 0 && n.max === Infinity ? '*' : n.min === 1 && n.max === Infinity ? '+' : n.min === 0 && n.max === 1 ? '?'
            : n.min === n.max ? `{${n.min}}` : n.max === Infinity ? `{${n.min},}` : `{${n.min},${n.max}}`;
          return body + op + (n.lazy && n.min !== n.max ? '?' : '');
        }
        case 'backreference': return `[${safeLabel(typeof n.ref === 'number' ? 'same as group ' + n.ref : 'same as ' + n.ref)}]`;
        case 'inlineFlags': return '';
        case 'comment': return '';
        case 'unsupported': return `[${safeLabel(n.text)}]`;
      }
    };
    const body = visit(ast.root);
    const tooLarge = count > MAX_DIAGRAM_NODES;
    return { source: `@startregex\n${tooLarge ? 'x' : body}\n@endregex`, nodeCount: count, tooLarge, empty: body === '' };
  },
};

const ANCHORS: Record<string, string> = {
  lineStart: '^', lineEnd: '$', wordBoundary: '\\b', notWordBoundary: '\\B', stringStart: '^', stringEnd: '$',
  stringEndNewline: '$', matchStart: '', keepOut: '',
};

const SHORTHAND_LABEL: Record<string, string> = {
  h: 'horizontal space', H: 'not horizontal space', v: 'vertical space', V: 'not vertical space', N: 'not newline', R: 'line break',
};

const NAMED_CHARS: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '\f': '\\f', '\v': '\\v', '\0': '\\0' };

function lit(c: string): string {
  if (NAMED_CHARS[c]) return NAMED_CHARS[c];
  if ('\\^$.|?*+()[]{}/'.includes(c)) return '\\' + c;
  const cp = c.codePointAt(0)!;
  if (cp < 0x20 || cp === 0x7f) return '\\x' + cp.toString(16).padStart(2, '0');
  return c;
}

/** Text shown inside a class box: only characters PlantUML's class parser treats as plain. */
function safeLabel(s: string): string {
  return s.replace(/[\\\]\[^\n\r]/g, ' ').replace(/-/g, '–').trim() || '?';
}

function classText(negated: boolean, items: ClassItem[]): string {
  const parts = items.map((i): string => {
    switch (i.type) {
      case 'char': return classChar(i.value);
      case 'range': return `${classChar(i.from)}-${classChar(i.to)}`;
      case 'shorthand': return '\\' + i.kind;
      case 'property': return safeLabel(`p{${i.name}}`);
      case 'posix': return safeLabel(i.name);
      case 'class': return safeLabel((i.node.negated ? 'not ' : '') + 'nested');
      case 'setop': return i.op === '&&' ? ' and ' : ' minus ';
    }
  });
  return `[${negated ? '^' : ''}${parts.join('') || ' '}]`;
}

function classChar(c: string): string {
  if (NAMED_CHARS[c]) return NAMED_CHARS[c];
  if ('\\]^-['.includes(c)) return '\\' + c;
  return c;
}
