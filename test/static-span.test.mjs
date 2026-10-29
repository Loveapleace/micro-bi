import { setPresentation } from './helpers/presentation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePanelToCellTemplate } from '../dist/esm/report-template/panelToTemplateAdapter.js';
import { expandCellDrivenTemplate } from '../dist/esm/report-template/cellExpansionEngine.js';
import { compileCellReport } from '../dist/esm/report-template/compileCellReport.js';
import { addStaticSpanDesignMerges } from '../dist/esm/report-template/staticSpans.js';
import { captureHybridPreviewMerges } from '../dist/esm/cell-designer/hybridMergeState.js';
import { syncDocumentFromWorkbookSnapshot } from '../dist/esm/cell-designer/syncWorkbookToTemplate.js';
import { adaptPublishedSheetToVTable } from '../dist/esm/ui/presentation/report/gridAdapter.js';
import { collectHybridExtras, mergeHybridCells, preserveHybridDocumentMetadata } from '../dist/esm/cell-designer/hybridTemplateState.js';

const facts = [
  { id: 1, shop: 'A', date: '2026-08-01', part: 'X', qty: 10, defects: 1 },
  { id: 2, shop: 'A', date: '2026-08-02', part: 'Y', qty: 20, defects: 2 },
  { id: 3, shop: 'B', date: '2026-09-01', part: 'X', qty: 30, defects: 3 },
];
const config = { datasetId: 'orders', headers: { shop: '车间', date: '投产月', part: '产品', qty: '交付', defects: '缺陷' },
  dimensions: { categories: ['shop'], columnTimeBucket: { field: 'date', granularity: 'month' }, columnCategories: ['part'] },
  columns: ['qty', 'defects'].map((field) => ({ type: 'aggregated', field, agg: 'sum' })) };
const template = (options = {}) => compilePanelToCellTemplate(config, 'orders', { includeTitle: false, showRowTotals: true, ...options });
const clone = (v) => JSON.parse(JSON.stringify(v));
function caption(doc, overrides = {}, position = { row: 12, column: 10 }, value = '动态范围说明') {
  const cell = { id: `caption-${doc.cells.length}`, sheetId: 'sheet-1', regionId: 'region-1', position,
    content: { kind: 'literal', value }, parents: { row: 'none', column: 'none' }, style: { bold: true, color: '#0066aa', textAlign: 'center', verticalAlign: 'middle' },
    staticSpan: { id: `span-${doc.cells.length}`, enabled: true, regionId: 'region-1', scope: 'report', placement: 'template', repeat: 'once',
      rowOffset: 0, height: 1, includeTotals: true, merge: true, suppressions: [], ...overrides } };
  doc.cells.push(cell);
  return cell;
}
const qty = (grid) => grid.cells.filter((c) => c.metricId === 'metric-qty').reduce((sum, c) => sum + c.value, 0);
const error = (diags) => diags.filter((d) => d.severity === 'error');
const rawMerge = (m) => ({ startRow: m.startRow, endRow: m.endRow, startColumn: m.startCol, endColumn: m.endCol });
const key = (m) => `${m.startRow}:${m.endRow}:${m.startCol}:${m.endCol}`;
const snapshot = (grid, exclude = [], extra = []) => ({ sheets: { 'sheet-1': { cellData: {}, mergeData: [...grid.merges.filter((m) => !exclude.includes(key(m))).map(rawMerge), ...extra.map(rawMerge)] } } });

test('SS-01 arbitrary template rows use the same region width and retain source definitions', () => {
  for (const row of [0, 1, 10, 18]) {
    const doc = template(); const cell = caption(doc, {}, { row, column: 10 }); const before = structuredClone(doc);
    const result = expandCellDrivenTemplate(doc, facts);
    assert.deepEqual(error(result.diagnostics), []);
    assert.deepEqual(doc, before);
    const instance = result.grid.staticSpanInstances.find((s) => s.templateCellId === cell.id);
    assert.equal(instance.range.startCol, 0);
    assert.equal(instance.range.endCol, 5);
    assert.equal(result.grid.cells.filter((c) => c.value === cell.content.value).length, 1);
    assert.equal(qty(result.grid), 60);
  }
});

