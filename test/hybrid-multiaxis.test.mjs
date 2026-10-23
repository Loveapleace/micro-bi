import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePanelToCellTemplate } from '../dist/esm/report-template/panelToTemplateAdapter.js';
import { expandCellDrivenTemplate } from '../dist/esm/report-template/cellExpansionEngine.js';
import { compileCellReport } from '../dist/esm/report-template/compileCellReport.js';
import { readHybridAxes, validateHybridAxes } from '../dist/esm/report-template/hybridAxes.js';
import { collectHybridExtras, mergeHybridCells, mergeHybridLayoutRules } from '../dist/esm/cell-designer/hybridTemplateState.js';
import { adaptPublishedSheetToVTable } from '../dist/esm/ui/presentation/report/gridAdapter.js';
import { decodeMemberValue } from '../dist/esm/report-template/identity.js';
import { captureHybridPreviewMerges, mergeRetainedHybridConfig, rebindHybridMergeConfig } from '../dist/esm/cell-designer/hybridMergeState.js';
import { preserveSavedAxisOrder } from '../dist/esm/report-template/hybridAxes.js';

const rows = [
  { id: 1, finish: '2026-09-01', plan: '2026-08-01', shop: 'A', line: '1', part: 'X', shift: 'D', qty: 10, defects: 1 },
  { id: 2, finish: '2026-09-01', plan: '2026-08-02', shop: 'A', line: '1', part: 'Y', shift: 'N', qty: 20, defects: 2 },
  { id: 3, finish: '2026-09-02', plan: '2026-08-03', shop: 'A', line: '2', part: 'X', shift: 'D', qty: 30, defects: 3 },
  { id: 4, finish: '2026-10-01', plan: '2026-09-01', shop: 'B', line: '1', part: 'X', shift: 'D', qty: 40, defects: 4 },
  { id: 5, finish: '2026-10-02', plan: '2026-09-02', shop: 'B', line: '2', part: 'Y', shift: 'N', qty: 50, defects: 5 },
  { id: 6, finish: '2026-09-01', plan: '2026-08-04', shop: 'A', line: '1', part: 'X', shift: 'N', qty: 5, defects: 1 },
];
const config = {
  datasetId: 'orders', headers: { finish: '完工月', plan: '投产月', shop: '车间', line: '产线', part: '产品', shift: '班次', qty: '交付', defects: '缺陷' },
  dimensions: { timeBucket: { field: 'finish', granularity: 'month' }, categories: ['shop', 'line'],
    columnTimeBucket: { field: 'plan', granularity: 'month' }, columnCategories: ['part', 'shift'] },
  columns: ['qty', 'defects'].map((field) => ({ type: 'aggregated', field, agg: 'sum' })),
};
const template = (cfg = config, options = {}) => compilePanelToCellTemplate(cfg, 'orders', { showRowTotals: true, formats: { qty: 'decimal2', defects: 'integer' }, ...options });
const clone = (v) => JSON.parse(JSON.stringify(v));
const member = (path, field) => {
  const value = path?.find((p) => p.field === field)?.memberKey;
  return typeof value === 'string' && /^(s|n|b|d):/.test(value) ? decodeMemberValue(value) : value;
};
const errors = (d) => d.filter((x) => x.severity === 'error');

test('HDIM-01 all time and category axes have ordered explicit parent chains', () => {
  const doc = template();
  assert.equal(doc.hybridConfig.version, 2);
  assert.deepEqual(doc.hybridConfig.rowAxes.map((a) => a.fieldKey), ['finish', 'shop', 'line']);
  assert.deepEqual(doc.hybridConfig.columnAxes.map((a) => a.fieldKey), ['plan', 'part', 'shift']);
  assert.deepEqual(validateHybridAxes(doc), []);
  for (const axis of ['row', 'column']) {
    const defs = doc.cells.filter((c) => c.content.role === `${axis}-dimension`);
    assert.equal(defs.length, 3);
    for (let i = 1; i < defs.length; i++) assert.equal(defs[i].parents[axis], defs[i - 1].id);
  }
});

