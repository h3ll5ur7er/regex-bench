import { FlavorId } from './flavor';

export type Mode = 'match' | 'replace' | 'list' | 'tests' | 'debug' | 'code' | 'convert' | 'infer';

export interface PatternSpec {
  flavor: FlavorId;
  source: string;
  /** Flags as letters, e.g. "gim". */
  flags: string;
}

export interface TestCase {
  id: string;
  text: string;
  expect: 'match' | 'no-match' | 'full-match';
}

/** Everything a user sees in the workbench; what is saved, shared and restored. */
export interface SessionState {
  version: 1;
  pattern: PatternSpec;
  text: string;
  mode: Mode;
  replacement: string;
  listTemplate: string;
  tests: TestCase[];
  inferInput: string;
}

export const DEFAULT_SESSION: SessionState = {
  version: 1,
  pattern: {
    flavor: 'ecmascript',
    source: String.raw`(?<year>\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>\d{2})`,
    flags: 'gm',
  },
  text: [
    'Release 1.4 shipped on 2026-11-23, the hotfix on 2026-11-30.',
    'Invalid dates like 2026-13-01 are skipped.',
    'Planning: 2027-01-15 kickoff, 2027-02-01 review.',
  ].join('\n'),
  mode: 'match',
  replacement: '$<day>.$<month>.$<year>',
  listTemplate: '$<year>\\t$<month>\\t$<day>\\n',
  tests: [
    { id: 't1', text: '2026-11-23', expect: 'full-match' },
    { id: 't2', text: '2026-13-01', expect: 'no-match' },
  ],
  inferInput: ['2026-11-23 INFO  api/v1/users 200 12ms', '2026-11-23 WARN  api/v1/orders 429 3ms', '2026-11-24 ERROR api/v2/users 500 154ms'].join('\n'),
};