test('SS-02 dynamic-only range excludes left labels and optional trailing total', () => {
  const doc = template(); const cell = caption(doc, { scope: 'columns', includeTotals: false }, { row: 1, column: 8 });
  const result = compileCellReport(doc, facts);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  const grid = expandCellDrivenTemplate(doc, facts).grid;
  const range = grid.staticSpanInstances[0].range;
  assert.equal(range.startCol, 2); assert.equal(range.endCol, 4);
  const sheet = result.publication.sheets[0];
  const text = sheet.cells.find((c) => c.v === cell.content.value);
  assert.equal(result.publication.styles[text.styleId].align, 'center');
  const table = adaptPublishedSheetToVTable(sheet, result.publication.styles);
  assert.ok(table.customMergeCell.some((m) => m.text === cell.content.value && m.range.start.col === 2 && m.range.end.col === 4));
});

test('SS-03 including totals does not create a phantom column when totals are disabled', () => {
  const doc = template({ showRowTotals: false }); caption(doc, { placement: 'before-region' });
  const result = expandCellDrivenTemplate(doc, facts);
  assert.equal(result.grid.staticSpanInstances[0].range.endCol, 4);
  assert.deepEqual(error(result.diagnostics), []);
});

test('SS-04 before-region and after-region anchors follow actual data boundaries', () => {
  const doc = template(); caption(doc, { placement: 'before-region' }, { row: 14, column: 12 }, '区域前说明');
  caption(doc, { placement: 'after-region' }, { row: 20, column: 12 }, '区域后说明');
  const grid = expandCellDrivenTemplate(doc, facts).grid;
  const before = grid.cells.find((c) => c.value === '区域前说明');
  const after = grid.cells.find((c) => c.value === '区域后说明');
  assert.equal(before.row, 1);
  assert.equal(after.row, Math.max(...grid.cells.filter((c) => c.metricId).map((c) => c.row)) + 1);
});

test('SS-05 row-group prefixes reserve bands without losing business values', () => {
  const doc = template(); const cell = caption(doc, { repeat: 'row-groups', rowParentId: 'cell-row-shop', placement: 'before-group' });
  const result = expandCellDrivenTemplate(doc, facts);
  assert.deepEqual(error(result.diagnostics), []);
  assert.equal(qty(result.grid), 60);
  const labels = result.grid.cells.filter((c) => c.value === cell.content.value);
  assert.deepEqual(labels.map((c) => c.row), [4, 7]);
  assert.equal(result.grid.staticSpanInstances.length, 2);
  assert.ok(result.grid.cells.filter((c) => c.metricId).every((c) => !labels.some((l) => l.row === c.row)));
});

test('SS-06 group footers remain after their own group as membership changes', () => {
  const doc = template(); const cell = caption(doc, { repeat: 'row-groups', rowParentId: 'cell-row-shop', placement: 'after-group' });
  for (const rows of [facts, [...facts, { ...facts[0], id: 4, shop: 'C', qty: 7 }]]) {
    const result = expandCellDrivenTemplate(doc, rows);
    assert.deepEqual(error(result.diagnostics), []);
    assert.equal(result.grid.cells.filter((c) => c.value === cell.content.value).length, new Set(rows.map((r) => r.shop)).size);
    assert.equal(qty(result.grid), rows.reduce((s, r) => s + r.qty, 0));
  }
});