test('HDIM-02 multi-axis cross values use the complete row and column fact intersection', () => {
  const doc = template();
  const before = structuredClone(doc);
  const { grid, diagnostics } = expandCellDrivenTemplate(doc, rows);
  assert.deepEqual(errors(diagnostics), []);
  assert.deepEqual(doc, before);
  const values = grid.cells.filter((c) => c.metricId === 'metric-qty');
  assert.equal(values.length, 4 * 5);
  for (const c of values) {
    const facts = rows.filter((r) => r.finish.slice(0, 7) === member(c.rowPath, 'finish') && r.shop === member(c.rowPath, 'shop') && r.line === member(c.rowPath, 'line') &&
      r.plan.slice(0, 7) === member(c.columnPath, 'plan') && r.part === member(c.columnPath, 'part') && r.shift === member(c.columnPath, 'shift'));
    assert.equal(c.value, facts.reduce((sum, r) => sum + r.qty, 0));
  }
  const totals = grid.cells.filter((c) => c.metricId === 'metric-rowtotal-qty');
  assert.deepEqual(totals.map((c) => c.value), [35, 30, 40, 50]);
  assert.equal(new Set(totals.map((c) => c.col)).size, 1);
  assert.ok(totals.every((c) => c.col > Math.max(...values.map((v) => v.col))));
});

test('HDIM-03 nested headers with repeated names merge within their complete parent path', () => {
  const { grid, diagnostics } = expandCellDrivenTemplate(template(), rows);
  assert.deepEqual(errors(diagnostics), []);
  const colLabels = grid.cells.filter((c) => c.role === 'dimension-member' && c.columnPath?.length);
  assert.ok(colLabels.some((c) => c.value === '2026-08'));
  assert.ok(colLabels.some((c) => c.value === '2026-09'));
  assert.ok(grid.merges.some((m) => m.startRow === 2 && m.endRow === 2 && m.endCol > m.startCol));
  for (const merge of grid.merges.filter((m) => m.startRow === 3 && m.endRow === 3)) {
    const parentMonths = colLabels.filter((c) => c.row === 4 && c.col >= merge.startCol && c.col <= merge.endCol).map((c) => member(c.columnPath, 'plan'));
    assert.ok(new Set(parentMonths).size <= 1, 'same X/Y label must not merge across months');
  }
});

test('HDIM-04 insert/delete/reorder facts retains VTable values and moving totals after JSON save', () => {
  const doc = clone(template());
  const added = { ...rows[0], id: 7, plan: '2026-11-01', part: 'Z', qty: 70 };
  for (const facts of [rows, [...rows].reverse(), [...rows, added], rows.filter((r) => r.shift !== 'D')]) {
    const result = compileCellReport(doc, facts);
    assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
    const grid = expandCellDrivenTemplate(doc, facts).grid;
    const table = adaptPublishedSheetToVTable(result.publication.sheets[0], result.publication.styles);
    for (const cell of grid.cells.filter((c) => c.metricId)) assert.equal(table.records[cell.row][`col_${cell.col}`], cell.displayText);
    const total = grid.cells.filter((c) => c.metricId === 'metric-rowtotal-qty').reduce((sum, c) => sum + c.value, 0);
    assert.equal(total, facts.reduce((sum, r) => sum + r.qty, 0));
  }
});

test('HDIM-05 grouped time and three categories do not truncate and keep all measures', () => {
  const doc = template({ ...config, dimensions: { timeBucket: { field: 'finish', granularity: 'month' }, categories: ['shop', 'line', 'shift'] } });
  assert.equal(doc.cells.filter((c) => c.content.role === 'row-dimension').length, 4);
  const result = compileCellReport(doc, rows);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  const values = expandCellDrivenTemplate(doc, rows).grid.cells.filter((c) => c.metricId === 'metric-qty');
  assert.equal(values.reduce((sum, c) => sum + c.value, 0), 155);
});

test('HDIM-06 column time and multiple categories work without a row dimension', () => {
  const doc = template({ ...config, dimensions: { columnTimeBucket: config.dimensions.columnTimeBucket, columnCategories: ['part', 'shift'] } });
  const result = compileCellReport(doc, rows);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  const grid = expandCellDrivenTemplate(doc, rows).grid;
  assert.equal(grid.cells.filter((c) => c.metricId === 'metric-qty').reduce((sum, c) => sum + c.value, 0), 155);
});

test('HDIM-07 raw date classification and bucket axis have separate driver identities', () => {
  const doc = template({ ...config, dimensions: { categories: ['shop'], columnTimeBucket: config.dimensions.columnTimeBucket, columnCategories: ['plan', 'part'] } });
  assert.deepEqual(validateHybridAxes(doc), []);
  assert.equal(new Set(doc.cells.map((c) => c.id)).size, doc.cells.length);
  assert.equal(compileCellReport(doc, rows).valid, true);
});

