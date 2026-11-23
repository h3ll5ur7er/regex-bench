import { FlavorId } from '../contracts';

/**
 * Reference content as data (volatility V10). The explanation text of the SyntaxEngine and the quick reference
 * both read from here, so wording changes never touch engine code.
 */
export interface ReferenceEntry {
  /** What to insert into the pattern. `…` marks where the cursor goes. */
  token: string;
  title: string;
  description: string;
  /** Flavors that support it; all when omitted. */
  flavors?: FlavorId[];
}

export interface ReferenceSection {
  id: string;
  title: string;
  entries: ReferenceEntry[];
}

const BACKTRACKING: FlavorId[] = ['ecmascript', 'pcre', 'python', 'java', 'dotnet'];
const PCRE_JAVA_DOTNET_PY: FlavorId[] = ['pcre', 'python', 'java', 'dotnet'];

export const QUICK_REFERENCE: ReferenceSection[] = [
  {
    id: 'chars',
    title: 'Characters',
    entries: [
      { token: '.', title: 'Any character', description: 'Any character except a line break (unless the s flag is on).' },
      { token: '\\d', title: 'Digit', description: 'A digit 0–9 (Unicode digits in some flavors).' },
      { token: '\\D', title: 'Not a digit', description: 'Any character that is not a digit.' },
      { token: '\\w', title: 'Word character', description: 'A letter, digit or underscore.' },
      { token: '\\W', title: 'Not a word character', description: 'Anything but a letter, digit or underscore.' },
      { token: '\\s', title: 'Whitespace', description: 'Space, tab, line break and other whitespace.' },
      { token: '\\S', title: 'Not whitespace', description: 'Any character that is not whitespace.' },
      { token: '\\h', title: 'Horizontal whitespace', description: 'Space, tab and other horizontal spaces.', flavors: ['pcre', 'java'] },
      { token: '\\R', title: 'Line break', description: 'Any line break sequence: \\r\\n, \\n, \\r and others.', flavors: ['pcre', 'java'] },
      { token: '\\t', title: 'Tab', description: 'A tab character.' },
      { token: '\\n', title: 'Line feed', description: 'A line feed (newline) character.' },
      { token: '\\x41', title: 'Hex character', description: 'The character with this hex code; \\x41 is "A".' },
      { token: '\\u00e9', title: 'Unicode character', description: 'The character with this 4-digit hex code.', flavors: ['ecmascript', 'python', 'java', 'dotnet'] },
      { token: '\\p{L}', title: 'Unicode property', description: 'Any character with this Unicode property, e.g. L (letter), N (number), Lu (uppercase).', flavors: ['ecmascript', 'pcre', 'java', 'dotnet', 'rust', 'go'] },
      { token: '\\.', title: 'Escaped metacharacter', description: 'A backslash makes a metacharacter literal: \\. \\* \\( \\[ \\\\' },
    ],
  },
  {
    id: 'classes',
    title: 'Character classes',
    entries: [
      { token: '[abc]', title: 'One of', description: 'One of the listed characters.' },
      { token: '[^abc]', title: 'None of', description: 'Any character except the listed ones.' },
      { token: '[a-z]', title: 'Range', description: 'One character in the range.' },
      { token: '[[:alpha:]]', title: 'POSIX class', description: 'A named POSIX class inside brackets.', flavors: ['pcre', 'rust', 'go'] },
      { token: '[\\w&&[^\\d]]', title: 'Intersection', description: 'Characters in both sets.', flavors: ['java', 'rust'] },
    ],
  },
  {
    id: 'anchors',
    title: 'Anchors',
    entries: [
      { token: '^', title: 'Start', description: 'Start of the text, or of a line with the m flag.' },
      { token: '$', title: 'End', description: 'End of the text, or of a line with the m flag.' },
      { token: '\\b', title: 'Word boundary', description: 'Between a word character and a non-word character.' },
      { token: '\\B', title: 'Not a word boundary', description: 'Anywhere \\b does not match.' },
      { token: '\\A', title: 'Start of text', description: 'Start of the text, regardless of the m flag.', flavors: ['pcre', 'python', 'java', 'dotnet', 'rust', 'go'] },
      { token: '\\z', title: 'End of text', description: 'The very end of the text, regardless of the m flag.', flavors: ['pcre', 'java', 'dotnet', 'rust', 'go'] },
      { token: '\\Z', title: 'End of text before newline', description: 'End of the text, or before a final line break.', flavors: PCRE_JAVA_DOTNET_PY },
      { token: '\\G', title: 'End of previous match', description: 'Where the previous match ended.', flavors: ['pcre', 'java', 'dotnet'] },
      { token: '\\K', title: 'Reset match start', description: 'Drop everything matched so far from the reported match.', flavors: ['pcre'] },
    ],
  },
  {
    id: 'groups',
    title: 'Groups and references',
    entries: [
      { token: '(…)', title: 'Capture group', description: 'Groups and captures the match for later use as $1, \\1.' },
      { token: '(?<name>…)', title: 'Named group', description: 'A capture group you can refer to by name.', flavors: ['ecmascript', 'pcre', 'java', 'dotnet', 'rust', 'go'] },
      { token: '(?P<name>…)', title: 'Named group (Python style)', description: 'A capture group you can refer to by name.', flavors: ['pcre', 'python', 'rust', 'go'] },
      { token: '(?:…)', title: 'Non-capturing group', description: 'Groups without capturing.' },
      { token: '(?>…)', title: 'Atomic group', description: 'Once matched, never backtracks into the group.', flavors: ['pcre', 'python', 'java', 'dotnet'] },
      { token: '\\1', title: 'Backreference', description: 'Matches the same text group 1 matched.', flavors: BACKTRACKING },
      { token: '\\k<name>', title: 'Named backreference', description: 'Matches the same text the named group matched.', flavors: ['ecmascript', 'pcre', 'java', 'dotnet'] },
      { token: '(?P=name)', title: 'Named backreference (Python)', description: 'Matches the same text the named group matched.', flavors: ['pcre', 'python'] },
      { token: 'a|b', title: 'Alternation', description: 'Either the left or the right side.' },
    ],
  },
  {
    id: 'lookaround',
    title: 'Lookaround',
    entries: [
      { token: '(?=…)', title: 'Lookahead', description: 'Followed by …, without consuming it.', flavors: BACKTRACKING },
      { token: '(?!…)', title: 'Negative lookahead', description: 'Not followed by ….', flavors: BACKTRACKING },
      { token: '(?<=…)', title: 'Lookbehind', description: 'Preceded by …, without consuming it.', flavors: BACKTRACKING },
      { token: '(?<!…)', title: 'Negative lookbehind', description: 'Not preceded by ….', flavors: BACKTRACKING },
    ],
  },
  {
    id: 'quantifiers',
    title: 'Quantifiers',
    entries: [
      { token: '*', title: 'Zero or more', description: 'As many as possible, possibly none.' },
      { token: '+', title: 'One or more', description: 'As many as possible, at least one.' },
      { token: '?', title: 'Optional', description: 'Zero or one.' },
      { token: '{3}', title: 'Exactly n', description: 'Exactly three times.' },
      { token: '{2,5}', title: 'Between', description: 'Between two and five times.' },
      { token: '{2,}', title: 'At least', description: 'Two or more times.' },
      { token: '*?', title: 'Lazy', description: 'A ? after a quantifier makes it match as few as possible.' },
      { token: '*+', title: 'Possessive', description: 'A + after a quantifier never gives back what it matched.', flavors: ['pcre', 'python', 'java'] },
    ],
  },
  {
    id: 'flags',
    title: 'Inline flags',
    entries: [
      { token: '(?i)', title: 'Flags for the rest', description: 'Turns on flags for the rest of the group.', flavors: ['pcre', 'python', 'java', 'dotnet', 'rust', 'go'] },
      { token: '(?i:…)', title: 'Scoped flags', description: 'Turns on flags only inside the group.' },
      { token: '(?#…)', title: 'Comment', description: 'Ignored by the engine.', flavors: ['pcre', 'python', 'dotnet'] },
    ],
  },
];

