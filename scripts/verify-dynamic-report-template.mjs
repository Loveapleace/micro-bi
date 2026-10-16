/**
 * Dynamic report acceptance diagnostics (separate from the existing unit suite).
 * Run after npm test: node scripts/verify-dynamic-report-template.mjs
 * A nonzero exit means a required behavior is still missing, not a runner error.
 *
 * Uses installed Univer Sheets/Facade, the real report/compiler/VTable adapters,
 * and the actual data-refresh effect extracted from UniverPreview.tsx by AST.
 * The isolated effect test does NOT mount React, run a browser, or test formula
 * calculation. Main-modal browser evidence is documented separately in doc/.
 */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { Univer, LocaleType } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import enUS from '@univerjs/sheets/locale/en-US';
import '@univerjs/sheets/facade';
import { transformData } from '../dist/esm/engine/index.js';
import {
  buildBiGrid, biGridToUniverWorksheetData, refreshAnalysisRegion,
} from '../dist/esm/report/index.js';
import { compileReport } from '../dist/esm/univer/compileReport.js';
import { BiBindingManager } from '../dist/esm/univer/BiBindingPlugin.js';
import { adaptPublishedSheetToVTable } from '../dist/esm/ui/presentation/report/gridAdapter.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, process.argv[2] || 'doc/verification/dynamic-report-template-2026-10-16.json');
const previewPath = resolve(root, 'src/univer/UniverPreview.tsx');
const source = await readFile(previewPath, 'utf8');
const ast = ts.createSourceFile(previewPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const effects = [];
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') {
    const effect = node.arguments[0];
    if (effect && effect.getText(ast).includes('lastGridRef.current = initialGrid')) effects.push(effect);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(effects.length, 1, 'Refresh implementation changed: adapt this isolated-effect harness; do not silently copy the old algorithm.');
const effectJS = ts.transpile(`const refreshEffect = ${effects[0].getText(ast)}; refreshEffect;`, {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
});

const metrics = [
  { type: 'aggregated', field: 'qty', agg: 'sum', label: '产量' },
  { type: 'aggregated', field: 'qty', agg: 'avg', label: '平均产量' },
];
const grouped = { dimensions: { categories: ['workshop'], rowTotals: { showGrandTotals: true } }, columns: metrics };
const data = [
  { id: 'a1', workshop: 'A', line: 'L1', date: '2026-10-01', qty: 10 },
  { id: 'a2', workshop: 'A', line: 'L2', date: '2026-10-02', qty: 20 },
  { id: 'a3', workshop: 'A', line: 'L1', date: '2026-11-01', qty: 30 },
  { id: 'b1', workshop: 'B', line: 'L1', date: '2026-10-03', qty: 100 },
  { id: 'b2', workshop: 'B', line: 'L2', date: '2026-11-02', qty: 40 },
];
const opts = { analysisId: 'analysis-qa', sheetId: 's1' };
const grid = (config, records) => buildBiGrid(config, records, opts);
const member = (g, name, metricId = 'SUM(qty)', month) => g.bindings.find(b =>
  b.semantic.role === 'metric-value' && b.semantic.metricId === metricId &&
  b.semantic.rowPath.some(p => p.memberKey === name) &&
  (month === undefined || b.semantic.columnPath.some(p => p.memberKey === month)));
const cellValue = (g, b) => g.cells.find(c => c.row === b.target.row && c.col === b.target.column)?.value;
const baseRegion = config => ({ id: opts.analysisId, sheetId: opts.sheetId, anchor: { row: 0, column: 0 }, config });
const pivot = indicatorsAsCol => ({
  dimensions: {
    categories: ['workshop'], columnTimeBucket: { field: 'date', granularity: 'month' },
    indicatorsAsCol, rowTotals: { showGrandTotals: true }, columnTotals: { showGrandTotals: true },
  }, columns: metrics,
});
const results = [];
async function check(id, title, layer, run) {
  try {
    const evidence = await run();
    results.push({ id, title, layer, status: 'passed', evidence });
  } catch (error) {
    results.push({ id, title, layer, status: 'failed', message: error.message,
      ...(error.actual !== undefined ? { actual: error.actual } : {}),
      ...(error.expected !== undefined ? { expected: error.expected } : {}) });
  }
  console.log(`${results.at(-1).status.toUpperCase()} ${id} ${title}`);
}
let counter = 0;
function open(g) {
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: enUS } });
  univer.registerPlugin(UniverSheetsPlugin);
  const api = FUniver.newAPI(univer);
  const sheet = biGridToUniverWorksheetData(g, { sheetId: 's1', name: 'QA' });
  // Keep room for dynamic expansion without involving UI scroll/viewport code.
  sheet.rowCount = Math.max(sheet.rowCount, 100);
  sheet.columnCount = Math.max(sheet.columnCount, 40);
  const workbook = api.createWorkbook({ id: `qa-${++counter}`, name: 'QA', sheetOrder: ['s1'], sheets: { s1: sheet } });
  return { univer, api, workbook, sheet: workbook.getActiveSheet(), close: () => univer.dispose() };
}
function refreshEffect(ctx, oldGrid, newGrid, bindings = oldGrid.bindings, manualOverrides) {
  const scope = vm.createContext({ console, isInitialized: true, univerAPIRef: { current: ctx.api },
    lastGridRef: { current: oldGrid }, initialGrid: newGrid, effectiveBindings: bindings, manualOverrides });
  vm.runInContext(effectJS, scope, { filename: previewPath })();
}
const readAt = (ctx, b) => ctx.sheet.getRange(b.target.row, b.target.column).getValue();
const rawAt = (ctx, b) => ctx.workbook.save().sheets.s1.cellData[b.target.row]?.[b.target.column];