test('SS-07 middle-of-group captions split generated label coverage rather than covering data', () => {
  const doc = template(); caption(doc, { repeat: 'row-groups', rowParentId: 'cell-row-shop' }, { row: 5, column: 10 });
  const result = expandCellDrivenTemplate(doc, facts);
  assert.deepEqual(error(result.diagnostics), []);
  assert.equal(qty(result.grid), 60);
  assert.equal(result.grid.cells.filter((c) => c.value === '动态范围说明').length, 2);
  for (const instance of result.grid.staticSpanInstances) assert.ok(!result.grid.merges.some((m) => key(m) !== key(instance.range) && m.startRow <= instance.range.endRow && m.endRow >= instance.range.startRow && m.startCol <= instance.range.endCol && m.endCol >= instance.range.startCol));
});

test('SS-08 multi-row static areas reserve their full height', () => {
  const doc = template(); caption(doc, { height: 2, repeat: 'row-groups', rowParentId: 'cell-row-shop', placement: 'before-group' });
  const result = expandCellDrivenTemplate(doc, facts);
  assert.deepEqual(error(result.diagnostics), []);
  assert.ok(result.grid.staticSpanInstances.every((s) => s.range.endRow - s.range.startRow === 1));
  assert.equal(qty(result.grid), 60);
});

test('SS-09 an anchor at the first business row inserts space, independent of absolute row number', () => {
  const doc = template({ anchorRow: 0 }); caption(doc, { placement: 'before-region' });
  const result = expandCellDrivenTemplate(doc, facts);
  assert.deepEqual(error(result.diagnostics), []);
  assert.equal(result.grid.staticSpanInstances[0].range.startRow, 0);
  assert.ok(result.grid.cells.filter((c) => c.metricId).every((c) => c.row > 0));
});

test('SS-10 insert/delete/reorder facts recomputes width and stable caption instance identities', () => {
  const doc = template(); caption(doc, { placement: 'after-region', includeTotals: false });
  const variants = [facts, [...facts].reverse(), [...facts, { ...facts[0], id: 4, date: '2026-10-01', part: 'Z', qty: 7 }], facts.filter((r) => r.part === 'X')];
  const keys = [];
  for (const rows of variants) {
    const result = compileCellReport(clone(doc), rows);
    assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
    const grid = expandCellDrivenTemplate(doc, rows).grid;
    const instance = grid.staticSpanInstances[0]; keys.push(instance.instanceKey);
    assert.equal(instance.range.endCol, Math.max(...grid.cells.filter((c) => c.metricId === 'metric-qty').map((c) => c.col)));
    assert.equal(qty(grid), rows.reduce((s, r) => s + r.qty, 0));
  }
  assert.equal(new Set(keys).size, 1);
});

test('SS-11 empty data uses a minimal prototype range without a negative merge', () => {
  const doc = template(); caption(doc, { placement: 'after-region' });
  const result = compileCellReport(doc, []);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.ok(result.publication.sheets[0].merges.every((m) => m.startCol <= m.endCol && m.startRow <= m.endRow));
});

test('SS-12 unrelated far-right notes do not stretch the target report range', () => {
  const doc = template(); caption(doc, {}, { row: 0, column: 20 });
  doc.cells.push({ id: 'unrelated', sheetId: 'sheet-1', regionId: 'region-1', position: { row: 1, column: 40 }, parents: { row: 'none', column: 'none' }, content: { kind: 'literal', value: '区域外备注' } });
  const result = expandCellDrivenTemplate(doc, facts);
  assert.equal(result.grid.staticSpanInstances[0].range.endCol, 5);
  assert.ok(result.grid.cells.some((c) => c.value === '区域外备注'));
});

test('SS-13 local native unmerge keeps the full group identity after data additions and JSON save', () => {
  const doc = template(); const c = caption(doc, { repeat: 'row-groups', rowParentId: 'cell-row-shop', placement: 'before-group' });
  const grid = expandCellDrivenTemplate(doc, facts).grid;
  const target = grid.staticSpanInstances[0];
  const saved = clone(captureHybridPreviewMerges(doc, snapshot(grid, [key(target.range)]), grid));
  const rule = saved.cells.find((x) => x.id === c.id).staticSpan;
  assert.equal(rule.enabled, true); assert.equal(rule.merge, true); assert.ok(rule.suppressions.includes(target.instanceKey));
  const next = expandCellDrivenTemplate(saved, [...facts, { ...facts[0], id: 4, shop: 'C', qty: 7 }].reverse()).grid;
  assert.equal(next.staticSpanInstances.find((i) => i.instanceKey === target.instanceKey).merged, false);
  assert.equal(next.staticSpanInstances.filter((i) => i.merged).length, 2);
});

