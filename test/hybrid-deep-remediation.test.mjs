import { setPresentation } from './helpers/presentation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { HybridHistory, isHybridHistoryCommand } from '../dist/esm/cell-designer/hybridHistory.js';
import { attachUniverDesignerEvents } from '../dist/esm/cell-designer/univerEvents.js';
import { compilePanelToCellTemplate } from '../dist/esm/report-template/panelToTemplateAdapter.js';
import { compileCellReport } from '../dist/esm/report-template/compileCellReport.js';
import { expandCellDrivenTemplate } from '../dist/esm/report-template/cellExpansionEngine.js';
import { adaptPublishedSheetToVTable } from '../dist/esm/ui/presentation/report/gridAdapter.js';
import { collectHybridExtras, mergeHybridCells } from '../dist/esm/cell-designer/hybridTemplateState.js';

const facts = [
  { shop: 'A', day: '2026-08-01', qty: 10, defects: 1 },
  { shop: 'A', day: '2026-08-02', qty: 20, defects: 2 },
  { shop: 'B', day: '2026-08-01', qty: 30, defects: 3 },
];
const config = { datasetId: 'orders', dimensions: { categories: ['shop'], columnTimeBucket: { field: 'day', granularity: 'day' } },
  columns: ['qty', 'defects'].map((field) => ({ type: 'aggregated', field, agg: 'sum' })) };
const panel = (options = {}) => compilePanelToCellTemplate(config, 'orders', { showRowTotals: true, ...options });
const clone = structuredClone;
function table(doc, data = facts) {
  const r = compileCellReport(doc, data);
  assert.equal(r.valid, true, JSON.stringify(r.diagnostics));
  return adaptPublishedSheetToVTable(r.publication.sheets[0], r.publication.styles).records;
}

test('H35-01: source history restores text/formula and VTable results, isolated from later object edits', () => {
  const a = panel();
  a.cells.push({ id: 'note', sheetId: 'sheet-1', position: { row: 9, column: 8 }, parents: { row: 'none', column: 'none' }, content: { kind: 'literal', value: 'A' } });
  const b = clone(a); b.cells.at(-1).content = { kind: 'sheet-formula', formula: '=SUM(1,2,3)' };
  let applied;
  const h = new HybridHistory((s) => { applied = s; });
  assert.equal(h.commit(a, b), true);
  b.cells.at(-1).content.formula = '=99';
  h.moveTo(0); assert.ok(JSON.stringify(table(applied)).includes('A'));
  h.moveTo(1); assert.equal(applied.cells.at(-1).content.formula, '=SUM(1,2,3)');
  assert.ok(Object.values(table(applied).at(-1)).includes('6'));
});

test('H35-02: undo/redo restores dimensions, anchor, merge cancellation and conditional format atomically', () => {
  const a = { document: panel(), selectedMeasures: ['qty', 'defects'], anchor: { row: 2, titleRow: 0 } };
  const q = a.document.cells.find((c) => c.id === 'meas-qty');
  q.formatOptions = { precision: 1, suffix: '件' };
  q.style = { fontSize: 18, backgroundColor: '#e6fffb' };
  setPresentation(a.document,q.id,{threshold:15,style:{color:'#FF0000'}});
  const title = a.document.cells.find((c) => c.id === 'title');
  title.staticSpan.merge = false; title.staticSpan.height = 2;
  const b = clone(a); b.anchor.row = 3; b.selectedMeasures = ['qty']; b.document = panel({ anchorRow: 3, titlePosition: { row: 0, column: 0 } });
  let applied;
  const h = new HybridHistory((s) => { applied = s; });
  h.commit(a, b); h.moveTo(0);
  const restored = applied.document.cells.find((c) => c.id === 'meas-qty');
  assert.equal(restored.style.fontSize, 18); assert.equal(applied.document.presentationRules.ruleSets[0].rules[0].predicate.right.value, 15);
  assert.equal(applied.document.cells.find((c) => c.id === 'title').staticSpan.merge, false);
  assert.deepEqual(applied.selectedMeasures, ['qty', 'defects']);
  assert.ok(JSON.stringify(table(applied.document)).includes('10.0件'));
  h.moveTo(1); assert.equal(applied.anchor.row, 3); assert.deepEqual(applied.selectedMeasures, ['qty']);
});