export const SHORTHAND_TEXT: Record<string, string> = {
  d: 'a digit',
  D: 'any character that is not a digit',
  w: 'a word character (letter, digit or _)',
  W: 'any character that is not a word character',
  s: 'a whitespace character',
  S: 'any character that is not whitespace',
  h: 'a horizontal whitespace character',
  H: 'any character that is not horizontal whitespace',
  v: 'a vertical whitespace character',
  V: 'any character that is not vertical whitespace',
  N: 'any character except a line break',
  R: 'a line break sequence (\\r\\n, \\n, \\r, …)',
};

export const ANCHOR_TEXT: Record<string, string> = {
  lineStart: 'the start of the text',
  lineStartMultiline: 'the start of a line',
  lineEnd: 'the end of the text',
  lineEndMultiline: 'the end of a line',
  lineEndBeforeNewline: 'the end of the text, or just before a final line break',
  wordBoundary: 'a word boundary',
  notWordBoundary: 'a position that is not a word boundary',
  stringStart: 'the start of the text, whatever the flags',
  stringEnd: 'the very end of the text',
  stringEndNewline: 'the end of the text, or just before a final line break',
  matchStart: 'the position where the previous match ended',
  keepOut: 'nothing, but drops what was matched so far from the reported match',
};

export const GROUP_TEXT: Record<string, string> = {
  capture: 'Capture group',
  named: 'Named capture group',
  noncapture: 'Group (not captured)',
  atomic: 'Atomic group: once it matched, the engine never backtracks into it',
  lookahead: 'Lookahead: must be followed by',
  negativeLookahead: 'Negative lookahead: must not be followed by',
  lookbehind: 'Lookbehind: must be preceded by',
  negativeLookbehind: 'Negative lookbehind: must not be preceded by',
  modifiers: 'Group with flags',
};

export const FLAG_TEXT: Record<string, string> = {
  i: 'ignore case',
  m: 'multiline',
  s: 'dot matches line breaks',
  x: 'extended (whitespace and comments ignored)',
  n: 'explicit capture',
  U: 'ungreedy',
  u: 'unicode',
  a: 'ASCII-only classes',
  J: 'duplicate names allowed',
  R: 'CRLF line ends',
  d: 'Unix lines',
  L: 'locale dependent',
};

export const POSIX_TEXT: Record<string, string> = {
  alpha: 'a letter',
  digit: 'a digit',
  alnum: 'a letter or digit',
  upper: 'an uppercase letter',
  lower: 'a lowercase letter',
  space: 'a whitespace character',
  punct: 'a punctuation character',
  xdigit: 'a hex digit',
  word: 'a word character',
  blank: 'a space or tab',
  cntrl: 'a control character',
  graph: 'a visible character',
  print: 'a printable character',
  ascii: 'an ASCII character',
};
