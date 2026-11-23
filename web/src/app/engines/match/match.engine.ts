import { inject, Injectable } from '@angular/core';
import { Diagnostic, GroupMatch, MatchItem, MatchResult, PatternSpec, RawMatch } from '../../contracts';
import { SandboxAccess } from '../../access/sandbox.access';
import { DIALECTS, dialectOf } from '../syntax/dialects';
import { Analysis } from '../syntax/syntax.engine';
import { print } from '../transform/printer';

export const DEFAULT_MATCH_LIMIT = 10_000;

interface Plan {
  backend: MatchResult['backend'];
  source: string;
  flags: string;
  /** Executed group index → source group index (null for helper groups). Index 0 unused. */
  groupMap: (number | null)[];
  diagnostics: Diagnostic[];
}

/**
 * MatchEngine: chooses how a flavor is executed (V2) and returns flavor-faithful results.
 *  - ECMAScript runs natively.
 *  - Rust runs on the Rust regex crate (WASM); Go, which shares RE2 semantics, runs there too.
 *  - PCRE, Python, Java and .NET are translated exactly into ECMAScript (atomic groups, possessive
 *    quantifiers, \A, \Z, their `$` and Unicode classes are emulated) and run natively.
 */
@Injectable({ providedIn: 'root' })
export class MatchEngine {
  private readonly sandbox = inject(SandboxAccess);

  plan(spec: PatternSpec, analysis: Analysis): Plan {
    const d = dialectOf(spec.flavor);
    const identity = [null, ...analysis.ast.groups.map((g) => g.index)];
    if (d.backend === 'native') {
      return { backend: 'native', source: spec.source, flags: spec.flags, groupMap: identity, diagnostics: [] };
    }
    if (d.backend === 'rust') {
      if (spec.flavor === 'rust') return { backend: 'rust', source: spec.source, flags: spec.flags, groupMap: identity, diagnostics: [] };
      const p = print(analysis.ast, d, DIALECTS.rust, { flags: spec.flags, mode: 'exact' });
      return { backend: 'rust', source: p.source, flags: p.flags, groupMap: p.groupMap, diagnostics: p.diagnostics };
    }
    const p = print(analysis.ast, d, DIALECTS.ecmascript, { flags: spec.flags, mode: 'exact' });
    return { backend: 'translated', source: p.source, flags: p.flags, groupMap: p.groupMap, diagnostics: p.diagnostics };
  }

  async run(spec: PatternSpec, analysis: Analysis, text: string, textVersion: number, limit = DEFAULT_MATCH_LIMIT, lane = 'match'): Promise<MatchResult | null> {
    const plan = this.plan(spec, analysis);
    const names: (string | undefined)[] = [undefined];
    for (const g of analysis.ast.groups) names[g.index] = g.name;
    const base = { groupNames: names, backend: plan.backend, executedSource: plan.backend === 'native' ? undefined : `/${plan.source}/${plan.flags}` };
    const out = await this.sandbox.execute(
      { kind: 'match', backend: plan.backend, source: plan.source, flags: plan.flags, global: spec.flags.includes('g'), limit, textVersion },
      text,
      lane,
    );
    if ('superseded' in out) return null;
    if ('timeout' in out) {
      return {
        ...base, status: 'timeout', matches: [], capped: false, elapsedMs: out.elapsedMs,
        diagnostics: [{
          severity: 'error', code: 'timeout',
          message: `Stopped after ${(out.elapsedMs / 1000).toFixed(1)} s: the engine was still searching.`,
          hint: 'This is usually catastrophic backtracking. Look for nested repetition like (a+)+ or overlapping alternatives, or try the Rust flavor, which runs in linear time.',
        }],
      };
    }
    if (!out.ok) {
      return {
        ...base, status: 'error', matches: [], capped: false, elapsedMs: out.elapsedMs,
        diagnostics: [...plan.diagnostics, { severity: 'error', code: 'engine', message: `The ${plan.backend === 'rust' ? 'Rust' : "browser's"} engine rejected the pattern: ${out.error}` }],
      };
    }
    const matches = out.matches.map((m) => remap(m, plan.groupMap, names, analysis.ast.groups.length));
    const degraded = this.sandbox.degraded
      ? [{ severity: 'warning' as const, code: 'degraded', message: 'Web Workers are unavailable here, so patterns run on the main thread on the first part of the text only.' }]
      : [];
    return { ...base, status: 'ok', matches, capped: out.capped, elapsedMs: out.elapsedMs, diagnostics: [...plan.diagnostics.filter((d) => d.severity !== 'info'), ...degraded] };
  }
}

function remap(m: RawMatch, groupMap: (number | null)[], names: (string | undefined)[], groupCount: number): MatchItem {
  const groups: (GroupMatch | null)[] = new Array(groupCount).fill(null);
  m.groups.forEach((g, i) => {
    const src = groupMap[i + 1];
    if (g && src) groups[src - 1] = { index: src, name: names[src], start: g[0], end: g[1] };
  });
  return { start: m.start, end: m.end, groups };
}