await check('DT-01', '值变化后基础矩阵重新聚合', 'pure-report', () => {
  const changed = data.map(d => ({ ...d, qty: d.qty * 2 }));
  const g = grid(grouped, changed);
  assert.equal(cellValue(g, member(g, 'A')), 120);
  assert.equal(cellValue(g, member(g, 'B')), 280);
  return { A: 120, B: 280 };
});
await check('DT-02', '分组成员重排后语义 ID 不变且坐标更新', 'pure-report', () => {
  const old = grid(grouped, data), next = grid(grouped, [...data].reverse());
  assert.equal(member(old, 'A').id, member(next, 'A').id);
  assert.notEqual(member(old, 'A').target.row, member(next, 'A').target.row);
  return { before: member(old, 'A').target, after: member(next, 'A').target };
});
for (const direction of [true, false]) {
  await check(direction ? 'DT-03' : 'DT-04', `新增十二月透视列（指标${direction ? '横向' : '纵向'}）`, 'pure-report', () => {
    const config = pivot(direction), old = grid(config, data);
    const next = grid(config, [...data, { id: 'a4', workshop: 'A', date: '2026-12-01', qty: 50 }]);
    assert.equal(member(old, 'A', 'SUM(qty)', '2026-10').id, member(next, 'A', 'SUM(qty)', '2026-10').id);
    assert.equal(cellValue(next, member(next, 'A', 'SUM(qty)', '2026-12')), 50);
    assert.ok(next.colCount > old.colCount);
    return { beforeColumns: old.colCount, afterColumns: next.colCount };
  });
}
await check('DT-05', '切换指标横纵方向仍能找到相同业务单元格', 'pure-report', () => {
  const h = member(grid(pivot(true), data), 'A', 'SUM(qty)', '2026-10');
  const v = member(grid(pivot(false), data), 'A', 'SUM(qty)', '2026-10');
  assert.equal(h.id, v.id);
  assert.notDeepEqual(h.target, v.target);
  return { horizontal: h.target, vertical: v.target };
});
await check('DT-06', '同一成员覆盖元数据可迁移到新坐标', 'refresh-metadata', () => {
  const first = refreshAnalysisRegion(baseRegion(grouped), data), a = member(first.newGrid, 'A');
  const next = refreshAnalysisRegion({ ...first.region, manualOverrides: { [a.id]: { v: 999 } } }, [...data].reverse());
  assert.equal(next.region.manualOverrides[a.id].v, 999);
  assert.equal(next.region.bindings.find(b => b.id === a.id).target.row, member(next.newGrid, 'A').target.row);
  return { override: next.region.manualOverrides[a.id], note: 'Metadata only; this API does not write cells.' };
});
await check('DT-07', '明细主键对应编辑身份在重排后保持稳定', 'pure-report', () => {
  const config = { columns: [{ type: 'fixed', field: 'id' }, { type: 'fixed', field: 'qty' }] };
  const old = grid(config, data), next = grid(config, [...data].reverse());
  const oldA = old.bindings.find(b => b.target.row === 1 && b.semantic.field === 'qty');
  const newA = next.bindings.find(b => b.target.row === 5 && b.semantic.field === 'qty');
  assert.equal(newA.id, oldA.id);
});
await check('DT-08', '报表矩阵消费配置中的指标降序排序', 'pure-report', () => {
  const config = { ...grouped, options: { sort: [{ field: 'SUM(qty)', order: 'desc' }] } };
  const sorted = grid(config, data), engine = transformData(data, config);
  assert.equal(engine.data[0].workshop, 'B', 'Existing-engine oracle must sort B first.');
  assert.equal(sorted.cells.find(c => c.row === 1 && c.col === 0).value, engine.data[0].workshop);
});
await check('DT-09', '成员删除后归档编辑，成员重新出现时可恢复', 'refresh-metadata', () => {
  const first = refreshAnalysisRegion(baseRegion(grouped), data), a = member(first.newGrid, 'A');
  const edited = { ...first.region, manualOverrides: { [a.id]: { v: 999 } } };
  const removed = refreshAnalysisRegion(edited, data.filter(d => d.workshop !== 'A'));
  const restored = refreshAnalysisRegion(removed.region, data);
  assert.equal(restored.region.manualOverrides?.[a.id]?.v, 999);
});
await check('DT-10', '源值变更时人工数值覆盖产生冲突诊断', 'refresh-metadata', () => {
  const first = refreshAnalysisRegion(baseRegion(grouped), data), a = member(first.newGrid, 'A');
  const updated = refreshAnalysisRegion({ ...first.region, manualOverrides: { [a.id]: { v: 999 } } },
    data.map(d => d.workshop === 'A' ? { ...d, qty: d.qty * 2 } : d));
  assert.ok(updated.diagnostics.some(d => /CONFLICT|BASE_CHANGED/.test(d.code)), 'Override retained without a base-data conflict diagnostic.');
});
await check('DT-11', '同结构刷新经真实 SDK、编译器、VTable 适配显示新值', 'actual-effect+facade+publication', () => {
  const old = grid(grouped, data), next = grid(grouped, data.map(d => ({ ...d, qty: d.qty * 2 })));
  const ctx = open(old);
  try {
    refreshEffect(ctx, old, next);
    const pub = compileReport(ctx.workbook).publication, a = member(next, 'A');
    const view = adaptPublishedSheetToVTable(pub.sheets[0], pub.styles);
    assert.equal(readAt(ctx, a), 120);
    assert.equal(String(view.records[a.target.row][`col_${a.target.column}`]), '120');
    return { SDK: 120, VTableInput: '120' };
  } finally { ctx.close(); }
});
await check('DT-12', '分组重排后单元格样式跟随成员', 'actual-effect+facade', () => {
  const old = grid(grouped, data), next = grid(grouped, [...data].reverse()), ctx = open(old);
  try {
    const a = member(old, 'A'); ctx.sheet.getRange(a.target.row, a.target.column).setFontWeight('bold');
    const style = rawAt(ctx, a).s;
    refreshEffect(ctx, old, next);
    assert.equal(rawAt(ctx, member(next, 'A')).s, style);
  } finally { ctx.close(); }
});
await check('DT-13', '前插成员后人工值跟随原成员，不污染新成员', 'actual-effect+facade', () => {
  const before = [{ workshop: 'B', qty: 50 }], after = [{ workshop: 'A', qty: 10 }, ...before];
  const old = grid(grouped, before), next = grid(grouped, after), ctx = open(old);
  try {
    const b = member(old, 'B'); ctx.sheet.getRange(b.target.row, b.target.column).setValue(999);
    const edited = old.bindings.map(x => x.id === b.id ? { ...x, state: 'manual-override' } : x);
    refreshEffect(ctx, old, next, edited, { [b.id]: { v: 999 } });
    assert.deepEqual({ A: readAt(ctx, member(next, 'A')), B: readAt(ctx, member(next, 'B')) }, { A: 10, B: 999 });
  } finally { ctx.close(); }
});
await check('DT-14', '删除分组成员后清除旧区域尾部单元格', 'actual-effect+facade+publication', () => {
  const old = grid(grouped, data), next = grid(grouped, data.filter(d => d.workshop === 'A')), ctx = open(old);
  try {
    refreshEffect(ctx, old, next);
    const pub = compileReport(ctx.workbook).publication;
    assert.equal(pub.sheets[0].rowCount, next.rowCount);
  } finally { ctx.close(); }
});
await check('DT-15', '分组结构改变后合并范围与新矩阵一致', 'actual-effect+facade', () => {
  const old = grid(grouped, data);
  const config = { ...grouped, dimensions: { categories: ['workshop', 'line'], rowTotals: { showGrandTotals: true, showSubTotals: true } } };
  const next = grid(config, data), ctx = open(old);
  try {
    refreshEffect(ctx, old, next);
    const actual = ctx.workbook.save().sheets.s1.mergeData;
    const expected = biGridToUniverWorksheetData(next).mergeData;
    assert.deepEqual(actual, expected);
  } finally { ctx.close(); }
});
await check('DT-16', '新增透视成员后原总计列样式仍属于总计', 'actual-effect+facade', () => {
  const config = pivot(true), old = grid(config, data);
  const next = grid(config, [{ workshop: 'A', date: '2026-09-01', qty: 5 }, ...data]), ctx = open(old);
  try {
    const oldCell = old.bindings.find(b => b.semantic.role === 'grand-total' && b.semantic.metricId === 'SUM(qty)' && b.semantic.rowPath.some(p => p.memberKey === 'A'));
    const newCell = next.bindings.find(b => b.id === oldCell.id);
    ctx.sheet.getRange(oldCell.target.row, oldCell.target.column).setFontWeight('bold');
    const style = rawAt(ctx, oldCell).s;
    refreshEffect(ctx, old, next);
    assert.equal(rawAt(ctx, newCell).s, style);
  } finally { ctx.close(); }
});
await check('DT-17', '删除透视月份后清除旧列', 'actual-effect+facade+publication', () => {
  const config = pivot(false), old = grid(config, data);
  const next = grid(config, data.filter(d => d.date.startsWith('2026-10'))), ctx = open(old);
  try {
    refreshEffect(ctx, old, next);
    assert.equal(compileReport(ctx.workbook).publication.sheets[0].colCount, next.colCount);
  } finally { ctx.close(); }
});
await check('DT-18', '监听捕获真实编辑且能排除程序刷新', 'actual-effect+facade+binding-manager', () => {
  const old = grid(grouped, data), next = grid(grouped, data.map(d => ({ ...d, qty: d.qty * 2 }))), ctx = open(old);
  const overrides = [];
  const manager = new BiBindingManager({ bindings: old.bindings, onManualOverride: (...args) => overrides.push(args) });
  try {
    manager.attach(ctx.api);
    const a = member(old, 'A');
    ctx.sheet.getRange(a.target.row, a.target.column).setValue(999);
    // Positive control: zero refresh callbacks proves nothing if the listener is broken.
    assert.equal(overrides.length, 1, 'Real Facade edit must be captured before checking programmatic-write isolation.');
    overrides.length = 0;
    refreshEffect(ctx, old, next);
    assert.equal(overrides.length, 0);
  } finally { manager.dispose(); ctx.close(); }
});
await check('DT-19', '保存的发布模型使用当前值而不是旧 displayText', 'facade+compiler+vtable-adapter', () => {
  const old = grid(grouped, data), a = member(old, 'A'), ctx = open(old);
  try {
    ctx.sheet.getRange(a.target.row, a.target.column).setValue(999);
    const pub = compileReport(ctx.workbook).publication;
    assert.equal(String(adaptPublishedSheetToVTable(pub.sheets[0], pub.styles).records[a.target.row][`col_${a.target.column}`]), '999');
    return { actualFacadeDisplay: '999', note: 'Does not cover React state updates during Save.' };
  } finally { ctx.close(); }
});
await check('DT-20', '工作表快照离线编译也不能回显旧 displayText', 'snapshot+compiler+vtable-adapter', () => {
  const old = grid(grouped, data), a = member(old, 'A'), ctx = open(old);
  try {
    ctx.sheet.getRange(a.target.row, a.target.column).setValue(999);
    const pub = compileReport(ctx.workbook.save()).publication;
    assert.equal(String(adaptPublishedSheetToVTable(pub.sheets[0], pub.styles).records[a.target.row][`col_${a.target.column}`]), '999');
  } finally { ctx.close(); }
});

const report = {
  executedAt: new Date().toISOString(), nodeVersion: process.version,
  scope: 'Pure report + installed headless Univer SDK + actual isolated data-refresh effect + publication/VTable inputs; not a React/browser E2E suite.',
  source: { path: 'src/univer/UniverPreview.tsx', sha256: createHash('sha256').update(source).digest('hex') },
  summary: { total: results.length, passed: results.filter(r => r.status === 'passed').length, failed: results.filter(r => r.status === 'failed').length },
  results,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report.summary));
console.log(`Evidence: ${output}`);
process.exitCode = report.summary.failed ? 1 : 0;
