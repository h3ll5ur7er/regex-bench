import { RegexAst } from './ast';
import { BackendId } from './match';

/** A unit of work for the sandbox. Plain data, so it can cross into a worker. */
export interface ExecJob {
  id: number;
  kind: 'match' | 'trace';
  backend: BackendId;
  /** The pattern as the backend reads it (already translated when needed). */
  source: string;
  flags: string;
  global: boolean;
  limit: number;
  /** The text, or undefined when the worker already holds this `textVersion`. */
  text?: string;
  textVersion: number;
  /** For trace jobs: the parsed pattern the interpreter walks. */
  ast?: RegexAst;
}

export interface RawMatch {
  start: number;
  end: number;
  /** `[start, end]` per capture group of the executed pattern, or null. */
  groups: ([number, number] | null)[];
}

export interface ExecOutcome {
  id: number;
  ok: boolean;
  error?: string;
  matches: RawMatch[];
  capped: boolean;
  elapsedMs: number;
  /** Set when the worker needs the text again (it lost it, e.g. after a restart). */
  needText?: boolean;
  /** For trace jobs. */
  trace?: unknown;
}
