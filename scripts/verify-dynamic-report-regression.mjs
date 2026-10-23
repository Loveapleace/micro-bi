/**
 * Follow-up acceptance diagnostics, 2026-10-19.
 * Run after npm test: node scripts/verify-dynamic-report-regression.mjs
 * Keeps the earlier 20-case baseline unchanged. Uses real installed SDK APIs,
 * production compilers/adapters and AST-extracted production React effects.
 * This is NOT a mounted React or browser E2E test. No formula engine is loaded.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
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
import { buildBiGrid, biGridToUniverWorksheetData, refreshAnalysisRegion } from '../dist/esm/report/index.js';
import { transformData } from '../dist/esm/engine/index.js';
import { compileReport } from '../dist/esm/univer/compileReport.js';
import { BiBindingManager } from '../dist/esm/univer/BiBindingPlugin.js';
import { adaptPublishedSheetToVTable } from '../dist/esm/ui/presentation/report/gridAdapter.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, process.argv[2] || 'doc/verification/dynamic-report-regression-2026-10-19.json');
const source = await readFile(resolve(root, 'src/univer/UniverPreview.tsx'), 'utf8');
const ast = ts.createSourceFile('UniverPreview.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const arrows = [];
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]) arrows.push(node.arguments[0].getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
function effectContaining(text) {
  const matches = arrows.filter(a => a.includes(text));
  assert.equal(matches.length, 1, `Update diagnostic entry point after implementation changes: ${text}`);
  return ts.transpile(`(${matches[0]});`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
}
const refreshCode = effectContaining('lastGridRef.current = initialGrid');
const bindingCode = effectContaining('bindingManagerRef.current.setBindings');

const options = { analysisId: 'analysis-qa', sheetId: 's1' };
const metrics = [{ type: 'aggregated', field: 'qty', agg: 'sum' }, { type: 'aggregated', field: 'qty', agg: 'avg' }];
const grouped = { dimensions: { categories: ['workshop'], rowTotals: { showGrandTotals: true } }, columns: metrics };
const records = [
  { id: 'a1', workshop: 'A', line: 'L1', date: '2026-10-01', qty: 10 },
  { id: 'a2', workshop: 'A', line: 'L2', date: '2026-11-01', qty: 20 },
  { id: 'b1', workshop: 'B', line: 'L1', date: '2026-10-02', qty: 100 },
  { id: 'b2', workshop: 'B', line: 'L2', date: '2026-11-02', qty: 40 },
];
const build = (config, rows) => buildBiGrid(config, rows, options);
const pivot = direction => ({ ...grouped, dimensions: { ...grouped.dimensions, columnTimeBucket: { field: 'date', granularity: 'month' }, indicatorsAsCol: direction, columnTotals: { showGrandTotals: true } } });
const member = (g, name, metric = 'SUM(qty)', month) => g.bindings.find(b => b.semantic.role === 'metric-value' && b.semantic.metricId === metric && b.semantic.rowPath.some(p => p.memberKey === name) && (month === undefined || b.semantic.columnPath.some(p => p.memberKey === month)));
let serial = 0;
function open(g, { padded = true } = {}) {
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: enUS } });
  univer.registerPlugin(UniverSheetsPlugin);
  const api = FUniver.newAPI(univer);
  const sheetData = biGridToUniverWorksheetData(g, { sheetId: 's1', name: 'QA' });
  if (padded) { sheetData.rowCount = Math.max(100, sheetData.rowCount); sheetData.columnCount = Math.max(40, sheetData.columnCount); }
  const workbook = api.createWorkbook({ id: `regression-${++serial}`, sheetOrder: ['s1'], sheets: { s1: sheetData } });
  return { univer, api, workbook, sheet: workbook.getActiveSheet(), lastGridRef: { current: g }, close: () => univer.dispose() };
}
function refresh(ctx, newGrid, { bindings = ctx.lastGridRef.current.bindings, overrides, manager } = {}) {
  const scope = vm.createContext({ console, BiBindingManager, isInitialized: true, syncGridStyles: false,
    univerAPIRef: { current: ctx.api }, lastGridRef: ctx.lastGridRef, initialGrid: newGrid,
    effectiveBindings: bindings, manualOverrides: overrides, bindingManagerRef: { current: manager } });
  if (manager) vm.runInContext(bindingCode, scope)();
  vm.runInContext(refreshCode, scope)();
}
function style(ctx, b) { ctx.sheet.getRange(b.target.row, b.target.column).setFontWeight('bold'); }
function isBoldInVTable(ctx, b) {
  const pub = compileReport(ctx.workbook).publication;
  const view = adaptPublishedSheetToVTable(pub.sheets[0], pub.styles);
  return view.columns[b.target.column].style({ row: b.target.row }).fontWeight === 'bold';
}
const results = [];
async function check(id, title, layer, run) {
  try { results.push({ id, title, layer, status: 'passed', evidence: await run() }); }
  catch (error) { results.push({ id, title, layer, status: 'failed', errorType: error.name, message: error.message,
    ...(error.actual !== undefined ? { actual: error.actual } : {}), ...(error.expected !== undefined ? { expected: error.expected } : {}) }); }
  console.log(`${results.at(-1).status.toUpperCase()} ${id} ${title}`);
}

await check('RX-01', '分组重排后加粗只属于原成员，不残留给邻居', 'actual-effect+SDK+VTable-input', () => {
  const old = build(grouped, records), next = build(grouped, [...records].reverse()), ctx = open(old);
  try {
    style(ctx, member(old, 'A')); refresh(ctx, next);
    assert.deepEqual({ A: isBoldInVTable(ctx, member(next, 'A')), B: isBoldInVTable(ctx, member(next, 'B')) }, { A: true, B: false });
  } finally { ctx.close(); }
});
await check('RX-02', '两次排序及新增成员后样式不扩散', 'actual-effect+SDK+VTable-input', () => {
  const old = build(grouped, records), descending = { ...grouped, options: { sort: [{ field: 'SUM(qty)', order: 'desc' }] } };
  const second = build(descending, records), third = build(descending, [...records, { id: 'c1', workshop: 'C', qty: 999 }]), ctx = open(old);
  try {
    style(ctx, member(old, 'A')); refresh(ctx, second); refresh(ctx, third);
    assert.deepEqual(Object.fromEntries(['A', 'B', 'C'].map(n => [n, isBoldInVTable(ctx, member(third, n))])), { A: true, B: false, C: false });
  } finally { ctx.close(); }
});
for (const direction of [true, false]) {
  await check(direction ? 'RX-03' : 'RX-04', `透视前插月份后总计样式不污染月份（指标${direction ? '横向' : '纵向'}）`, 'actual-effect+SDK+VTable-input', () => {
    const config = pivot(direction), old = build(config, records);
    const next = build(config, [{ id: 's1', workshop: 'A', date: '2026-09-01', qty: 5 }, ...records]), ctx = open(old);
    const total = g => g.bindings.find(b => b.semantic.role === 'grand-total' && b.semantic.metricId === 'SUM(qty)' && b.semantic.rowPath.some(p => p.memberKey === 'A'));
    try {
      style(ctx, total(old)); refresh(ctx, next);
      const affected = next.bindings.filter(b => b.semantic.role === 'metric-value' && b.semantic.rowPath.some(p => p.memberKey === 'A') && isBoldInVTable(ctx, b));
      assert.deepEqual({ totalBold: isBoldInVTable(ctx, total(next)), boldMonthCells: affected.map(b => b.semantic.columnPath.map(p => p.memberKey).join('/')) }, { totalBold: true, boldMonthCells: [] });
    } finally { ctx.close(); }
  });
}
await check('RX-05', '明细模式也消费数值降序排序', 'pure-report+existing-engine-oracle', () => {
  const config = { columns: [{ type: 'fixed', field: 'id' }, { type: 'fixed', field: 'qty' }], options: { sort: [{ field: 'qty', order: 'desc' }] } };
  const g = build(config, records), engine = transformData(records, config);
  assert.equal(engine.data[0].id, 'b1');
  assert.equal(g.cells.find(c => c.row === 1 && c.col === 0).value, engine.data[0].id);
});
await check('RX-06', '双轴透视按列月份降序布局', 'pure-report', () => {
  const config = { ...pivot(true), options: { sort: [{ field: 'date', order: 'desc' }] } };
  const g = build(config, records);
  const first = g.bindings.filter(b => b.semantic.role === 'metric-value' && b.semantic.metricId === 'SUM(qty)').sort((a,b) => a.target.column - b.target.column)[0];
  assert.equal(first.semantic.columnPath[0].memberKey, '2026-11');
});
await check('RX-07', '设备编号等业务主键的明细重排身份稳定', 'pure-report', () => {
  const rows = [{ device_code: 'CNC-1', qty: 10 }, { device_code: 'CNC-2', qty: 20 }];
  const config = { columns: [{ type: 'fixed', field: 'device_code' }, { type: 'fixed', field: 'qty' }] };
  const old = build(config, rows), next = build(config, [...rows].reverse());
  const at = (g, r) => g.bindings.find(b => b.target.row === r && b.semantic.field === 'qty').id;
  assert.equal(at(next, 2), at(old, 1));
});
await check('RX-08', '数字主键1与字符串主键1不会碰撞', 'pure-report', () => {
  const g = build({ columns: [{ type: 'fixed', field: 'id' }, { type: 'fixed', field: 'qty' }] }, [{ id: 1, qty: 10 }, { id: '1', qty: 20 }]);
  const keys = g.bindings.filter(b => b.semantic.field === 'qty' && b.target.row > 0).map(b => b.id);
  assert.equal(new Set(keys).size, 2);
});
await check('RX-09', '实际初始尺寸下新增分组后扩展工作表行数', 'actual-effect+SDK-unpadded', () => {
  const old = build(grouped, records), next = build(grouped, [...records, { id: 'c1', workshop: 'C', qty: 5 }]), ctx = open(old, { padded: false });
  try { refresh(ctx, next); assert.equal(ctx.sheet.getMaxRows(), Math.max(ctx.sheet.getMaxRows(), next.rowCount)); }
  finally { ctx.close(); }
});
await check('RX-10', '实际初始尺寸下新增月份后扩展工作表列数', 'actual-effect+SDK-unpadded', () => {
  const config = pivot(true), old = build(config, records), next = build(config, [...records, { id: 'c1', workshop: 'A', date: '2026-12-01', qty: 5 }]), ctx = open(old, { padded: false });
  try { refresh(ctx, next); assert.equal(ctx.sheet.getMaxColumns(), Math.max(ctx.sheet.getMaxColumns(), next.colCount)); }
  finally { ctx.close(); }
});
await check('RX-11', '刷新后的真实编辑事件绑定到新成员坐标', 'actual-binding-effect+refresh-effect+SDK', () => {
  const old = build(grouped, [{ workshop: 'B', qty: 50 }]), next = build(grouped, [{ workshop: 'A', qty: 10 }, { workshop: 'B', qty: 50 }]), ctx = open(old);
  const captured = [], manager = new BiBindingManager({ bindings: old.bindings, onManualOverride: (id, value) => captured.push({ id, value }) });
  try {
    manager.attach(ctx.api);
    // ReportConfigPanel currently prefers previously persisted nonempty bindings.
    refresh(ctx, next, { bindings: old.bindings, manager });
    const b = member(next, 'B'); ctx.sheet.getRange(b.target.row, b.target.column).setValue(777);
    assert.deepEqual(captured.map(x => x.id), [b.id]);
  } finally { manager.dispose(); ctx.close(); }
});
await check('RX-12', '改变分组列后发布单元格角色随新布局更新', 'actual-effect+SDK+compiler', () => {
  const old = build(grouped, records), next = build({ ...grouped, dimensions: { categories: ['workshop', 'line'] } }, records), ctx = open(old);
  try {
    refresh(ctx, next);
    const pub = compileReport(ctx.workbook).publication;
    assert.equal(pub.sheets[0].cells.find(c => c.r === 0 && c.c === 1).role, 'dimension-header');
  } finally { ctx.close(); }
});
await check('RX-13', '自动区域增长时保留原区域下方手工备注或阻断覆盖', 'actual-effect+SDK', () => {
  const old = build(grouped, records), next = build(grouped, [...records, { id: 'c1', workshop: 'C', qty: 5 }]), ctx = open(old);
  try {
    ctx.sheet.getRange(old.rowCount, 0).setValue('USER_NOTE_MUST_SURVIVE');
    refresh(ctx, next);
    const cells = compileReport(ctx.workbook).publication.sheets[0].cells;
    assert.ok(cells.some(c => c.v === 'USER_NOTE_MUST_SURVIVE'), 'Managed region expanded over the manual note without a surfaced conflict.');
  } finally { ctx.close(); }
});
await check('RX-14', '批量输入两行时分别捕获两个成员的正确值', 'real-SDK+binding-manager', () => {
  const g = build(grouped, records), ctx = open(g), captured = [];
  const manager = new BiBindingManager({ bindings: g.bindings, onManualOverride: (id, value) => captured.push({ id, v: value.v }) });
  try {
    manager.attach(ctx.api); ctx.sheet.getRange(1, 1, 2, 1).setValues([[1000], [2000]]);
    assert.deepEqual(captured, [{ id: member(g, 'A').id, v: 1000 }, { id: member(g, 'B').id, v: 2000 }]);
  } finally { manager.dispose(); ctx.close(); }
});
await check('RX-15', '仅值变化时单格样式和VTable新值保持正确', 'actual-effect+SDK+VTable-input', () => {
  const old = build(grouped, records), next = build(grouped, records.map(r => ({ ...r, qty: r.qty * 2 }))), ctx = open(old);
  try {
    style(ctx, member(old, 'A')); refresh(ctx, next);
    const pub = compileReport(ctx.workbook).publication, view = adaptPublishedSheetToVTable(pub.sheets[0], pub.styles), a = member(next, 'A');
    assert.deepEqual({ A: isBoldInVTable(ctx, a), B: isBoldInVTable(ctx, member(next, 'B')), value: view.records[a.target.row][`col_${a.target.column}`] }, { A: true, B: false, value: '60' });
  } finally { ctx.close(); }
});
await check('RX-16', '删除成员后发布给VTable的行数与总计一致', 'actual-effect+SDK+VTable-input', () => {
  const old = build(grouped, records), next = build(grouped, records.filter(r => r.workshop === 'A')), ctx = open(old);
  try {
    refresh(ctx, next);
    const pub = compileReport(ctx.workbook).publication, view = adaptPublishedSheetToVTable(pub.sheets[0], pub.styles);
    assert.equal(view.records.length, next.rowCount);
    assert.equal(view.records.at(-1).col_1, '30');
    return { rows: view.records.length, total: view.records.at(-1).col_1 };
  } finally { ctx.close(); }
});
await check('RX-17', '未解决的人工覆盖冲突在第二次相同刷新后仍保留', 'refresh-metadata', () => {
  const region = { id: options.analysisId, sheetId: 's1', anchor: { row: 0, column: 0 }, config: grouped };
  const first = refreshAnalysisRegion(region, records), a = member(first.newGrid, 'A');
  const edited = { ...first.region, manualOverrides: { [a.id]: { v: 999 } } }, changed = records.map(r => ({ ...r, qty: r.qty * 2 }));
  const conflict = refreshAnalysisRegion(edited, changed);
  assert.ok(conflict.diagnostics.some(d => d.code === 'BASE_CHANGED'));
  const again = refreshAnalysisRegion(conflict.region, changed);
  assert.ok(again.diagnostics.some(d => d.code === 'BASE_CHANGED'), 'Conflict disappeared without a resolution while manual value 999 remains active.');
});
await check('RX-18', '空值基线变化也能检测人工覆盖冲突', 'refresh-metadata', () => {
  const config = { columns: [{ type: 'fixed', field: 'id' }, { type: 'fixed', field: 'qty' }] };
  const region = { id: options.analysisId, sheetId: 's1', anchor: { row: 0, column: 0 }, config };
  const first = refreshAnalysisRegion(region, [{ id: 'a1', qty: null }]);
  const binding = first.region.bindings.find(b => b.target.row === 1 && b.semantic.field === 'qty');
  const changed = refreshAnalysisRegion({ ...first.region, manualOverrides: { [binding.id]: { v: 999 } } }, [{ id: 'a1', qty: 5 }]);
  assert.ok(changed.diagnostics.some(d => d.code === 'BASE_CHANGED'));
});
await check('RX-19', '多级分组的不同维度表头有独立身份', 'pure-report', () => {
  const g = build({ ...grouped, dimensions: { categories: ['workshop', 'line'] } }, records);
  const headers = g.bindings.filter(b => b.semantic.role === 'dimension-header');
  assert.equal(new Set(headers.map(b => b.id)).size, headers.length);
});

const report = { executedAt: new Date().toISOString(), nodeVersion: process.version,
  scope: 'Supplemental assertions: pure model, actual isolated production effects, installed headless SDK and compiler/VTable inputs. Not mounted React/browser tests; no formula calculation.',
  fixture: 'Four facts: A=30, B=140. Most style tests reserve space; RX-09/10 use exact initial grid dimensions as the real editor does.',
  source: { path: 'src/univer/UniverPreview.tsx', sha256: createHash('sha256').update(source).digest('hex') },
  summary: { total: results.length, passed: results.filter(r => r.status === 'passed').length, failed: results.filter(r => r.status === 'failed').length }, results };
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report.summary));
console.log(`Evidence: ${output}`);
process.exitCode = report.summary.failed ? 1 : 0;
