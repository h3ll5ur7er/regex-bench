/**
 * The pattern AST shared by every engine. It is plain data: no classes, no framework, so it can cross a
 * worker boundary through structured clone.
 */

/** A half-open range of UTF-16 offsets into the pattern source. */
export interface Span {
  start: number;
  end: number;
}

export type ShorthandKind = 'd' | 'D' | 'w' | 'W' | 's' | 'S' | 'h' | 'H' | 'v' | 'V' | 'N' | 'R';

export type AnchorKind =
  | 'lineStart' // ^
  | 'lineEnd' // $
  | 'wordBoundary' // \b
  | 'notWordBoundary' // \B
  | 'stringStart' // \A
  | 'stringEnd' // \z
  | 'stringEndNewline' // \Z
  | 'matchStart' // \G
  | 'keepOut'; // \K

export type GroupKind =
  | 'capture'
  | 'named'
  | 'noncapture'
  | 'atomic'
  | 'lookahead'
  | 'negativeLookahead'
  | 'lookbehind'
  | 'negativeLookbehind'
  | 'modifiers'; // (?i:...) or (?i-s:...)

export interface FlagModifier {
  /** Flags turned on, e.g. "i". */
  on: string;
  /** Flags turned off, e.g. "s". */
  off: string;
}

export type ClassItem =
  | { type: 'char'; value: string; span: Span }
  | { type: 'range'; from: string; to: string; span: Span }
  | { type: 'shorthand'; kind: ShorthandKind; span: Span }
  | { type: 'property'; name: string; negated: boolean; span: Span }
  | { type: 'posix'; name: string; negated: boolean; span: Span }
  | { type: 'class'; node: CharClassNode; span: Span } // nested class (Java, Rust, JS v-mode)
  | { type: 'setop'; op: '&&' | '--' | '~~'; span: Span }; // set operation between the items around it

export interface CharClassNode {
  type: 'class';
  negated: boolean;
  items: ClassItem[];
  span: Span;
}

export type RegexNode =
  | { type: 'alternation'; alternatives: RegexNode[]; span: Span }
  | { type: 'sequence'; items: RegexNode[]; span: Span }
  | { type: 'empty'; span: Span }
  | { type: 'char'; value: string; span: Span; escape?: string }
  | { type: 'dot'; span: Span }
  | CharClassNode
  | { type: 'shorthand'; kind: ShorthandKind; span: Span }
  | { type: 'property'; name: string; negated: boolean; span: Span }
  | { type: 'anchor'; kind: AnchorKind; span: Span }
  | {
      type: 'group';
      kind: GroupKind;
      body: RegexNode;
      span: Span;
      /** Capture index (1-based) for capture and named groups. */
      index?: number;
      name?: string;
      modifiers?: FlagModifier;
    }
  | {
      type: 'quantifier';
      body: RegexNode;
      min: number;
      /** `Infinity` for unbounded. */
      max: number;
      lazy: boolean;
      possessive: boolean;
      span: Span;
      /** The span of the quantifier token itself (`+`, `{2,3}?`). */
      opSpan: Span;
    }
  | { type: 'backreference'; ref: number | string; span: Span }
  | { type: 'inlineFlags'; modifiers: FlagModifier; span: Span } // (?i) applying to the rest of the group
  | { type: 'comment'; text: string; span: Span }
  | { type: 'unsupported'; text: string; span: Span }; // recognised but not modelled, e.g. (?R)

export type NodeType = RegexNode['type'];

export interface GroupInfo {
  index: number;
  name?: string;
  span: Span;
}

export interface RegexAst {
  root: RegexNode;
  groups: GroupInfo[];
}
