import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePanelToCellTemplate } from '../dist/esm/report-template/panelToTemplateAdapter.js';
import { expandCellDrivenTemplate } from '../dist/esm/report-template/cellExpansionEngine.js';
import { compileCellReport } from '../dist/esm/report-template/compileCellReport.js';
import { adaptPublishedSheetToVTable } from '../dist/esm/ui/presentation/report/gridAdapter.js';
import { syncDocumentFromWorkbookSnapshot } from '../dist/esm/cell-designer/syncWorkbookToTemplate.js';
import { applyHybridFormatPreset, collectHybridExtras, mergeHybridCells, mergeHybridLayoutRules, readHybridFormatPreset, readHybridRowTotals } from '../dist/esm/cell-designer/hybridTemplateState.js';

const config = {
  datasetId: 'orders', headers: { workshop: '承制车间', day: '投产日', qty: '交付件数', defects: '缺陷件数' },
  dimensions: { categories: ['workshop'], columnTimeBucket: { field: 'day', granularity: 'day' } },
  columns: ['qty', 'defects'].map((field) => ({ type: 'aggregated', field, agg: 'sum' })),
};
const data = [
  { id: 1, workshop: 'A', day: '2026-08-01', qty: 600, defects: 5 },
  { id: 2, workshop: 'A', day: '2026-08-02', qty: 750, defects: 20 },
  { id: 3, workshop: 'A', day: '2026-08-02', qty: 50, defects: 2 },
  { id: 4, workshop: 'B', day: '2026-08-01', qty: 1200, defects: 19 },
];
const panel = (showRowTotals = true, options = {}) => compilePanelToCellTemplate(config, 'orders', {
  showRowTotals, formats: { qty: 'decimal2', defects: 'integer' }, ...options,
});
const clone = (value) => JSON.parse(JSON.stringify(value));
const totals = (grid) => grid.cells.filter((c) => c.metricId?.startsWith('metric-rowtotal-'));
const at = (grid, r, c) => grid.cells.find((cell) => cell.row === r && cell.col === c);

function designSnapshot(doc, notes = []) {
  const cellData = {};
  for (const c of [...doc.cells, ...notes]) {
    const { row, column } = c.position;
    (cellData[row] ??= {})[column] = { v: c.content.kind === 'literal' ? c.content.value : `{${c.id}}` };
  }
  return { sheets: { 'sheet-1': { cellData, mergeData: [] } } };
}
const compose = (base, extras) => ({ ...base, cells: mergeHybridCells(base, extras) });

test('H3-F01: row totals aggregate the entire row once, after all date columns', () => {
  const doc = panel();
  const before = structuredClone(doc);
  const result = expandCellDrivenTemplate(doc, data);
  assert.equal(result.diagnostics.filter((d) => d.severity === 'error').length, 0);
  assert.deepEqual(doc, before, 'compilation must not mutate saved parent declarations');
  const totalCells = totals(result.grid);
  assert.equal(totalCells.length, 4);
  assert.deepEqual(totalCells.map((c) => c.value), [1400, 1200, 27, 19]);
  assert.equal(new Set(totalCells.map((c) => c.col)).size, 1);
  const totalCol = totalCells[0].col;
  const headers = result.grid.cells.filter((c) => c.value === '行总计');
  assert.equal(headers.length, 1);
  assert.equal(headers[0].col, totalCol);
  assert.ok(result.grid.cells.filter((c) => c.metricId === 'metric-qty').every((c) => c.col < totalCol));
  assert.equal(at(result.grid, totalCells[0].row, totalCol).displayText, '1400.00');
});

test('H3-F01: AVG / COUNT / MIN / MAX totals use row facts rather than per-date aggregates', () => {
  for (const [agg, expected] of [['avg', 1400 / 3], ['count', 3], ['min', 50], ['max', 750], ['sum', 1400]]) {
    const doc = compilePanelToCellTemplate({ ...config, columns: [{ type: 'aggregated', field: 'qty', agg }] }, 'orders', { showRowTotals: true });
    const cells = totals(expandCellDrivenTemplate(doc, data).grid);
    assert.equal(cells.length, 2, agg);
    assert.equal(cells[0].value, expected, agg);
  }
});

