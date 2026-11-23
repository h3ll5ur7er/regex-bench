import { describe, expect, it } from 'vitest';
import { infer } from './inference.engine';

describe('InferenceEngine', () => {
  it('infers a structured log pattern and marks groups', () => {
    const input = ['2026-11-23 INFO  api/v1/users 200 12ms', '2026-11-23 WARN  api/v1/orders 429 3ms', '2026-11-24 ERROR api/v2/users 500 154ms'].join('\n');
    const r = infer(input, [{ line: 0, start: 30, end: 33, name: 'status' }]);
    expect(r.coverage).toEqual([true, true, true]);
    expect(r.source).toContain('(?<status>\\d{3})');
    expect(r.source).not.toContain('.*');
    expect(r.source).toContain('(?:ERROR|INFO|WARN)');
  });

  it('makes tokens optional when some lines lack them', () => {
    const r = infer(['1.2', '1.2.3', '10.20'].join('\n'));
    expect(r.coverage.every(Boolean)).toBe(true);
    expect(r.source).toMatch(/\?/);
    expect(new RegExp(r.source).test('7.8')).toBe(true);
    expect(new RegExp(r.source).test('abc')).toBe(false);
  });

  it('generalises word shapes', () => {
    const r = infer(['user42', 'user7', 'user108'].join('\n'));
    expect(r.source).toBe('^user\\d{1,3}$');
  });

  it('recognises hex', () => {
    const r = infer(['3fa9c1', '00be12', 'aa01ff'].join('\n'));
    expect(r.source).toBe('^[0-9a-f]{6}$');
  });
});