test('SS-14 cancelling a once-only caption disables merging but retains placement and text', () => {
  const doc = template(); const c = caption(doc, { placement: 'before-region' });
  const grid = expandCellDrivenTemplate(doc, facts).grid;
  const target = grid.staticSpanInstances[0];
  const saved = clone(captureHybridPreviewMerges(doc, snapshot(grid, [key(target.range)]), grid));
  const rule = saved.cells.find((x) => x.id === c.id).staticSpan;
  assert.equal(rule.enabled, true); assert.equal(rule.merge, false); assert.equal(rule.placement, 'before-region');
  const next = expandCellDrivenTemplate(saved, [...facts, { ...facts[0], id: 4, part: 'Z', qty: 7 }]).grid;
  assert.equal(next.staticSpanInstances[0].merged, false);
  assert.ok(next.cells.some((x) => x.value === c.content.value));
});

test('SS-15 explicit native remerge reactivates the source rule without storing a projected range', () => {
  const doc = template(); const c = caption(doc, { placement: 'before-region', merge: false });
  const grid = expandCellDrivenTemplate(doc, facts).grid;
  const saved = captureHybridPreviewMerges(doc, snapshot(grid, [], [grid.staticSpanInstances[0].range]), grid);
  assert.equal(saved.cells.find((x) => x.id === c.id).staticSpan.merge, true);
  assert.equal(saved.layoutRules.filter((r) => r.kind === 'merge').length, 0);
});

test('SS-16 unedited preview and design snapshots do not materialize generated caption merges', () => {
  const doc = template(); caption(doc, { placement: 'before-region' });
  const grid = expandCellDrivenTemplate(doc, facts).grid;
  const saved = syncDocumentFromWorkbookSnapshot(doc, snapshot(grid), 'preview', grid);
  assert.equal(saved.layoutRules.filter((r) => r.kind === 'merge').length, 0);
  const source = doc.cells.find((c) => c.staticSpan);
  source.staticSpan.templateRange = { startRow: 12, endRow: 12, startColumn: 10, endColumn: 12 };
  const design = addStaticSpanDesignMerges(doc, { type: 'detail', rowCount: 25, colCount: 15, cells: [], merges: [], bindings: [] });
  const designSaved = syncDocumentFromWorkbookSnapshot(doc, snapshot(design), 'design', design);
  assert.equal(designSaved.layoutRules.filter((r) => r.kind === 'merge').length, 0);
});

test('SS-17 native design cancellation retains the source static area and rule', () => {
  const doc = template(); const c = caption(doc, { height: 2, templateRange: { startRow: 12, endRow: 13, startColumn: 10, endColumn: 12 } });
  const grid = addStaticSpanDesignMerges(doc, { type: 'detail', rowCount: 25, colCount: 15, cells: [], merges: [], bindings: [] });
  const saved = syncDocumentFromWorkbookSnapshot(doc, snapshot(grid, [key(grid.staticSpanInstances[0].range)]), 'design', grid);
  assert.equal(saved.cells.find((x) => x.id === c.id).staticSpan.merge, false);
  assert.equal(saved.cells.find((x) => x.id === c.id).staticSpan.height, 2);
});

