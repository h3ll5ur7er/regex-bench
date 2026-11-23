import { Diagnostic } from './diagnostic';

export interface GroupMatch {
  index: number;
  name?: string;
  start: number;
  end: number;
}

export interface MatchItem {
  start: number;
  end: number;
  /** One entry per capture group of the pattern, `null` when the group did not participate. */
  groups: (GroupMatch | null)[];
}

export type BackendId = 'native' | 'translated' | 'rust';

export interface MatchResult {
  status: 'ok' | 'error' | 'timeout';
  matches: MatchItem[];
  /** Index → name for every capture group. */
  groupNames: (string | undefined)[];
  capped: boolean;
  elapsedMs: number;
  backend: BackendId;
  /** The pattern that actually ran, when the backend translated it. */
  executedSource?: string;
  diagnostics: Diagnostic[];
}