test('HDIM-08 missing axes, wrong bucket and broken hierarchy block publication', () => {
  for (const mutate of [
    (d) => { d.cells.find((c) => c.id === 'cell-row-finish').parents.row = 'title'; },
    (d) => { d.cells = d.cells.filter((c) => c.id !== 'cell-col-part'); },
    (d) => { d.cells.find((c) => c.id === 'cell-col-plan').content.timeBucket.granularity = 'day'; },
    (d) => { d.cells.find((c) => c.id === 'cell-col-shift').parents.column = 'cell-col-plan'; },
  ]) {
    const doc = clone(template()); mutate(doc);
    assert.equal(compileCellReport(doc, rows).valid, false);
  }
});

test('HDIM-09 duplicate selection and missing dataset field produce explicit errors', () => {
  const duplicate = template({ ...config, dimensions: { ...config.dimensions, columnCategories: ['part', 'part'] } });
  assert.equal(compileCellReport(duplicate, rows).valid, false);
  const missing = template({ ...config, dimensions: { ...config.dimensions, columnCategories: ['unknown'] } });
  assert.equal(compileCellReport(missing, rows).valid, false);
});

test('HDIM-10 saved intent restores on empty facts and legacy axes follow parents rather than array order', () => {
  const saved = clone(template());
  assert.deepEqual(readHybridAxes(saved), { rowAxes: saved.hybridConfig.rowAxes, columnAxes: saved.hybridConfig.columnAxes });
  const legacy = clone(saved);
  delete legacy.hybridConfig;
  legacy.cells.reverse();
  const restored = readHybridAxes(legacy);
  assert.deepEqual(restored.rowAxes.map((s) => s.fieldKey), ['finish', 'shop', 'line']);
  assert.deepEqual(restored.columnAxes.map((s) => s.fieldKey), ['plan', 'part', 'shift']);
});

test('HDIM-11 styles and advanced formats follow metric identity when axes insert or reorder', () => {
  const single = template({ ...config, dimensions: { categories: ['shop'], columnTimeBucket: config.dimensions.columnTimeBucket } });
  const cell = single.cells.find((c) => c.id === 'meas-qty');
  const override = { ...cell, style: { ...cell.style, bold: true, color: '#ee0011' }, formatOptions: { format: 'decimal2', suffix: '件', precision: 3 } };
  const note = { id: 'my-note', sheetId: 'sheet-1', position: { row: 1, column: 6 }, parents: { row: 'none', column: 'none' }, content: { kind: 'literal', value: '保留说明' } };
  const old = { ...single, cells: mergeHybridCells(single, [override, note]) };
  for (const next of [template(), template({ ...config, dimensions: { ...config.dimensions, categories: ['line', 'shop'] } })]) {
    const extras = collectHybridExtras(old, single, [override, note], next);
    const updated = { ...next, cells: mergeHybridCells(next, extras) };
    const qty = updated.cells.find((c) => c.id === 'meas-qty');
    assert.equal(qty.style.color, '#ee0011');
    assert.equal(qty.formatOptions.suffix, '件');
    assert.equal(qty.parents.row, next.cells.find((c) => c.id === 'meas-qty').parents.row);
    assert.ok(updated.cells.some((c) => c.id === note.id && c.content.value === '保留说明'));
    assert.equal(compileCellReport(clone(updated), rows).valid, true);
  }
});

test('HDIM-12 a new axis occupying a free note reports a collision without discarding the note', () => {
  const base = template();
  const occupied = base.cells.find((c) => c.content.role === 'column-dimension').position;
  const note = { id: 'collision-note', sheetId: 'sheet-1', position: occupied, content: { kind: 'literal', value: '不可丢失' }, parents: { row: 'none', column: 'none' } };
  const doc = { ...base, cells: mergeHybridCells(base, [note]) };
  assert.ok(doc.cells.some((c) => c.id === note.id));
  const result = compileCellReport(doc, rows);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((d) => d.code === 'ERR_HYBRID_CELL_COLLISION'));
});

test('HDIM-13 clearing all group merges and JSON resave does not restore nested merges', () => {
  const disabled = template(config, { enableGroupMerge: false });
  assert.equal(disabled.hybridConfig.enableGroupMerge, false);
  for (const facts of [rows, [...rows].reverse()]) {
    const result = expandCellDrivenTemplate(clone(disabled), facts);
    assert.deepEqual(errors(result.diagnostics), []);
    assert.ok(!result.grid.merges.some((m) => m.startRow >= 2));
  }
});