test('SS-18 other static content and manual merge conflicts block publication without deleting source data', () => {
  for (const manual of [false, true, 'formatted-empty']) {
    const doc = template(); caption(doc, { placement: 'before-region' });
    if (manual === true) doc.layoutRules.push({ id: 'other-merge', kind: 'merge', sheetId: 'sheet-1', range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 3 } });
    else doc.cells.push({ id: 'other', sheetId: 'sheet-1', position: { row: 1, column: 1 }, regionId: 'region-1', content: { kind: 'literal', value: manual === 'formatted-empty' ? null : '必须保留' },
      formatOptions: manual === 'formatted-empty' ? { emptyDisplay: '必须保留' } : undefined, parents: { row: 'none', column: 'none' } });
    const before = structuredClone(doc);
    const result = compileCellReport(doc, facts);
    assert.equal(result.valid, false);
    assert.ok(result.diagnostics.some((d) => d.code.includes('COLLISION')));
    assert.deepEqual(doc, before);
  }
});

test('SS-19 overlapping span rules and invalid parent/target combinations are diagnosed', () => {
  const doc = template(); caption(doc, { placement: 'before-region' }); caption(doc, { placement: 'before-region' }, { row: 14, column: 10 });
  assert.equal(compileCellReport(doc, facts).valid, false);
  const invalid = template(); caption(invalid, { repeat: 'row-groups', rowParentId: 'missing' });
  assert.ok(compileCellReport(invalid, facts).diagnostics.some((d) => d.code === 'ERR_STATIC_SPAN_CONFIG'));
});

test('SS-20 column group captions follow each parent footprint and retain a local cancellation', () => {
  const doc = template(); caption(doc, { scope: 'column-group', repeat: 'column-groups', columnParentId: 'cell-col-date', includeTotals: false, placement: 'before-region' });
  const grid = expandCellDrivenTemplate(doc, facts).grid;
  assert.equal(grid.staticSpanInstances.length, 2);
  assert.deepEqual(grid.staticSpanInstances.map((i) => [i.range.startCol, i.range.endCol]), [[2, 3], [4, 4]]);
  const target = grid.staticSpanInstances[0];
  const saved = clone(captureHybridPreviewMerges(doc, snapshot(grid, [key(target.range)]), grid));
  const next = expandCellDrivenTemplate(saved, [...facts, { ...facts[0], id: 4, date: '2026-10-01', part: 'Z' }, { ...facts[0], id: 5, date: '2026-10-02', part: 'W' }]).grid;
  assert.equal(next.staticSpanInstances.find((i) => i.instanceKey === target.instanceKey).merged, false);
  assert.equal(next.staticSpanInstances.length, 3);
});

test('SS-21 other side-by-side regions are isolated from reserved caption bands', () => {
  const doc = template();
  const second = template({ anchorCol: 10 });
  doc.regions.push({ ...second.regions[0], id: 'region-2' });
  for (const cell of second.cells) doc.cells.push({ ...cell, id: `r2-${cell.id}`, regionId: 'region-2',
    parents: { row: second.cells.some((c) => c.id === cell.parents.row) ? `r2-${cell.parents.row}` : cell.parents.row,
      column: second.cells.some((c) => c.id === cell.parents.column) ? `r2-${cell.parents.column}` : cell.parents.column } });
  const plain = expandCellDrivenTemplate(doc, facts).grid;
  const before = plain.bindings.filter((b) => b.regionId === 'region-2').map((b) => [b.target.row, b.target.column]);
  caption(doc, { repeat: 'row-groups', rowParentId: 'cell-row-shop', placement: 'before-group' });
  const next = expandCellDrivenTemplate(doc, facts);
  assert.deepEqual(error(next.diagnostics), []);
  assert.deepEqual(next.grid.bindings.filter((b) => b.regionId === 'region-2').map((b) => [b.target.row, b.target.column]), before);
});

test('SS-22 legacy projector keeps data semantics while applying a once-only static span', () => {
  const doc = template(); doc.schemaVersion = '1.0'; doc.capabilitiesVersion = 'cell-v1';
  doc.regions[0].layoutKind = 'pivot'; doc.regions[0].metricDirection = 'rows'; delete doc.hybridConfig;
  caption(doc, { placement: 'after-region', scope: 'columns', includeTotals: false });
  const result = compileCellReport(doc, facts);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(result.publication.sheets[0].cells.filter((c) => c.v === '动态范围说明').length, 1);
});

