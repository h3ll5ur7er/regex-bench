import { ExecJob, ExecOutcome, RawMatch } from '../../contracts';

/**
 * Execution backends. They run inside the sandbox worker (or on the main thread as a fallback), so they are
 * plain functions without framework or DOM dependencies.
 */

export function runNative(job: ExecJob, text: string): ExecOutcome {
  const t0 = performance.now();
  let re: RegExp;
  try {
    const flags = [...new Set((job.flags.replace(/[gd]/g, '') + 'gd').split(''))].join('');
    re = new RegExp(job.source, flags);
  } catch (e) {
    return { id: job.id, ok: false, error: (e as Error).message, matches: [], capped: false, elapsedMs: performance.now() - t0 };
  }
  const unicode = re.unicode || re.unicodeSets;
  const matches: RawMatch[] = [];
  let capped = false;
  for (;;) {
    const m = re.exec(text) as (RegExpExecArray & { indices?: [number, number][] }) | null;
    if (!m) break;
    if (matches.length >= job.limit) {
      capped = true;
      break;
    }
    const idx = m.indices!;
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      groups: idx.slice(1).map((g) => (g ? [g[0], g[1]] : null)),
    });
    if (!job.global) break;
    if (m[0].length === 0) {
      // Step over an empty match, by a whole code point in Unicode mode.
      const cp = unicode ? text.codePointAt(re.lastIndex) ?? 0 : 0;
      re.lastIndex += cp > 0xffff ? 2 : 1;
    }
  }
  return { id: job.id, ok: true, matches, capped, elapsedMs: performance.now() - t0 };
}

/** The exports of core/ (docs/Decisions/ADR-006-rust-core-c-abi.md). */
interface RustCore {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  run(ptr: number, len: number): number;
}

export async function instantiateRustCore(module: WebAssembly.Module): Promise<RustCore> {
  const instance = await WebAssembly.instantiate(module, {});
  return instance.exports as unknown as RustCore;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function runRust(core: RustCore, job: ExecJob, text: string): ExecOutcome {
  const t0 = performance.now();
  const req = encoder.encode(JSON.stringify({ pattern: job.source, flags: job.flags.replace(/g/g, ''), text, global: job.global, limit: job.limit }));
  const ptr = core.alloc(req.length);
  new Uint8Array(core.memory.buffer, ptr, req.length).set(req);
  const out = core.run(ptr, req.length);
  core.dealloc(ptr, req.length);
  const len = new DataView(core.memory.buffer).getUint32(out, true);
  const json = decoder.decode(new Uint8Array(core.memory.buffer, out + 4, len));
  core.dealloc(out, len + 4);
  const r = JSON.parse(json) as { ok: boolean; error?: string; matches: { start: number; end: number; groups: ([number, number] | null)[] }[]; capped: boolean };
  return { id: job.id, ok: r.ok, error: r.error, matches: r.matches ?? [], capped: !!r.capped, elapsedMs: performance.now() - t0 };
}