test('H35-03: a new edit after undo clears only the redo branch; unchanged projection preserves it', () => {
  let applied;
  const h = new HybridHistory((s) => { applied = s; });
  h.commit({ value: 'A' }, { value: 'B' }); h.commit({ value: 'B' }, { value: 'C' });
  h.moveTo(1); assert.equal(h.commit(applied, clone(applied)), false); assert.equal(h.count, 2);
  h.commit(applied, { value: 'D' }); assert.equal(h.count, 2);
  h.moveTo(1); h.moveTo(2); assert.equal(applied.value, 'D');
  assert.equal(h.moveTo(3), false);
});

test('H35-04: bounded source history keeps a valid baseline and reset removes old dataset history', () => {
  let applied;
  const h = new HybridHistory((s) => { applied = s; }, 2);
  h.commit({ n: 0 }, { n: 1 }); h.commit({ n: 1 }, { n: 2 }); h.commit({ n: 2 }, { n: 3 });
  assert.equal(h.count, 2); h.moveTo(0); assert.equal(applied.n, 1);
  applied.n = 99; h.moveTo(1); h.moveTo(0); assert.equal(applied.n, 1);
  h.reset(); assert.equal(h.count, 0); assert.equal(h.moveTo(0), false);
});

test('H35-05: user commands are tracked, mutations/selection/copy/program projections are not separate edits', () => {
  for (const id of ['sheet.command.set-range-values', 'sheet.command.set-range-font-size', 'sheet.command.add-worksheet-merge', 'sheet.command.remove-worksheet-merge', 'sheet.command.insert-row-before', 'sheet.command.remove-col', 'sheet.command.paste']) assert.equal(isHybridHistoryCommand(id, 0), true, id);
  for (const [id, type] of [['sheet.mutation.set-range-values', 2], ['sheet.operation.set-selections', 1], ['sheet.command.copy', 0], ['univer.command.undo', 0], ['doc.command.insert-text', 0]]) assert.equal(isHybridHistoryCommand(id, type), false, id);
});

test('H35-06: independent title position survives inserted business rows and JSON save in every archetype', () => {
  for (const dimensions of [config.dimensions, { categories: ['shop'] }, {}]) {
    const doc = compilePanelToCellTemplate({ ...config, dimensions }, 'orders', { anchorRow: 3, titlePosition: { row: 0, column: 1 } });
    const title = doc.cells.find((c) => c.id === 'title');
    assert.deepEqual(title.position, { row: 0, column: 1 });
    assert.equal(doc.regions[0].anchor.row, 3);
    const grid = expandCellDrivenTemplate(clone(doc), facts).grid;
    assert.ok(grid.cells.some((c) => c.row === 0 && c.value === title.content.value));
    table(clone(doc));
  }
});

test('H35-07: default title remains backward compatible, explicit source position permits title below a zero anchor', () => {
  assert.equal(panel().cells.find((c) => c.id === 'title').position.row, 0);
  assert.equal(panel({ anchorRow: 0, includeTitle: false }).cells.some((c) => c.id === 'title'), false);
  const doc = panel({ anchorRow: 0, includeTitle: true, titlePosition: { row: 12, column: 0 } });
  assert.equal(doc.cells.find((c) => c.id === 'title').position.row, 12);
  assert.ok(expandCellDrivenTemplate(doc, facts).grid.cells.some((c) => c.value === doc.title));
});

