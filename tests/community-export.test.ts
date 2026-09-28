import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvLine, exportColumns } from '../src/affiliates/csv';

test('global columns merge matching names and types across distinct field IDs', () => {
  const result = exportColumns([
    {
      id: 'a',
      fields: [
        { id: 'city', label: 'Ciudad', type: 'text' },
        { id: 'score', label: 'Puntos', type: 'number' },
      ],
    },
    {
      id: 'b',
      fields: [
        { id: 'town', label: ' ciudad ', type: 'text' },
        { id: 'score', label: 'Puntos', type: 'text' },
        { id: 'zone', label: 'Zona', type: 'text' },
      ],
    },
  ]);
  assert.equal(result.columns.length, 4);
  assert.equal(result.mappings.get('a')!.get(0), 'city');
  assert.equal(result.mappings.get('b')!.get(0), 'town');
  assert.equal(result.mappings.get('a')!.has(3), false);
  assert.equal(result.mappings.get('b')!.has(1), false);
});

test('duplicate labels within a community retain independent columns', () => {
  const result = exportColumns([
    {
      id: 'a',
      fields: [
        { id: 'home', label: 'Teléfono', type: 'tel' },
        { id: 'work', label: 'Teléfono', type: 'tel' },
      ],
    },
  ]);
  assert.equal(result.columns.length, 2);
  assert.notEqual(result.columns[0].label, result.columns[1].label);
});

test('CSV preserves empty, false, zero, separators and quotes and neutralizes formulas', () => {
  assert.equal(
    csvLine([undefined, null, false, 0, 'North; "A"', '=HYPERLINK("x")', 'two\nlines']),
    '"";"";"false";"0";"North; ""A""";"\'=HYPERLINK(""x"")";"two\nlines"\r\n',
  );
});
