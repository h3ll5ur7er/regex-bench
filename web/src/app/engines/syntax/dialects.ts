import { BackendId, FlagInfo, FlavorId, ShorthandKind } from '../../contracts';

/**
 * What a flavor accepts and how it spells it (docs/Decisions/ADR-004-one-parser-many-dialects.md).
 * Adding a flavor means adding one of these tables; the parser, explainer, converter and templates read it.
 */
export interface Dialect {
  id: FlavorId;
  name: string;
  /** Where this flavor is used, shown under its name. */
  usedBy: string;
  flags: FlagInfo[];
  /** Flags on by default in a new pattern of this flavor. */
  defaultFlags: string;
  namedGroup: { angle: boolean; pAngle: boolean; quote: boolean };
  namedBackref: { kAngle: boolean; kQuote: boolean; kBrace: boolean; pEquals: boolean; gBrace: boolean };
  lookahead: boolean;
  lookbehind: boolean;
  /** Lookbehind may contain unbounded quantifiers (JS, .NET). */
  unboundedLookbehind: boolean;
  atomic: boolean;
  possessive: boolean;
  backreferences: boolean;
  /** `none`: no inline flags; `scoped`: only `(?i:…)`; `full`: also `(?i)` for the rest of the group. */
  inlineFlags: 'none' | 'scoped' | 'full';
  /** Letters accepted inside inline flag groups. */
  inlineFlagLetters: string;
  comments: boolean;
  anchors: { A: boolean; z: boolean; Z: boolean; G: boolean; K: boolean };
  shorthands: ShorthandKind[];
  /** `\p{…}`: always, only with the `u`/`v` flag, or never. */
  unicodeProperties: 'always' | 'unicodeFlag' | 'never';
  posixClasses: boolean;
  /** `[a-z&&[aeiou]]` style set operations and nested classes. */
  classSetOperations: boolean;
  quoting: boolean; // \Q…\E
  hexBrace: boolean; // \x{263A}
  unicodeEscape: boolean; // ☺
  /** `$` without multiline also matches before a final newline (PCRE, Python, Java, .NET). */
  dollarBeforeFinalNewline: boolean;
  /** `\d`, `\w` and `\b` follow Unicode, not ASCII, by default (Python 3, .NET, Rust). */
  unicodeShorthands: boolean;
  /** `{,n}` is a quantifier. */
  quantifierOmittedMin: boolean;
  /** Named groups are numbered after all unnamed groups (.NET). */
  namedGroupsNumberedLast: boolean;
  replacement: ReplacementSyntax;
  /** How patterns of this flavor are executed. */
  backend: BackendId;
  /** The language snippets are generated for. */
  language: string;
}

export type ReplacementSyntax = 'ecmascript' | 'pcre' | 'python' | 'java' | 'dotnet' | 'rust';

const commonFlags = {
  i: { letter: 'i', name: 'ignore case', description: 'Letters match regardless of case.' },
  m: { letter: 'm', name: 'multiline', description: '^ and $ match at the start and end of every line.' },
  s: { letter: 's', name: 'dot all', description: '. also matches line breaks.' },
  x: { letter: 'x', name: 'extended', description: 'Whitespace is ignored and # starts a comment.' },
  g: { letter: 'g', name: 'global', description: 'Find all matches, not just the first.' },
} satisfies Record<string, FlagInfo>;

const pcreLike: Omit<Dialect, 'id' | 'name' | 'usedBy' | 'replacement' | 'language'> = {
  flags: [
    commonFlags.g,
    commonFlags.i,
    commonFlags.m,
    commonFlags.s,
    commonFlags.x,
    { letter: 'U', name: 'ungreedy', description: 'Quantifiers are lazy unless followed by ?.' },
    { letter: 'u', name: 'unicode', description: 'Treat the pattern and text as Unicode.' },
  ],
  defaultFlags: 'gm',
  namedGroup: { angle: true, pAngle: true, quote: true },
  namedBackref: { kAngle: true, kQuote: true, kBrace: true, pEquals: true, gBrace: true },
  lookahead: true,
  lookbehind: true,
  unboundedLookbehind: false,
  atomic: true,
  possessive: true,
  backreferences: true,
  inlineFlags: 'full',
  inlineFlagLetters: 'imsxnUJ',
  comments: true,
  anchors: { A: true, z: true, Z: true, G: true, K: true },
  shorthands: ['d', 'D', 'w', 'W', 's', 'S', 'h', 'H', 'v', 'V', 'N', 'R'],
  unicodeProperties: 'always',
  posixClasses: true,
  classSetOperations: false,
  quoting: true,
  hexBrace: true,
  unicodeEscape: false,
  dollarBeforeFinalNewline: true,
  unicodeShorthands: false,
  quantifierOmittedMin: false,
  namedGroupsNumberedLast: false,
  backend: 'translated',
};

