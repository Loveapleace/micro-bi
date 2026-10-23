/** 第21节复验补充：设计快照往返与历史实例键迁移；不改动业务实现。 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import ts from 'typescript';
import { compileCellReport, normalizeCellTemplate, expandCellTemplate, encodeMemberTuple, buildInstanceKey, computeBindingSignature } from '../dist/esm/report-template/index.js';
import { syncDocumentFromWorkbookSnapshot } from '../dist/esm/cell-designer/syncWorkbookToTemplate.js';

const template = JSON.parse(await readFile(new URL('../examples/cell-reports/workshop-delivery-quality.json', import.meta.url), 'utf8'));
const text = await readFile(new URL('../../dynamic-data-test/src/mockData.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { MOCK_INDUSTRIAL_2_TIME: facts } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const fresh = () => structuredClone(template);
const gridFor = (doc, rows = facts) => expandCellTemplate(doc, normalizeCellTemplate(doc), rows).grid;
const at = (g, b) => g.cells.find((c) => c.row === b.target.row && c.col === b.target.column);
const target = (g) => g.bindings.find((b) => b.semantic.role === 'metric-value' && b.semantic.metricId === 'qty-sum' && at(g, b)?.value === 600);
const dataRule = (doc) => doc.layoutRules.find((r) => r.kind === 'merge' && r.range?.startRow >= doc.regions[0].anchor.row);

function snapshot(g, options = {}) {
  const cellData = {};
  for (const c of g.cells) (cellData[c.row] ||= {})[c.col] = { v: c.value };
  if (options.binding) cellData[options.binding.target.row][options.binding.target.column].v = options.value;
  const mergeData = g.merges.map((m) => ({ startRow: m.startRow, endRow: m.endRow, startColumn: m.startCol, endColumn: m.endCol }));
  if (options.merge) mergeData.push(options.merge);
  return { sheetOrder: ['sheet-1'], sheets: { 'sheet-1': { cellData, mergeData } } };
}
function designGrid(doc) {
  return { type: 'detail', rowCount: 25, colCount: 15, bindings: [],
    cells: doc.cells.map((c) => ({ row: c.position.row, col: c.position.column,
      value: c.content.kind === 'literal' ? c.content.value : c.content.kind === 'field' ? `{${c.content.displayName || c.content.fieldKey}}` : c.content.kind === 'business-formula' ? `=[${c.content.displayName || c.content.metricId}]` : '', role: 'custom' })),
    merges: doc.layoutRules.filter((r) => r.kind === 'merge').map((r) => ({ startRow: r.range.startRow, endRow: r.range.endRow, startCol: r.range.startColumn, endCol: r.range.endColumn })) };
}
function mergedSaved() {
  const doc = fresh(); const g = gridFor(doc); const b = target(g);
  const saved = syncDocumentFromWorkbookSnapshot(doc, snapshot(g, { merge: { startRow: b.target.row, endRow: b.target.row, startColumn: b.target.column, endColumn: b.target.column + 1 } }), 'preview', g);
  return JSON.parse(JSON.stringify(saved)); // 与真实保存包一样跨越JSON持久化边界
}
function legacyDoc(rows = facts) {
  const doc = fresh(); const g = gridFor(doc, rows); const b = target(g);
  // R3及以前真实使用的键：类型化成员元组，不携带field前缀。
  doc.instanceOverrides = [{ templateCellId: 'quantity', instanceKey: buildInstanceKey({ templateCellId: 'quantity', regionId: doc.regions[0].id,
    rowPath: encodeMemberTuple(b.semantic.rowPath.map((p) => p.memberKey)), columnPath: encodeMemberTuple(b.semantic.columnPath.map((p) => p.memberKey)),
    metricId: 'qty-sum', role: b.semantic.role }), originalBaseValue: 600, overrideValue: 999, dataRevision: 'R3-data', status: 'active' }];
  return doc;
}
function editAgain(doc, value, rows = facts) {
  const g = gridFor(doc, rows); const b = g.bindings.find((b) => b.semantic.role === 'metric-value' && b.semantic.metricId === 'qty-sum' && at(g, b)?.value === 999);
  assert.ok(b, '先验证存量覆盖已生效');
  return syncDocumentFromWorkbookSnapshot(doc, snapshot(g, { binding: b, value }), 'preview', g);
}
const results = [];
async function check(id, requirement, name, fn) {
  try { const evidence = await fn(); results.push({ id, requirement, name, passed: true, evidence }); console.log(`PASS ${id} ${name}`); }
  catch (error) { results.push({ id, requirement, name, passed: false, error: error.message }); console.log(`FAIL ${id} ${name}: ${error.message.split('\n')[0]}`); }
}

await check('R4-01', 'DCR-01', '已保存业务合并经过设计态快照后仍保留原语义选择器', () => {
  const saved = mergedSaved(); const before = dataRule(saved).semanticSelector; assert.ok(before?.masterSignature);
  const design = designGrid(saved);
  const next = syncDocumentFromWorkbookSnapshot(saved, snapshot(design), 'design', design);
  assert.deepEqual(dataRule(next).semanticSelector, before, '设计grid.bindings为空时重建mergeRules丢掉已有selector');
});
await check('R4-02', 'DCR-01', '设计态数据变动后回预览不按旧坐标重新绑定新成员', () => {
  const saved = mergedSaved(); const wanted = dataRule(saved).semanticSelector.masterSignature;
  const design = designGrid(saved); const next = syncDocumentFromWorkbookSnapshot(saved, snapshot(design), 'design', design);
  const rows = [{ ...facts[0], order_code: 'QA-R4-NEW', workshop: '0号验收车间', plan_start_time: '2026-07-01 08:00:00', output_qty: 50, defect_count: 5 }, ...facts];
  const after = gridFor(next, rows); const merge = after.merges.find((m) => m.startRow >= next.regions[0].anchor.row);
  const master = after.bindings.find((b) => b.target.row === merge.startRow && b.target.column === merge.startCol);
  assert.equal(computeBindingSignature(master), wanted, 'selector丢失后又从变化后的数据按旧range捕获，合并误指向0号车间');
});
await check('R4-03', 'DCR-02', '新版本键连续人工编辑只保留1条覆盖且基线仍为600', () => {
  const doc = fresh(); const g = gridFor(doc); const b = target(g);
  const first = syncDocumentFromWorkbookSnapshot(doc, snapshot(g, { binding: b, value: 999 }), 'preview', g);
  const second = editAgain(first, 1000);
  assert.equal(second.instanceOverrides.length, 1); assert.equal(second.instanceOverrides[0].originalBaseValue, 600);
  assert.ok(!compileCellReport(second, facts).diagnostics.some((d) => /CONFLICT/.test(d.code)));
});
await check('R4-04', 'DCR-02', '新版本带字段键支持成员文字中的等号', () => {
  const rows = facts.map((r) => ({ ...r, workshop: r.workshop === facts[0].workshop ? 'A=B' : r.workshop }));
  const doc = fresh(); const g = gridFor(doc, rows); const b = target(g);
  const saved = syncDocumentFromWorkbookSnapshot(doc, snapshot(g, { binding: b, value: 999 }), 'preview', g);
  assert.equal(gridFor(saved, rows).cells.filter((c) => c.value === 999).length, 1);
});
await check('R4-05', 'DCR-02/兼容', 'R3存量键再次编辑后升级去重而非保留新旧两条覆盖', () => {
  const next = editAgain(legacyDoc(), 1000);
  assert.equal(next.instanceOverrides.length, 1, '相同业务格生成旧成员键与新field=member键两条覆盖');
});
await check('R4-06', 'DCR-02/兼容', '存量键再次编辑且事实未变时不产生伪冲突', () => {
  const next = editAgain(legacyDoc(), 1000); const result = compileCellReport(next, facts);
  assert.ok(!result.diagnostics.some((d) => /CONFLICT/.test(d.code)), '先应用旧999再用新覆盖与其比较，误报原事实600已变成999');
});
await check('R4-07', 'DCR-02/兼容', 'R3合法成员值A=B的旧覆盖仍能识别或正确迁移', () => {
  const rows = facts.map((r) => ({ ...r, workshop: r.workshop === facts[0].workshop ? 'A=B' : r.workshop }));
  const doc = legacyDoc(rows); const g = gridFor(doc, rows);
  assert.equal(g.cells.filter((c) => c.value === 999).length, 1, '成员值中的%3D被误当作新字段格式标记，旧键被误报孤儿');
});
await check('R4-08', 'DCR-02/兼容', '旧成员键换分组字段后不再按同名值静默继承', () => {
  const doc = legacyDoc(); const dim = doc.cells.find((c) => c.id === 'workshop'); dim.content.fieldId = 'dispatch_group'; dim.content.fieldKey = 'dispatch_group';
  const rows = facts.map((r) => ({ ...r, dispatch_group: r.workshop })); const result = compileCellReport(doc, rows);
  assert.ok(result.diagnostics.some((d) => /MIGRAT|ORPHAN|SCHEMA|CONFLICT/.test(d.code)) || !result.publication.sheets[0].cells.some((c) => c.v === 999), '无字段信息的旧键继续走宽松成员匹配，换字段仍继承999');
});

const dir = new URL('../doc/verification/cell-recheck-2026-10-19-r4/', import.meta.url); await mkdir(dir, { recursive: true });
const summary = { timestamp: new Date().toISOString(), scope: '真实展开器、快照适配器、编译器与JSON保存边界；历史键按R3实际编码构造', total: results.length, passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length, results };
await writeFile(new URL('persistence.json', dir), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ total: summary.total, passed: summary.passed, failed: summary.failed })); if (summary.failed) process.exitCode = 1;