test('H3-F01: insert/delete/sort and JSON save retain totals and VTable text at the moving right edge', () => {
  const doc = clone(panel());
  const variants = [data, [...data].reverse(), [...data, { id: 5, workshop: 'C', day: '2026-08-03', qty: 100, defects: 1 }], data.filter((d) => d.day === '2026-08-01')];
  for (const facts of variants) {
    const compiled = compileCellReport(doc, facts);
    assert.equal(compiled.valid, true, JSON.stringify(compiled.diagnostics));
    const sheet = compiled.publication.sheets[0];
    const table = adaptPublishedSheetToVTable(sheet, compiled.publication.styles);
    const dateCount = new Set(facts.map((d) => d.day)).size;
    const header = sheet.cells.filter((c) => c.v === '行总计');
    assert.equal(header.length, 1);
    assert.equal(header[0].c, 2 + dateCount);
    const expanded = expandCellDrivenTemplate(doc, facts).grid;
    for (const c of totals(expanded)) {
      assert.equal(c.col, header[0].c);
      assert.equal(table.records[c.row][`col_${c.col}`], c.displayText);
    }
    const expected = [...new Set(facts.map((d) => d.workshop))].sort().map((w) => facts.filter((d) => d.workshop === w).reduce((s, d) => s + d.qty, 0));
    assert.deepEqual(totals(expanded).filter((c) => c.metricId === 'metric-rowtotal-qty').map((c) => c.value), expected);
  }
});

test('H3-F01: row-only total and column-only summary both follow expanded perpendicular blocks', () => {
  const doc = panel();
  const colDriver = doc.cells.find((c) => c.content.role === 'column-dimension');
  doc.cells.push({ id: 'column-summary', sheetId: 'sheet-1', regionId: 'region-1', position: { row: 5, column: 2 },
    parents: { row: 'none', column: colDriver.id }, content: { kind: 'field', fieldId: 'qty', fieldKey: 'qty', metricId: 'col-summary', role: 'measure', operation: 'sum', expand: 'inherit' } });
  const grid = expandCellDrivenTemplate(doc, data).grid;
  const summaries = grid.cells.filter((c) => c.metricId === 'col-summary');
  assert.equal(summaries.length, 2);
  assert.ok(summaries.every((c) => c.row === 7));
  assert.deepEqual(summaries.map((c) => c.value), [1800, 800]);
});

test('H3-F02: stale design snapshot cannot restore disabled generated cells; identical user note survives', () => {
  const original = panel(true);
  const disabled = panel(false, { enableGroupMerge: false });
  const note = { id: 'user-note', sheetId: 'sheet-1', position: { row: 1, column: 5 }, content: { kind: 'literal', value: '行总计' }, parents: { row: 'none', column: 'none' } };
  const stale = syncDocumentFromWorkbookSnapshot(original, designSnapshot(original, [note]), 'design');
  const extras = collectHybridExtras(stale, original, original.cells.filter((c) => c.id.startsWith('meas-rowtotal-')), disabled);
  assert.ok(!extras.some((c) => c.id === 'hdr-row-total' || c.id.startsWith('meas-rowtotal-')));
  const saved = clone(compose(disabled, extras));
  assert.equal(readHybridRowTotals(saved), false);
  const notes = saved.cells.filter((c) => c.content.kind === 'literal' && c.content.value === '行总计');
  assert.equal(notes.length, 1);
  assert.deepEqual(notes[0].position, note.position);
  assert.equal(saved.mergeConfig.policies.length, 0);
  const reopenedExtras = collectHybridExtras(saved, disabled, [], disabled);
  const reopened = compose(disabled, reopenedExtras);
  assert.equal(readHybridRowTotals(reopened), false);
  assert.equal(totals(expandCellDrivenTemplate(reopened, data).grid).length, 0);
  assert.ok(reopened.cells.some((c) => c.content.value === '行总计'));
});

test('H3-F02: explicit false takes priority and a legacy orphan header does not imply row totals', () => {
  assert.equal(readHybridRowTotals({ ...panel(true), hybridConfig: { version: 1, showRowTotals: false } }), false);
  const legacy = clone(panel(true));
  delete legacy.hybridConfig;
  for (const c of legacy.cells) delete c.panelOwner;
  assert.equal(readHybridRowTotals(legacy), true);
  legacy.cells = legacy.cells.filter((c) => !c.id.startsWith('meas-rowtotal-'));
  assert.equal(readHybridRowTotals(legacy), false);
  const base = panel(false);
  assert.ok(!compose(base, collectHybridExtras(legacy, base, [], base)).cells.some((c) => c.id === 'hdr-row-total'));
});