export const DIALECTS: Record<FlavorId, Dialect> = {
  ecmascript: {
    id: 'ecmascript',
    name: 'ECMAScript',
    usedBy: 'JavaScript, TypeScript, Node, Deno, browsers',
    flags: [
      commonFlags.g,
      commonFlags.i,
      commonFlags.m,
      commonFlags.s,
      { letter: 'u', name: 'unicode', description: 'Unicode mode: code points, \\p{…} and strict syntax.' },
      { letter: 'v', name: 'unicode sets', description: 'Unicode mode with set operations in classes.' },
      { letter: 'y', name: 'sticky', description: 'Match only at lastIndex.' },
      { letter: 'd', name: 'indices', description: 'Report the start and end of each group.' },
    ],
    defaultFlags: 'gm',
    namedGroup: { angle: true, pAngle: false, quote: false },
    namedBackref: { kAngle: true, kQuote: false, kBrace: false, pEquals: false, gBrace: false },
    lookahead: true,
    lookbehind: true,
    unboundedLookbehind: true,
    atomic: false,
    possessive: false,
    backreferences: true,
    inlineFlags: 'scoped',
    inlineFlagLetters: 'ims',
    comments: false,
    anchors: { A: false, z: false, Z: false, G: false, K: false },
    shorthands: ['d', 'D', 'w', 'W', 's', 'S'],
    unicodeProperties: 'unicodeFlag',
    posixClasses: false,
    classSetOperations: true, // with the v flag
    quoting: false,
    hexBrace: false,
    unicodeEscape: true,
    dollarBeforeFinalNewline: false,
    unicodeShorthands: false,
    quantifierOmittedMin: false,
    namedGroupsNumberedLast: false,
    replacement: 'ecmascript',
    backend: 'native',
    language: 'JavaScript',
  },
  pcre: {
    ...pcreLike,
    id: 'pcre',
    name: 'PCRE2',
    usedBy: 'PHP, R, grep -P, nginx, Apache',
    replacement: 'pcre',
    backend: 'translated',
    language: 'PHP',
  },
  python: {
    ...pcreLike,
    id: 'python',
    name: 'Python',
    usedBy: 'Python re module (3.11+)',
    flags: [
      commonFlags.g,
      commonFlags.i,
      commonFlags.m,
      commonFlags.s,
      commonFlags.x,
      { letter: 'a', name: 'ASCII', description: '\\w, \\d, \\s and \\b match ASCII only.' },
    ],
    namedGroup: { angle: false, pAngle: true, quote: false },
    namedBackref: { kAngle: false, kQuote: false, kBrace: false, pEquals: true, gBrace: false },
    inlineFlagLetters: 'aiLmsux',
    anchors: { A: true, z: false, Z: true, G: false, K: false },
    shorthands: ['d', 'D', 'w', 'W', 's', 'S'],
    unicodeProperties: 'never',
    posixClasses: false,
    quoting: false,
    hexBrace: false,
    unicodeEscape: true,
    quantifierOmittedMin: true,
    unicodeShorthands: true,
    replacement: 'python',
    language: 'Python',
  },
  java: {
    ...pcreLike,
    id: 'java',
    name: 'Java',
    usedBy: 'java.util.regex, Kotlin, Scala',
    flags: [
      commonFlags.g,
      commonFlags.i,
      commonFlags.m,
      commonFlags.s,
      commonFlags.x,
      { letter: 'u', name: 'unicode case', description: 'Case-insensitive matching uses Unicode rules.' },
    ],
    namedGroup: { angle: true, pAngle: false, quote: false },
    namedBackref: { kAngle: true, kQuote: false, kBrace: false, pEquals: false, gBrace: false },
    inlineFlagLetters: 'idmsuxU',
    anchors: { A: true, z: true, Z: true, G: true, K: false },
    shorthands: ['d', 'D', 'w', 'W', 's', 'S', 'h', 'H', 'v', 'V', 'R'],
    posixClasses: false,
    classSetOperations: true,
    hexBrace: true,
    unicodeEscape: true,
    replacement: 'java',
    language: 'Java',
  },
  dotnet: {
    ...pcreLike,
    id: 'dotnet',
    name: '.NET',
    usedBy: 'C#, F#, PowerShell',
    flags: [
      commonFlags.g,
      commonFlags.i,
      commonFlags.m,
      commonFlags.s,
      commonFlags.x,
      { letter: 'n', name: 'explicit capture', description: 'Only named groups capture.' },
    ],
    namedGroup: { angle: true, pAngle: false, quote: true },
    namedBackref: { kAngle: true, kQuote: true, kBrace: false, pEquals: false, gBrace: false },
    unboundedLookbehind: true,
    possessive: false,
    inlineFlagLetters: 'imnsx',
    anchors: { A: true, z: true, Z: true, G: true, K: false },
    shorthands: ['d', 'D', 'w', 'W', 's', 'S'],
    posixClasses: false,
    quoting: false,
    hexBrace: false,
    unicodeEscape: true,
    namedGroupsNumberedLast: true,
    unicodeShorthands: true,
    replacement: 'dotnet',
    language: 'C#',
  },
  rust: {
    ...pcreLike,
    id: 'rust',
    name: 'Rust',
    usedBy: 'Rust regex crate (RE2 semantics: linear time)',
    flags: [
      commonFlags.g,
      commonFlags.i,
      commonFlags.m,
      commonFlags.s,
      commonFlags.x,
      { letter: 'U', name: 'swap greed', description: 'Quantifiers are lazy unless followed by ?.' },
      { letter: 'R', name: 'CRLF', description: '^ and $ also treat \\r\\n as a line end.' },
    ],
    namedGroup: { angle: true, pAngle: true, quote: false },
    namedBackref: { kAngle: false, kQuote: false, kBrace: false, pEquals: false, gBrace: false },
    lookahead: false,
    lookbehind: false,
    atomic: false,
    possessive: false,
    backreferences: false,
    inlineFlagLetters: 'imsxURu',
    comments: false,
    anchors: { A: true, z: true, Z: false, G: false, K: false },
    shorthands: ['d', 'D', 'w', 'W', 's', 'S'],
    classSetOperations: true,
    quoting: false,
    dollarBeforeFinalNewline: false,
    quantifierOmittedMin: false,
    unicodeShorthands: true,
    replacement: 'rust',
    backend: 'rust',
    language: 'Rust',
  },
  go: {
    ...pcreLike,
    id: 'go',
    name: 'Go',
    usedBy: 'Go regexp package (RE2 syntax)',
    flags: [
      commonFlags.g,
      commonFlags.i,
      commonFlags.m,
      commonFlags.s,
      { letter: 'U', name: 'ungreedy', description: 'Quantifiers are lazy unless followed by ?.' },
    ],
    namedGroup: { angle: true, pAngle: true, quote: false },
    namedBackref: { kAngle: false, kQuote: false, kBrace: false, pEquals: false, gBrace: false },
    lookahead: false,
    lookbehind: false,
    atomic: false,
    possessive: false,
    backreferences: false,
    inlineFlagLetters: 'imsU',
    comments: false,
    anchors: { A: true, z: true, Z: false, G: false, K: false },
    shorthands: ['d', 'D', 'w', 'W', 's', 'S'],
    quoting: true,
    dollarBeforeFinalNewline: false,
    replacement: 'rust',
    backend: 'rust',
    language: 'Go',
  },
};

export const FLAVORS: Dialect[] = Object.values(DIALECTS);

export function dialectOf(id: FlavorId): Dialect {
  return DIALECTS[id] ?? DIALECTS.ecmascript;
}