test('SS-23 new system titles are presets of the general span model', () => {
  const doc = compilePanelToCellTemplate(config, 'orders', { showRowTotals: true });
  const title = doc.cells.find((c) => c.id === 'title');
  assert.ok(title.staticSpan.enabled);
  const before = structuredClone(doc);
  for (const rows of [facts, [...facts, { ...facts[0], id: 4, date: '2026-10-01', part: 'Z' }]]) {
    const result = compileCellReport(doc, rows);
    assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  }
  assert.deepEqual(doc, before);
});

test('SS-24 an unedited span-only merge must not disable unrelated group policies', () => {
  const cfg = { ...config, dimensions: { categories: ['shop', 'part'], columnTimeBucket: config.dimensions.columnTimeBucket }, columns: [config.columns[0]] };
  const doc = compilePanelToCellTemplate(cfg, 'orders');
  const grid = expandCellDrivenTemplate(doc, facts.slice(0, 1)).grid;
  const saved = syncDocumentFromWorkbookSnapshot(doc, snapshot(grid), 'preview', grid);
  assert.ok(saved.mergeConfig.policies.every((p) => p.enabled));
  assert.ok(expandCellDrivenTemplate(saved, facts.slice(0, 2)).grid.mergeOrigins.some((o) => o.origin === 'group-span' && o.targetCellId === 'cell-row-shop'));
});

test('SS-25 automatic labels update with fields, explicitly edited text retains its value', () => {
  const original = template();
  const next = compilePanelToCellTemplate({ ...config, dimensions: { categories: ['part'], columnTimeBucket: config.dimensions.columnTimeBucket } }, 'orders', { includeTitle: false });
  const extras = collectHybridExtras(original, original, [], next, original);
  const merged = mergeHybridCells(next, extras, original.cells);
  assert.equal(merged.find((c) => c.id === 'hdr-row-name').content.value, '产品');
  const titleDoc = compilePanelToCellTemplate(config, 'orders');
  const title = titleDoc.cells.find((c) => c.id === 'title');
  const edited = { ...title, literalOverride: true, content: { kind: 'literal', value: '用户自定义标题' } };
  assert.equal(mergeHybridCells(titleDoc, [edited]).find((c) => c.id === 'title').content.value, '用户自定义标题');
});

test('SS-26 regrouping/axis insertion rebinds caption parents and keeps explicit rule identity', () => {
  const old = compilePanelToCellTemplate({ ...config, dimensions: { categories: ['shop', 'part'] } }, 'orders', { includeTitle: false });
  const c = caption(old, { repeat: 'row-groups', rowParentId: 'cell-sec-part', placement: 'after-group' });
  const next = compilePanelToCellTemplate({ ...config, dimensions: { categories: ['shop', 'part'], columnTimeBucket: config.dimensions.columnTimeBucket } }, 'orders', { includeTitle: false });
  const combined = { ...next, cells: mergeHybridCells(next, [c], old.cells) };
  const moved = combined.cells.find((x) => x.id === c.id);
  assert.equal(moved.staticSpan.rowParentId, 'cell-row-part');
  assert.equal(moved.staticSpan.id, c.staticSpan.id);
  assert.equal(compileCellReport(combined, facts).valid, true);
});

test('SS-27 unmerged static areas retain logical extent and source row heights in publication', () => {
  const doc = template(); const c = caption(doc, { height: 2, merge: false, placement: 'after-region' });
  doc.layoutRules.push({ id: 'caption-height', sheetId: 'sheet-1', kind: 'row-height', index: c.position.row, size: 44 });
  const result = compileCellReport(doc, facts);
  assert.equal(result.valid, true);
  const sheet = result.publication.sheets[0];
  const text = sheet.cells.find((x) => x.v === c.content.value);
  assert.ok(sheet.rowCount >= text.r + 2);
  assert.equal(sheet.rowHeights[text.r], 44);
  assert.ok(!sheet.merges.some((m) => m.startRow === text.r));
});

