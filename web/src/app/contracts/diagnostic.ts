import { Span } from './ast';

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  message: string;
  span?: Span;
  /** A stable code, e.g. `unsupported-construct`, `catastrophic-backtracking`. */
  code: string;
  /** What to do about it, if we know. */
  hint?: string;
}