test('HDIM-14 manual note merges and widths survive composition and JSON save', () => {
  const base = template();
  const merge = { id: 'my-note-merge', sheetId: 'sheet-1', kind: 'merge', range: { startRow: 1, endRow: 1, startColumn: 6, endColumn: 7 }, source: 'user' };
  const width = { id: 'my-width', sheetId: 'sheet-1', kind: 'column-width', index: 6, size: 233, source: 'user' };
  const rules = clone(mergeHybridLayoutRules(base, [merge, width]));
  assert.ok(rules.some((r) => r.id === merge.id));
  assert.equal(rules.find((r) => r.index === 6)?.size, 233);
});

test('HDIM-15 native unmerge retains the semantic parent-group exception across source changes', () => {
  const doc = template();
  const grid = expandCellDrivenTemplate(doc, rows).grid;
  const target = grid.mergeOrigins.find((m) => m.origin === 'group-span' && m.targetCellId === 'cell-col-plan');
  assert.ok(target);
  const snapshot = { sheets: { 'sheet-1': { cellData: {}, mergeData: grid.merges.filter((m) => JSON.stringify(m) !== JSON.stringify(target.range)).map((m) => ({
    startRow: m.startRow, endRow: m.endRow, startColumn: m.startCol, endColumn: m.endCol,
  })) } } };
  const saved = clone(captureHybridPreviewMerges(doc, snapshot, grid));
  assert.ok(saved.mergeConfig.suppressions.some((s) => s.groupContextKey === target.groupContextKey));
  assert.ok(saved.mergeConfig.policies.some((p) => p.id === target.ruleId && p.enabled));
  const facts = [...rows, { ...rows[0], id: 7, part: 'Z', qty: 7 }].reverse();
  const next = expandCellDrivenTemplate(saved, facts).grid;
  assert.ok(!next.mergeOrigins.some((m) => m.groupContextKey === target.groupContextKey));
  assert.ok(next.mergeOrigins.some((m) => m.origin === 'group-span' && m.targetCellId === 'cell-col-plan'));
});

test('HDIM-16 static note merge follows the same block displacement as its content', () => {
  const doc = template();
  const note = { id: 'note', sheetId: 'sheet-1', regionId: 'region-1', position: { row: 1, column: 6 },
    parents: { row: 'none', column: 'none' }, content: { kind: 'literal', value: '合并说明' } };
  doc.cells.push(note);
  doc.layoutRules.push({ id: 'merge-note', sheetId: 'sheet-1', kind: 'merge', source: 'user', range: { startRow: 1, endRow: 1, startColumn: 6, endColumn: 7 } });
  for (const facts of [rows, [...rows, { ...rows[0], id: 7, part: 'Z', qty: 7 }]]) {
    const result = compileCellReport(clone(doc), facts);
    assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
    const sheet = result.publication.sheets[0];
    const cell = sheet.cells.find((c) => c.v === '合并说明');
    assert.ok(sheet.merges.some((m) => m.startRow === cell.r && m.startCol === cell.c && m.endCol === cell.c + 1));
  }
});

test('HDIM-17 native cancel of a manual note merge remains cancelled after preview capture and JSON save', () => {
  const doc = template();
  doc.cells.push({ id: 'note', sheetId: 'sheet-1', regionId: 'region-1', position: { row: 1, column: 6 },
    parents: { row: 'none', column: 'none' }, content: { kind: 'literal', value: '说明' } });
  doc.layoutRules.push({ id: 'merge-note', kind: 'merge', sheetId: 'sheet-1', range: { startRow: 1, endRow: 1, startColumn: 6, endColumn: 7 } });
  const grid = expandCellDrivenTemplate(doc, rows).grid;
  const origin = grid.mergeOrigins.find((m) => m.ruleId === 'merge-note');
  const raw = grid.merges.filter((m) => JSON.stringify(m) !== JSON.stringify(origin.range)).map((m) => ({ startRow: m.startRow, endRow: m.endRow, startColumn: m.startCol, endColumn: m.endCol }));
  const saved = clone(captureHybridPreviewMerges(doc, { sheets: { 'sheet-1': { mergeData: raw, cellData: {} } } }, grid));
  assert.ok(saved.hybridConfig.disabledLayoutRuleIds.includes('merge-note'));
  assert.ok(!expandCellDrivenTemplate(saved, rows).grid.mergeOrigins.some((m) => m.ruleId === 'merge-note'));
});

