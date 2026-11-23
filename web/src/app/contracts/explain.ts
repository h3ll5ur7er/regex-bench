import { Span } from './ast';

/** The token kinds used for colouring the pattern, the explanation and the diagram consistently. */
export type TokenKind =
  | 'literal'
  | 'escape'
  | 'meta'
  | 'class'
  | 'anchor'
  | 'group'
  | 'quantifier'
  | 'alternation'
  | 'backref'
  | 'lookaround'
  | 'flags'
  | 'comment'
  | 'unsupported';

export interface PatternToken {
  span: Span;
  kind: TokenKind;
  /** Capture group index, for group delimiters and backreferences, so they share the group's colour. */
  group?: number;
  /** Nesting depth of groups, for bracket matching colours. */
  depth: number;
}

export interface ExplainNode {
  span: Span;
  kind: TokenKind;
  /** The pattern text of this node, shortened. */
  code: string;
  /** Plain-language description. */
  text: string;
  group?: number;
  children: ExplainNode[];
}