test('SS-29 same-looking typed group members have distinct cancellation identities', () => {
  const doc = template(); caption(doc, { repeat: 'row-groups', rowParentId: 'cell-row-shop', placement: 'before-group' });
  const rows = [{ ...facts[0], shop: 1 }, { ...facts[1], shop: '1' }];
  const grid = expandCellDrivenTemplate(doc, rows).grid;
  assert.equal(grid.staticSpanInstances.length, 2);
  assert.equal(new Set(grid.staticSpanInstances.map((i) => i.instanceKey)).size, 2);
  const saved = captureHybridPreviewMerges(doc, snapshot(grid, [key(grid.staticSpanInstances[0].range)]), grid);
  const next = expandCellDrivenTemplate(clone(saved), [...rows].reverse()).grid;
  assert.equal(next.staticSpanInstances.filter((i) => i.merged).length, 1);
});

test('SS-30 different column widths and caption styles are preserved in VTable configuration', () => {
  const doc = template(); const c = caption(doc, { scope: 'columns', includeTotals: false, placement: 'before-region' });
  c.style = { ...c.style, fontFamily: 'Arial', fontSize: 18, italic: true, backgroundColor: '#eef4ff', wrapText: true, border: { top: {style:'thin',color:'#335577'}, bottom: {style:'medium',color:'#335577'} } };
  doc.layoutRules = doc.layoutRules.filter((r) => r.kind !== 'column-width');
  for (const [index, size] of [[2, 97], [3, 153], [4, 71]]) doc.layoutRules.push({ id: `width-${index}`, sheetId: 'sheet-1', kind: 'column-width', index, size });
  const result = compileCellReport(doc, facts); assert.equal(result.valid, true);
  const table = adaptPublishedSheetToVTable(result.publication.sheets[0], result.publication.styles);
  const merge = table.customMergeCell.find((m) => m.text === c.content.value);
  assert.equal(merge.style.textAlign, 'center'); assert.equal(merge.style.fontSize, 18);
  assert.equal(merge.style.bgColor, '#eef4ff'); assert.deepEqual(merge.style.borderColor, ['#335577','#000000','#335577','#000000']);assert.deepEqual(merge.style.borderLineWidth,[1,0,2,0]);
  assert.equal([2, 3, 4].reduce((n, i) => n + table.columns[i].width, 0), 321);
});

test('SS-31 migrating a disabled legacy title merge does not reactivate merging', () => {
  const old = compilePanelToCellTemplate(config, 'orders');
  delete old.cells.find((c) => c.id === 'title').staticSpan;
  old.layoutRules = old.layoutRules.filter((r) => r.id !== 'merge-title');
  old.hybridConfig.disabledLayoutRuleIds = ['merge-title'];
  const current = compilePanelToCellTemplate(config, 'orders');
  const extras = collectHybridExtras(old, current, [], current);
  const restored = { ...current, cells: mergeHybridCells(current, extras) };
  assert.equal(restored.cells.find((c) => c.id === 'title').staticSpan.merge, false);
  const grid = expandCellDrivenTemplate(restored, facts).grid;
  assert.ok(!grid.mergeOrigins.some((m) => m.origin === 'static-span' && m.targetCellId === 'title'));
});

test('SS-32 static numeric formats and toolbar styles remain identical when following is enabled', () => {
  const doc = template(); const c = caption(doc, { placement: 'after-region' });
  c.content.value = 12345.5;
  c.formatOptions = { format: 'number', precision: 1, scale: 1000, prefix: '约', suffix: '千元' };
  doc.styleRules.push({id:'static-toolbar',sheetId:c.sheetId,scope:'template-cell',targetId:c.id,priority:0,style:{color:'#CC0011'}});
  const fixed = clone(doc); delete fixed.cells.find((x) => x.id === c.id).staticSpan;
  const expected = expandCellDrivenTemplate(fixed, facts).grid.cells.find((x) => x.value === 12345.5);
  const result = expandCellDrivenTemplate(doc, facts);
  const text = result.grid.cells.find((x) => x.value === 12345.5);
  assert.equal(text.displayText, expected.displayText); assert.equal(text.displayText, '约12.3千元');
  assert.equal(text.style.color, expected.style.color); assert.equal(text.style.color, '#CC0011');
  assert.ok(result.grid.cells.every((x) => x.row >= 0));
  assert.ok(result.grid.bindings.every((b) => b.target.row >= 0));
});

