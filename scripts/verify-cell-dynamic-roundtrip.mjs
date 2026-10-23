/** 动态实例与布局保存复验。实际展开器/快照适配器/编译器；主应用UI证据单独留存。 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { compileCellReport, normalizeCellTemplate, expandCellTemplate, parseInstanceKey, buildInstanceKey } from '../dist/esm/report-template/index.js';
import { syncDocumentFromWorkbookSnapshot } from '../dist/esm/cell-designer/syncWorkbookToTemplate.js';
import { adaptPublishedSheetToVTable } from '../dist/esm/ui/presentation/report/gridAdapter.js';

const template = JSON.parse(await readFile(new URL('../examples/cell-reports/workshop-delivery-quality.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../../dynamic-data-test/src/mockData.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { MOCK_INDUSTRIAL_2_TIME: facts } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const fresh = () => structuredClone(template);
const gridFor = (doc, rows = facts) => expandCellTemplate(doc, normalizeCellTemplate(doc), rows).grid;
const at = (g, b) => g.cells.find((c) => c.row === b.target.row && c.col === b.target.column);
const target = (g) => g.bindings.find((b) => b.semantic.role === 'metric-value' && b.semantic.metricId === 'qty-sum' && b.semantic.rowPath.some((p) => p.memberKey === facts[0].workshop) && b.semantic.columnPath.some((p) => p.memberKey === '2026-08-01'));
function snapshot(g, binding, value) {
  const cellData = {};
  for (const c of g.cells) (cellData[c.row] ||= {})[c.col] = { v: c.value };
  if (binding) cellData[binding.target.row][binding.target.column].v = value;
  return { sheetOrder: ['sheet-1'], sheets: { 'sheet-1': { cellData, mergeData: g.merges.map((m) => ({ startRow: m.startRow, endRow: m.endRow, startColumn: m.startCol, endColumn: m.endCol })) } } };
}
function edit(doc, binding, value) { const g = gridFor(doc); return syncDocumentFromWorkbookSnapshot(doc, snapshot(g, binding, value), 'preview', g); }
function firstEdit() { const doc = fresh(); return edit(doc, target(gridFor(doc)), 999); }
const newFact = { ...facts[0], order_code: 'QA-R3-NEW', workshop: '0号验收车间', plan_start_time: '2026-07-01 08:00:00', output_qty: 50, defect_count: 5 };
const signature = (b) => b ? JSON.stringify({ role: b.semantic.role, metric: b.semantic.metricId, row: b.semantic.rowPath.map((p) => [p.field, p.memberKey]), col: b.semantic.columnPath.map((p) => [p.field, p.memberKey]) }) : null;
const mergedSignatures = (grid, merge) => grid.bindings.filter((b) => b.target.row >= merge.startRow && b.target.row <= merge.endRow && b.target.column >= merge.startCol && b.target.column <= merge.endCol).map(signature).sort();
function bodyMerge(doc) {
  const b = target(gridFor(doc));
  doc.layoutRules.push({ id: 'body-user-merge', kind: 'merge', sheetId: 'sheet-1', source: 'user', sequence: 10, range: { startRow: b.target.row, endRow: b.target.row, startColumn: b.target.column, endColumn: b.target.column + 1 } });
  return b;
}
const results = [];
async function check(id, requirement, name, fn) {
  try {
    const evidence = await fn(); results.push({ id, requirement, name, passed: true, evidence }); console.log(`PASS ${id} ${name}`);
  } catch (error) {
    results.push({ id, requirement, name, passed: false, error: error.message }); console.log(`FAIL ${id} ${name}: ${error.message.split('\n')[0]}`);
  }
}

await check('FR-01', 'DCR-02', '一次实际快照编辑只生成一个覆盖并在VTable适配生效', () => {
  const doc = firstEdit(); assert.equal(doc.instanceOverrides.length, 1);
  assert.equal(doc.instanceOverrides[0].originalBaseValue, 600);
  const compiled = compileCellReport(doc, facts);
  const a = adaptPublishedSheetToVTable(compiled.publication.sheets[0], compiled.publication.styles);
  assert.ok(a.records.some((r) => Object.values(r).includes('999.00')));
  return { overrides: 1, originalBase: 600, displayed: '999.00' };
});
await check('FR-02', 'DCR-02', '连续人工改600→999→1000仍保留最初事实基线600', () => {
  const doc = firstEdit(); const next = edit(doc, target(gridFor(doc)), 1000);
  assert.equal(next.instanceOverrides[0].originalBaseValue, 600, '第二次人工编辑把前一次人工值999当作事实基线');
});
await check('FR-03', 'DCR-02', '事实未变时连续人工编辑不产生源数据冲突', () => {
  const doc = firstEdit(); const next = edit(doc, target(gridFor(doc)), 1000);
  const result = compileCellReport(next, facts);
  assert.ok(!result.diagnostics.some((d) => /CONFLICT/.test(d.code)), '事实仍是600却报告基线999与600冲突');
});
await check('FR-04', 'DCR-02', '总计格覆盖不会改掉同度量的总计行表头', () => {
  const doc = fresh(); const g = gridFor(doc);
  const total = g.bindings.find((b) => b.semantic.role === 'grand-total' && b.semantic.metricId === 'qty-sum' && b.semantic.rowPath.length === 0 && b.semantic.columnPath.length === 0);
  assert.ok(total);
  const saved = edit(doc, total, 12345);
  const compiled = compileCellReport(saved, facts);
  if (!compiled.valid && compiled.diagnostics.some((d) => d.severity === 'error' && /ROLE|READ_ONLY|OVERRIDE/.test(d.code))) return { explicitlyRejectedTotalOverride: true };
  const changed = gridFor(saved);
  assert.equal(at(changed, total)?.value, 12345);
  assert.equal(changed.cells.filter((c) => c.value === 12345).length, 1, '消费覆盖时未检查role，同路径metric-header也被覆盖');
});
await check('FR-05', 'DCR-02', '其他region的实例键不能消费当前区域的覆盖', () => {
  const doc = firstEdit(); const parsed = parseInstanceKey(doc.instanceOverrides[0].instanceKey);
  doc.instanceOverrides[0].instanceKey = buildInstanceKey({ ...parsed, regionId: 'another-region' });
  const result = compileCellReport(doc, facts);
  const changed = gridFor(doc);
  assert.ok(!result.valid || at(changed, target(changed))?.value === 600, 'parsed.regionId被忽略，其他区域键仍把当前格改成999');
});
await check('FR-06', 'DCR-02', '分组字段语义改变后不按相同成员文字静默继承覆盖', () => {
  const doc = firstEdit();
  const dim = doc.cells.find((c) => c.id === 'workshop'); dim.content.fieldId = 'dispatch_group'; dim.content.fieldKey = 'dispatch_group';
  const rows = facts.map((r) => ({ ...r, dispatch_group: r.workshop }));
  const result = compileCellReport(doc, rows);
  assert.ok(result.diagnostics.some((d) => /ORPHAN|SCHEMA|MIGRAT|CONFLICT/.test(d.code)) || !result.publication.sheets[0].cells.some((c) => c.v === 999), '实例路径只有成员值，换分组字段后仍无诊断继承999');
});
await check('FR-07', 'DCR-02', '前插新行新列、删除无关成员、源记录逆序后覆盖跟随原业务格', () => {
  for (const rows of [[newFact, ...facts], [...facts].reverse(), facts.filter((r) => r.workshop !== '3号智能装配车间')]) {
    const g = gridFor(firstEdit(), rows);
    assert.equal(at(g, target(g))?.value, 999);
    assert.equal(g.cells.filter((c) => c.value === 999).length, 1);
  }
});
await check('FR-08', 'DCR-02', '实际源值变700后的冲突诊断在两次刷新中持续存在', () => {
  const doc = firstEdit(); const rows = facts.map((r, i) => i === 0 ? { ...r, output_qty: 700 } : r);
  for (let i = 0; i < 2; i++) assert.ok(compileCellReport(doc, rows).diagnostics.some((d) => /CONFLICT/.test(d.code)));
});
await check('FR-09', 'DCR-01', '前插新行新列后合并主格仍是原车间原日期', () => {
  const doc = firstEdit(); const before = bodyMerge(doc);
  const oldGrid = gridFor(doc); const oldMerge = oldGrid.merges.find((m) => m.startRow >= doc.regions[0].anchor.row);
  const after = gridFor(doc, [newFact, ...facts]);
  const dataMerges = after.merges.filter((m) => m.startRow >= doc.regions[0].anchor.row);
  assert.equal(dataMerges.length, 1, '原业务合并应重定位为一个数据区域合并');
  const merge = dataMerges[0];
  const master = after.bindings.find((b) => b.target.row === merge.startRow && b.target.column === merge.startCol);
  assert.equal(signature(master), signature(before), '合并仍使用旧坐标，主格已变成新车间/新日期');
  assert.deepEqual(mergedSignatures(after, merge), mergedSignatures(oldGrid, oldMerge), '合并覆盖的完整实例集合应保持一致');
});
await check('FR-10', 'DCR-01', '指标横纵方向变化后合并不落到表头或其他指标', () => {
  const doc = firstEdit(); const before = bodyMerge(doc);
  const oldGrid = gridFor(doc); const oldMerge = oldGrid.merges.find((m) => m.startRow >= doc.regions[0].anchor.row);
  doc.regions[0].metricDirection = 'columns';
  const compiled = compileCellReport(doc, facts);
  if (!compiled.valid) {
    assert.ok(compiled.diagnostics.some((d) => d.severity === 'error' && /MERGE|LAYOUT/.test(d.code)), '不能重放的合并必须明确报告布局错误');
    return { blockedWithLayoutDiagnostic: true };
  }
  const after = gridFor(doc);
  const dataMerges = after.merges.filter((m) => m.startRow >= doc.regions[0].anchor.row);
  assert.equal(dataMerges.length, 1, '可重放时应保留原业务合并，否则应诊断阻断');
  const merge = dataMerges[0];
  const master = after.bindings.find((b) => b.target.row === merge.startRow && b.target.column === merge.startCol);
  assert.equal(signature(master), signature(before), '指标布局切换后旧合并坐标覆盖了另一种语义单元格');
  assert.deepEqual(mergedSignatures(after, merge), mergedSignatures(oldGrid, oldMerge), '不能通过合并其他度量填补不连续的业务格');
});
await check('FR-11', 'DCR-01', '显式取消全部合并后，分组/透视与新成员均不自动补合并', () => {
  for (const layoutKind of ['grouped', 'pivot']) for (const rows of [facts, [newFact, ...facts], [], [...facts].reverse()]) {
    const doc = firstEdit(); doc.regions[0].layoutKind = layoutKind; doc.layoutRules = [];
    assert.equal(gridFor(doc, rows).merges.length, 0);
  }
});
await check('FR-12', 'DCR-02', '被覆盖成员删除或数据清空后999不污染其他成员', () => {
  const doc = firstEdit();
  for (const rows of [facts.filter((r) => r.workshop !== facts[0].workshop), []]) {
    const result = compileCellReport(structuredClone(doc), rows);
    assert.ok(!result.publication.sheets[0].cells.some((c) => c.v === 999));
    assert.ok(result.diagnostics.some((d) => /ORPHAN/.test(d.code)));
  }
});

const out = process.argv[2]
  ? pathToFileURL(resolve(process.argv[2]) + '/')
  : new URL('../doc/verification/cell-recheck-2026-10-19-r3/', import.meta.url);
await mkdir(out, { recursive: true });
const summary = { timestamp: new Date().toISOString(), scope: '保存快照与实际动态编译/适配；真实浏览器模式切换与数据热更新另存', total: results.length, passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length, results };
await writeFile(new URL('focused.json', out), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ total: summary.total, passed: summary.passed, failed: summary.failed }));
if (summary.failed) process.exitCode = 1;