test('H35-08: temporarily unselected metric retains native style and advanced rules by identity', () => {
  const base = panel();
  const qty = clone(base.cells.find((c) => c.id === 'meas-qty'));
  qty.style = { fontSize: 18, backgroundColor: '#e6fffb' };
  qty.formatOptions = { precision: 1, suffix: '件' };
  setPresentation(base,qty.id,{threshold:15,style:{color:'#FF0000'}});
  const fewer = compilePanelToCellTemplate({ ...config, columns: config.columns.slice(1) }, 'orders');
  const extras = collectHybridExtras(fewer, fewer, [qty], fewer, fewer);
  assert.equal(extras.find((c) => c.id === qty.id).style.fontSize, 18);
  const saved = clone({ ...fewer, presentationRules: base.presentationRules, hybridConfig: { ...fewer.hybridConfig, retainedCells: extras } });
  const restored = { ...base, presentationRules: saved.presentationRules, cells: mergeHybridCells(base, saved.hybridConfig.retainedCells) };
  assert.equal(restored.presentationRules.ruleSets[0].target.cellId, qty.id);
  assert.ok(JSON.stringify(table(restored)).includes('10.0件'));
  assert.equal(restored.cells.find((c) => c.id === 'meas-defects').formatOptions?.suffix, undefined);
});

test('H35-09: Excel cancellation keeps first label only and does not change business values or reenable merging', () => {
  const doc = panel({ enableGroupMerge: false });
  const before = expandCellDrivenTemplate(doc, facts).grid;
  assert.equal(doc.hybridConfig.enableGroupMerge, false);
  assert.equal(doc.mergeConfig.policies.some((p) => p.kind === 'group-span' && p.enabled), false);
  assert.equal(before.cells.filter((c) => c.value === 'A').length, 1);
  const roundTrip = clone(doc);
  assert.deepEqual(table(roundTrip), table(doc));
  const quantity = (grid) => grid.cells.filter((c) => c.metricId === 'metric-qty').reduce((sum, c) => sum + c.value, 0);
  assert.equal(quantity(before), 60);
  assert.equal(quantity(expandCellDrivenTemplate(roundTrip, facts).grid), 60);
});

test('H35-10: structural wrappers do not duplicate a physical mutation or invent a row-zero deletion', () => {
  const listeners = new Map(), removed = [], inserted = [];
  const api = { Event: { CommandExecuted: 'command' }, addEvent: (name, listener) => {
    listeners.set(name, listener); return { dispose: () => listeners.delete(name) };
  } };
  const dispose = attachUniverDesignerEvents(api, { onRowsRemoved: (e) => removed.push(e), onColumnsInserted: (e) => inserted.push(e) });
  const emit = (id, params) => listeners.get('command')({ id, params });
  const params = { subUnitId: 'sheet-1', range: { startRow: 2, endRow: 2 } };
  emit('sheet.command.remove-row-confirm', undefined);
  emit('sheet.command.remove-row-by-range', params);
  emit('sheet.mutation.remove-rows', params);
  emit('sheet.command.remove-row', params);
  assert.deepEqual(removed, [{ sheetId: 'sheet-1', startIndex: 2, count: 1 }]);
  emit('sheet.mutation.remove-rows', params);
  assert.equal(removed.length, 2, 'two real edits within 150ms must both be kept');
  api.__biSourceHistoryReplay = true;
  emit('sheet.mutation.remove-rows', params);
  api.__biSourceHistoryReplay = false;
  api.__isProgrammaticWrite = true;
  emit('sheet.mutation.remove-rows', params);
  api.__isProgrammaticWrite = false;
  assert.equal(removed.length, 2);
  emit('sheet.mutation.insert-col', { subUnitId: 'sheet-2', range: { startColumn: 4, endColumn: 5 } });
  assert.deepEqual(inserted, [{ sheetId: 'sheet-2', startIndex: 4, count: 2 }]);
  dispose(); assert.equal(listeners.size, 0);
});