test('HDIM-18 custom time buckets and saved category order remain explicit', () => {
  const doc = template({ ...config, dimensions: { timeBucket: { field: 'finish', granularity: 'custom', customIntervalDays: 7 }, categories: ['shop', 'line'] } });
  assert.equal(doc.hybridConfig.rowAxes[0].timeBucket.customIntervalDays, 7);
  const result = compileCellReport(doc, rows);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(expandCellDrivenTemplate(doc, rows).grid.cells.filter((c) => c.metricId === 'metric-qty').reduce((sum, c) => sum + c.value, 0), 155);
});

test('HDIM-19 sparse fields beyond first 100 facts and declared nullable fields remain valid', () => {
  const facts = [...Array.from({ length: 110 }, (_, i) => ({ ...rows[0], id: i + 10 })), { ...rows[1], id: 200, optional: 'V' }];
  const doc = template({ ...config, dimensions: { categories: ['optional'], columnCategories: ['shop'] } });
  assert.equal(compileCellReport(doc, facts).valid, true);
  const sparse = template({ ...config, dimensions: { categories: ['declared'], columnCategories: ['shop'] } });
  assert.equal(compileCellReport(sparse, rows, { availableFields: ['declared'] }).valid, true);
});

test('HDIM-20 legacy secondary-axis merge policy rebinds by field identity and keeps its suppression', () => {
  const legacy = template({ ...config, dimensions: { categories: ['shop', 'line'] } });
  const oldPolicy = legacy.mergeConfig.policies.find((p) => p.target.templateCellId === 'cell-sec-line');
  oldPolicy.enabled = false;
  legacy.mergeConfig.suppressions.push({ id: 'supp', policyId: oldPolicy.id, policyKind: 'group-span', scope: 'group-context', groupContextKey: 'kept', source: 'user', sequence: 1 });
  const next = template();
  const rebound = rebindHybridMergeConfig(legacy.mergeConfig, legacy.cells, next);
  const policy = rebound.policies.find((p) => p.target.templateCellId === 'cell-row-line');
  assert.equal(policy.enabled, false);
  assert.equal(rebound.suppressions[0].policyId, policy.id);
  assert.equal(rebound.suppressions[0].groupContextKey, 'kept');
});

test('HDIM-21 saved time attributes and category order survive unchanged reopen, explicit reorder takes effect', () => {
  const axes = template().hybridConfig.rowAxes;
  const saved = clone(axes);
  saved[0].timeBucket.timezone = 'Asia/Shanghai';
  const unchanged = preserveSavedAxisOrder(clone(axes), saved);
  assert.equal(unchanged[0].timeBucket.timezone, 'Asia/Shanghai');
  const reordered = preserveSavedAxisOrder([axes[0], axes[2], axes[1]], saved);
  assert.deepEqual(reordered.map((a) => a.fieldKey), ['finish', 'line', 'shop']);
});

test('HDIM-22 temporary axis removal and empty preview capture preserve dormant merge rules', () => {
  const doc = template();
  const previous = clone(doc.mergeConfig);
  previous.suppressions.push({ id: 'old-exception', policyId: previous.policies[0].id, policyKind: 'group-span', scope: 'group-context',
    groupContextKey: 'kept', source: 'user', sequence: 1 });
  const inactive = { ...previous, policies: [], suppressions: [] };
  const retained = mergeRetainedHybridConfig(previous, inactive);
  assert.equal(retained.policies.length, previous.policies.length);
  assert.equal(retained.suppressions.length, 1);
  const restored = rebindHybridMergeConfig(clone(retained), doc.cells, template());
  assert.equal(restored.policies.length, previous.policies.length);
  assert.equal(restored.suppressions[0].groupContextKey, 'kept');
});

test('HDIM-23 explicit legacy default axis options still compile complete dimensions', () => {
  const doc = template({ ...config, dimensions: {} }, { archetype: 'pivot', defaultRowDim: 'shop', defaultColDim: 'part' });
  assert.deepEqual(doc.hybridConfig.rowAxes.map((a) => a.fieldKey), ['shop']);
  assert.deepEqual(doc.hybridConfig.columnAxes.map((a) => a.fieldKey), ['part']);
  assert.equal(compileCellReport(doc, rows).valid, true);
});