test('H3-F02: removed metric overrides cannot attach to another metric reusing its coordinates', () => {
  const original = panel();
  const qty = original.cells.find((c) => c.id === 'meas-qty');
  const advanced = { ...qty, formatOptions: { format: 'decimal2', suffix: '件' } };
  const active = compilePanelToCellTemplate({ ...config, columns: [{ type: 'aggregated', field: 'defects', agg: 'sum' }] }, 'orders');
  const saved = compose(active, [advanced, ...original.cells.filter((c) => c.id === 'hdr-row-total')]);
  const nextMetric = saved.cells.find((c) => c.id === 'meas-defects');
  assert.equal(nextMetric.formatOptions?.suffix, undefined);
  assert.ok(!saved.cells.some((c) => c.id === 'meas-qty' || c.id === 'hdr-row-total'));
});

test('H3-F02: switching total off then on discards inactive overrides and creates a clean total', () => {
  const on = panel(true);
  const off = panel(false);
  const old = on.cells.find((c) => c.id === 'meas-rowtotal-qty');
  const oldDoc = compose(on, [{ ...old, formatOptions: { suffix: '旧覆盖' } }]);
  const extras = collectHybridExtras(oldDoc, on, [], off);
  const enabled = compose(panel(true), extras);
  const total = enabled.cells.find((c) => c.id === old.id);
  assert.equal(total.formatOptions?.suffix, undefined);
  assert.equal(total.parents.column, 'none');
});

test('H3-F03: each simple format roundtrips as the same preset', () => {
  for (const format of ['decimal2', 'integer', 'currency', 'percent', 'number']) {
    const doc = panel(false, { formats: { qty: format } });
    const saved = clone(doc);
    const cell = saved.cells.find((c) => c.id === 'meas-qty');
    assert.equal(readHybridFormatPreset(cell), format);
    const base = panel(false, { formats: { qty: cell.content.format } });
    const restored = compose(base, collectHybridExtras(saved, base, [], base));
    assert.equal(readHybridFormatPreset(restored.cells.find((c) => c.id === cell.id)), format);
  }
});

test('H3-F03: advanced precision/unit/scale/styles survive reopen and VTable publication without editing', () => {
  const base = panel(false);
  const cell = base.cells.find((c) => c.id === 'meas-qty');
  const formatOptions = { format: 'decimal2', precision: 3, useGrouping: false, scale: 1000, prefix: '约', suffix: '千件', negativeFormat: 'bracket' };
  const advanced = { ...cell, formatOptions, content: { ...cell.content, formatOptions }, style: { ...cell.style, bold: true, color: '#ff0000' } };
  const saved = clone(compose(base, [advanced]));
  const original = clone(saved);
  const reopened = compose(base, collectHybridExtras(saved, base, [], base));
  const target = reopened.cells.find((c) => c.id === cell.id);
  assert.equal(readHybridFormatPreset(target), 'custom');
  assert.deepEqual(target.formatOptions, formatOptions);
  assert.equal(target.style.color, '#ff0000');
  assert.deepEqual(saved, original);
  const compiled = compileCellReport(reopened, data);
  assert.equal(compiled.valid, true);
  const table = adaptPublishedSheetToVTable(compiled.publication.sheets[0], compiled.publication.styles);
  const gridCell = expandCellDrivenTemplate(reopened, data).grid.cells.find((c) => c.metricId === 'metric-qty');
  assert.equal(gridCell.displayText, '约0.600千件');
  assert.equal(table.records[gridCell.row][`col_${gridCell.col}`], '约0.600千件');
});

test('H3-F03: selecting a simple preset replaces obsolete precision while preserving the unit', () => {
  const cell = panel(false).cells.find((c) => c.id === 'meas-qty');
  const advanced = { ...cell, formatOptions: { precision: 5, suffix: '件', scale: 1000 }, content: { ...cell.content, formatOptions: { precision: 5, suffix: '件', scale: 1000 } } };
  const changed = applyHybridFormatPreset(advanced, 'integer');
  assert.equal(changed.content.formatOptions.precision, 0);
  assert.equal(changed.formatOptions.useGrouping, true);
  assert.equal(changed.formatOptions.suffix, '件');
  assert.equal(changed.formatOptions.scale, 1000);
  assert.equal(readHybridFormatPreset(changed), 'custom');
  assert.equal(advanced.formatOptions.precision, 5);
});

test('Hybrid layout composition preserves distinct custom widths and avoids duplicate title merge', () => {
  const base = panel();
  const custom = { id: 'width-note', kind: 'column-width', sheetId: 'sheet-1', index: 8, size: 180 };
  const rules = mergeHybridLayoutRules(base, [base.layoutRules.find((r) => r.kind === 'merge'), custom]);
  assert.equal(rules.filter((r) => r.kind === 'merge').length, 1);
  assert.ok(rules.includes(custom));
});