test('SS-33 pending advanced changes and newly created captions win over an older painted snapshot', () => {
  const panel = template(); const painted = clone(panel); const c = caption(painted, { merge: false });
  const pending = { ...clone(c), staticSpan: { ...clone(c.staticSpan), merge: true }, content: { kind: 'literal', value: '新设置文字' }, style: { color: '#ffaa00' } };
  let extras = collectHybridExtras(painted, panel, [pending], panel, painted);
  assert.equal(extras.find((x) => x.id === c.id).staticSpan.merge, true);
  assert.equal(extras.find((x) => x.id === c.id).content.value, '新设置文字');
  assert.equal(extras.find((x) => x.id === c.id).style.color, '#ffaa00');
  const native = clone(painted); native.cells.find((x) => x.id === c.id).content.value = '画布新输入';
  extras = collectHybridExtras(native, panel, [pending], panel, painted);
  assert.equal(extras.find((x) => x.id === c.id).content.value, '画布新输入');
  const fresh = { ...clone(pending), id: 'not-painted-yet' };
  extras = collectHybridExtras(panel, panel, [fresh], panel, panel);
  assert.ok(extras.some((x) => x.id === fresh.id));
});

test('SS-34 fixed mode on a new title must not fall back to the legacy title auto-width special case', () => {
  const doc = compilePanelToCellTemplate(config, 'orders', { showRowTotals: true });
  const title = doc.cells.find((c) => c.id === 'title'); title.staticSpan.enabled = false;
  const fixed = doc.layoutRules.find((r) => r.id === 'merge-title').range;
  const grid = expandCellDrivenTemplate(doc, [...facts, { ...facts[0], id: 4, date: '2026-10-01', part: 'Z' }]).grid;
  const merge = grid.mergeOrigins.find((o) => o.ruleId === 'merge-title');
  assert.equal(merge.range.endCol, fixed.endColumn);
});

test('SS-35 rebuilding a hybrid panel preserves global styles, conditions and existing overrides', () => {
  const original = template(); const c = caption(original, { placement: 'after-region' });
  const before = expandCellDrivenTemplate(original, facts).grid;
  const binding = before.bindings.find((b) => b.semantic.metricId === 'metric-qty');
  original.instanceOverrides = [{ instanceKey: binding.instanceKey, templateCellId: binding.templateCellId, originalBaseValue: 10, overrideValue: 99, source: 'user', dataRevision: 1, status: 'active' }];
  original.styleRules = [{ id: 'caption-global-style', sheetId: 'sheet-1', scope: 'template-cell', targetId: c.id, style: { color: '#aabbcc' }, priority: 1 }];
  setPresentation(original,'meas-qty',{operator:'gt',threshold:50,style:{color:'#DD0011'}});
  const panel = template();
  const rebuilt = preserveHybridDocumentMetadata({ ...panel, cells: mergeHybridCells(panel, [c]) }, original);
  assert.deepEqual(rebuilt.instanceOverrides, original.instanceOverrides);
  const result = compileCellReport(clone(rebuilt), facts); assert.equal(result.valid, true);
  const grid = expandCellDrivenTemplate(rebuilt, facts).grid;
  assert.ok(grid.cells.some((x) => x.metricId === 'metric-qty' && x.value === 99 && x.style.color === '#DD0011'));
  assert.equal(grid.cells.find((x) => x.value === c.content.value).style.color, '#AABBCC');
});
