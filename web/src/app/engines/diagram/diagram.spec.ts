import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { load } from '@rockuml/core';
import { SyntaxEngine } from '../syntax/syntax.engine';
import { DiagramEngine } from './diagram.engine';
import { FlavorId } from '../../contracts';

const CASES: [FlavorId, string][] = [
  ['ecmascript', String.raw`^(?<year>\d{4})-(\d{2})|foo[a-z]+?$`],
  ['ecmascript', String.raw`(?:ab)*c{2,5}\b(?=x)[^0-9_]\w.`],
  ['ecmascript', String.raw`(a)\1\k<n>(?<n>b)(?<=c)(?<!d)(?!e)`],
  ['pcre', String.raw`(?>a++)\h\R\p{Lu}[[:alpha:]\]\-^]\A\z(?i)x(?#c)`],
  ['ecmascript', String.raw`"quoted" 'x' @enduml !include x \n\t\\ \/ \( 😀 ü`],
  ['ecmascript', String.raw`a||b|`],
  ['ecmascript', String.raw`()x(?:)`],
  ['ecmascript', ''],
  ['java', String.raw`[a-z&&[^aeiou]]`],
  ['ecmascript', String.raw`[\]\\\-^]`],
];

describe('DiagramEngine', () => {
  it('produces notation rockuml renders without errors', async () => {
    const rockuml = await load(await readFile('node_modules/@rockuml/core/rockuml.wasm'));
    for (const [flavor, source] of CASES) {
      const a = SyntaxEngine.analyze({ flavor, source, flags: '' });
      const n = DiagramEngine.toNotation(a.ast);
      if (n.empty) continue;
      const r = await rockuml.render(n.source);
      expect.soft(r.isError, `${source} → ${n.source}`).toBe(false);
      expect.soft(r.data).toContain('<svg');
    }
  });

  it('never lets pattern text become a directive', () => {
    const a = SyntaxEngine.analyze({ flavor: 'ecmascript', source: 'x\n@enduml\n@startuml', flags: '' });
    expect(DiagramEngine.toNotation(a.ast).source.split('\n').length).toBe(3);
  });
});
