import { setPresentation } from '../test/helpers/presentation.mjs';
/** 独立复验：调用实际v2引擎、快照同步器、编译器和VTable适配器；不改业务实现。 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  expandCellDrivenTemplate, compileCellReport, parseInstanceKey,
} from '../dist/esm/report-template/index.js';
import { syncDocumentFromWorkbookSnapshot } from '../dist/esm/cell-designer/syncWorkbookToTemplate.js';
import { adaptPublishedSheetToVTable } from '../dist/esm/ui/presentation/report/gridAdapter.js';

const out = pathToFileURL(resolve(process.argv[2] || 'doc/verification/cell-expansion-recheck-2026-10-21') + '/');
const rows = [
  { id: 'r1', team: 'A', day: '2026-10-01', qty: 10, defects: 1, right: 'X' },
  { id: 'r2', team: 'B', day: '2026-10-02', qty: 20, defects: 2, right: 'Y' },
];
function doc(cells, changes = {}) {
  return {
    documentType: 'cell-template', schemaVersion: '2.0', capabilitiesVersion: 'cell-expansion-v2',
    id: 'independent-ce-review', title: '独立CE复验', templateRevision: 1,
    sheets: [{ id: 'sheet-1', name: '测试' }],
    regions: [{ id: 'r1', datasetId: 'ds', sheetId: 'sheet-1', anchor: { row: 0, column: 0 }, filters: [] }],
    cells, layoutRules: [], styleRules: [], presentationRules: {version:1,revision:0,ruleSets:[]}, instanceOverrides: [], orphanedEdits: [],
    ...changes,
  };
}
function field(id, key, row, column, operation = 'sum', expand = 'inherit', parent = null, extras = {}) {
  return {
    id, sheetId: 'sheet-1', regionId: 'r1', position: { row, column },
    parents: { row: parent, column: null },
    content: { kind: 'field', fieldId: key, fieldKey: key, role: operation === 'group' ? 'row-dimension' : 'measure', metricId: operation === 'group' ? undefined : id, operation, expand },
    ...extras,
  };
}
const basic = () => doc([field('team', 'team', 1, 0, 'group', 'down'), field('quantity', 'qty', 1, 1, 'sum', 'inherit', 'team')]);
const at = (grid, row, col) => grid.cells.find(c => c.row === row && c.col === col)?.value;
const codes = result => result.diagnostics.map(d => d.code);
function snap(grid, binding, value) {
  const cellData = {};
  for (const c of grid.cells) (cellData[c.row] ||= {})[c.col] = { v: c.value };
  if (binding) cellData[binding.target.row][binding.target.column].v = value;
  return { sheetOrder: ['sheet-1'], sheets: { 'sheet-1': { cellData, mergeData: grid.merges.map(m => ({ startRow: m.startRow, endRow: m.endRow, startColumn: m.startCol, endColumn: m.endCol })) } } };
}
const results = [];
async function check(id, issue, name, fn) {
  try { const evidence = await fn(); results.push({ id, issue, name, passed: true, evidence }); console.log(`PASS ${id} ${name}`); }
  catch (e) { results.push({ id, issue, name, passed: false, error: e.message }); console.log(`FAIL ${id} ${name}: ${e.message.split('\n')[0]}`); }
}

await check('CER-01', 'baseline', '无全局参数分组SUM可发布并被VTable消费', () => {
  const d = basic(); const g = expandCellDrivenTemplate(d, rows).grid;
  assert.equal(at(g, 1, 1), 10); assert.equal(at(g, 2, 1), 20);
  const c = compileCellReport(d, rows); assert.equal(c.valid, true);
  const v = adaptPublishedSheetToVTable(c.publication.sheets[0], c.publication.styles);
  assert.equal(v.records[1].col_1, '10'); assert.equal(v.records[2].col_1, '20');
  return { cells: g.cells.length, displayed: [v.records[1].col_1, v.records[2].col_1] };
});
await check('CER-02', 'baseline', '双父交叉按行列事实交集计算', () => {
  const d = basic(); const date = field('day', 'day', 0, 1, 'group', 'right'); date.content.role = 'column-dimension';
  d.cells.push(date); d.cells[1].parents.column = 'day'; const g = expandCellDrivenTemplate(d, rows).grid;
  assert.deepEqual([at(g, 1, 1), at(g, 1, 2), at(g, 2, 1), at(g, 2, 2)], [10, 0, 0, 20]);
});
await check('CER-04', 'save', '预览快照600式单格覆盖JSON保存后可被新引擎消费', () => {
  const d = basic(); const g = expandCellDrivenTemplate(d, rows).grid;
  const b = g.bindings.find(b => b.semantic.metricId === 'quantity' && b.target.row === 1);
  const next = JSON.parse(JSON.stringify(syncDocumentFromWorkbookSnapshot(d, snap(g, b, 999), 'preview', g)));
  assert.equal(next.instanceOverrides.length, 1);
  const after = expandCellDrivenTemplate(next, rows).grid;
  assert.equal(at(after, 1, 1), 999, '快照保存的instanceKey与v2引擎生成键不一致，999保存后回到事实10');
});
await check('CER-05', 'override', '事实变化后保留覆盖并产生真实基线冲突诊断', () => {
  const d = basic(); const g = expandCellDrivenTemplate(d, rows).grid;
  const b = g.bindings.find(b => b.semantic.metricId === 'quantity' && b.target.row === 1);
  d.instanceOverrides = [{ templateCellId: 'quantity', instanceKey: b.instanceKey, originalBaseValue: 10, overrideValue: 999, dataRevision: 1, status: 'active' }];
  const updated = rows.map(r => ({ ...r, qty: r.id === 'r1' ? 15 : r.qty }));
  const c = compileCellReport(d, updated);
  assert.ok(c.diagnostics.some(d => /CONFLICT/.test(d.code)), `事实10→15仍无冲突诊断: ${codes(c)}`);
});
await check('CER-06', 'formula', '现有业务公式语法IF与SUM在v2结果中正确计算', () => {
  const d = basic(); d.cells.push({ id: 'rate', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 2 }, parents: { row: 'team', column: null }, content: { kind: 'business-formula', metricId: 'rate', expression: 'IF([SUM(qty)] > 0, [SUM(defects)] / [SUM(qty)], 0)', scope: 'summary', format: 'percent' } });
  const c = compileCellReport(d, rows); assert.equal(c.valid, true);
  assert.equal(c.publication.sheets[0].cells.find(c => c.r === 1 && c.c === 2)?.v, 0.1, '既有公式语法静默发布null');
});
await check('CER-07', 'formula', '工作表公式=1+1执行或明确阻断', () => {
  const d = basic(); d.cells.push({ id: 'excel', sheetId: 'sheet-1', position: { row: 0, column: 5 }, parents: { row: null, column: null }, content: { kind: 'sheet-formula', formula: '=1+1' } });
  const c = compileCellReport(d, rows);
  assert.ok(!c.valid || c.publication.sheets[0].cells.some(x => x.r === 0 && x.c === 5 && x.v === 2), 'valid=true但工作表公式发布null');
});
await check('CER-08', 'time', '时间按日分组将同日不同时刻合为一组', () => {
  const d = doc([field('day', 'day', 1, 0, 'group', 'down'), field('quantity', 'qty', 1, 1, 'sum', 'inherit', 'day')]);
  d.cells[0].content.timeBucket = { granularity: 'day' };
  const r = [{ id: 'a', day: '2026-10-01 08:00:00', qty: 10 }, { id: 'b', day: '2026-10-01 17:00:00', qty: 20 }];
  const c = compileCellReport(d, r); const vals = c.publication.sheets[0].cells.filter(c => c.c === 1).map(c => c.v);
  assert.deepEqual(vals, [30], 'timeBucket未参与分组，按原始字符串拆成两行');
});
await check('CER-09', 'identity', '明细显示字段重复时不同主键仍具有唯一业务实例键', () => {
  const driver = field('label', 'team', 1, 0, 'list', 'down'); driver.content.role = 'detail-column';
  const follower = field('quantity', 'qty', 1, 1, 'list', 'down', 'label'); follower.content.role = 'detail-column';
  const d = doc([driver, follower]); const r = [{ id: 'a', team: 'same', qty: 10 }, { id: 'b', team: 'same', qty: 20 }];
  const g = expandCellDrivenTemplate(d, r).grid;
  const keys = g.bindings.filter(b => b.semantic.metricId === 'quantity').map(b => b.instanceKey);
  assert.equal(new Set(keys).size, 2, 'id不同但同显示字段的明细键发生碰撞');
});
await check('CER-10', 'identity', '重复明细主键在编译时明确阻断', () => {
  const driver = field('order', 'id', 1, 0, 'list', 'down'); driver.content.role = 'detail-column';
  const d = doc([driver, field('quantity', 'qty', 1, 1, 'list', 'down', 'order')]);
  const c = compileCellReport(d, [{ id: 'same', qty: 10 }, { id: 'same', qty: 20 }]);
  assert.equal(c.valid, false, '重复主键仍valid=true');
});
await check('CER-11', 'layout', '原型下方说明随展开推移且不覆盖数据', () => {
  const d = basic(); d.cells.push({ id: 'note', sheetId: 'sheet-1', regionId:'r1', position: { row: 2, column: 1 }, content: { kind: 'literal', value: '必须保留的说明' }, parents: { row: 'none', column: 'none' } });
  const c = compileCellReport(d, rows);
  assert.equal(c.valid, true, JSON.stringify(c.diagnostics));
  const cells=c.publication.sheets[0].cells,notes=cells.filter(cell=>cell.v==='必须保留的说明');
  assert.equal(notes.length,1,'推移后说明必须唯一保留');
  assert.deepEqual([notes[0].r,notes[0].c],[3,1],'说明应位于展开后的数据区下方');
  assert.deepEqual(cells.filter(cell=>cell.c===1&&typeof cell.v==='number').map(cell=>cell.v),[10,20],'推移不得覆盖原指标值');
});
await check('CER-12', 'layout', '组内静态标签按照声明的父上下文重复', () => {
  const d = basic(); d.cells.push({ id: 'tag', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 3 }, content: { kind: 'literal', value: '本组汇总' }, parents: { row: 'team', column: null } });
  const g = expandCellDrivenTemplate(d, rows).grid;
  assert.equal(g.cells.filter(c => c.value === '本组汇总').length, 2, '静态跟随内容仅留在原位置，未重复');
});
await check('CER-13', 'layout', '同页两个并排独立数据块保留各自模板起始行', () => {
  const d = basic(); d.cells.push(field('right', 'right', 1, 4, 'group', 'down'), field('rightQty', 'qty', 1, 5, 'sum', 'inherit', 'right'));
  const g = expandCellDrivenTemplate(d, rows).grid;
  assert.equal(at(g, 1, 4), 'X', '第二根驱动被全局cursor强行接到第一块后面');
  assert.equal(at(g, 2, 4), 'Y');
});
await check('CER-14', 'region', '同页不同区域分别执行自己的过滤并保留区域身份', () => {
  const d = basic(); d.regions[0].filters = [{ field: 'team', operator: 'eq', value: 'A' }];
  d.regions.push({ id: 'r2', datasetId: 'ds', sheetId: 'sheet-1', anchor: { row: 0, column: 5 }, filters: [{ field: 'team', operator: 'eq', value: 'B' }] });
  d.cells.push(field('r2sum', 'qty', 0, 5, 'sum', 'none', null, { regionId: 'r2' }));
  const c = compileCellReport(d, rows); assert.equal(c.valid, true);
  assert.equal(c.publication.sheets[0].cells.find(c => c.r === 0 && c.c === 5)?.v, 20, '第二区域错误使用第一区域的A过滤得到10');
});
await check('CER-15', 'sheets', '第二张工作表的数据模板同样展开发布', () => {
  const d = basic(); d.sheets.push({ id: 'sheet-2', name: '第二数据表' });
  d.regions.push({ id: 'r2', datasetId: 'ds', sheetId: 'sheet-2', anchor: { row: 0, column: 0 }, filters: [] });
  d.cells.push(field('sheet2sum', 'qty', 0, 0, 'sum', 'none', null, { sheetId: 'sheet-2', regionId: 'r2' }));
  const c = compileCellReport(d, rows); assert.equal(c.valid, true);
  assert.equal(c.publication.sheets.find(s => s.id === 'sheet-2').cells.find(c => c.r === 0 && c.c === 0)?.v, 30, '第二张表仍按静态内容发布null');
});
await check('CER-16', 'style', '条件格式在当前业务值上生效', () => {
  const d = basic(); setPresentation(d,d.cells.find(c=>c.content.metricId==='quantity').id,{operator:'gt',threshold:15,style:{backgroundColor:'#FF0000'}});
  const g = expandCellDrivenTemplate(d, rows).grid;
  assert.equal(g.cells.find(c => c.row === 2 && c.col === 1)?.style?.bgColor, '#FF0000', 'v2没有执行conditionalRules');
});
await check('CER-17', 'merge', '投影生成的动态合并不能经未编辑快照固化为人工规则', () => {
  const d = basic(); d.cells.push(field('defects', 'defects', 2, 1, 'sum', 'inherit', 'team'));
  d.mergeConfig = { capability: 'template-merge-v1', identityVersion: 1, legacyFallback: 'explicit-only', policies: [{ id: 'p-team', kind: 'group-span', sheetId: 'sheet-1', regionId: 'r1', target: { kind: 'template-cell', templateCellId: 'team', subject: 'row-member-label' }, enabled: true, direction: 'auto', boundary: 'parent-group', source: 'user', sequence: 1 }], suppressions: [] };
  const g = expandCellDrivenTemplate(d, rows).grid; assert.ok(g.merges.length >= 2);
  const saved = syncDocumentFromWorkbookSnapshot(d, snap(g), 'preview', g);
  assert.equal(saved.layoutRules.filter(r => r.kind === 'merge').length, 0, '未编辑的生成mergeData被保存为人工LayoutRule');
});
await check('CER-18', 'merge', '关闭动态规则后保存重开仍保持取消', () => {
  const d = basic(); d.cells.push(field('defects', 'defects', 2, 1, 'sum', 'inherit', 'team'));
  d.mergeConfig = { capability: 'template-merge-v1', identityVersion: 1, legacyFallback: 'explicit-only', policies: [{ id: 'p-team', kind: 'group-span', sheetId: 'sheet-1', regionId: 'r1', target: { kind: 'template-cell', templateCellId: 'team', subject: 'row-member-label' }, enabled: true, direction: 'auto', boundary: 'parent-group', source: 'user', sequence: 1 }], suppressions: [] };
  const g = expandCellDrivenTemplate(d, rows).grid;
  const saved = JSON.parse(JSON.stringify(syncDocumentFromWorkbookSnapshot(d, snap(g), 'preview', g)));
  saved.mergeConfig.policies[0].enabled = false;
  const c = compileCellReport(saved, rows);
  assert.equal(c.valid, true, `关闭后的编译也必须有效: ${codes(c)}`);
  assert.equal(c.publication.sheets[0].merges.length, 0, '关闭动态策略后快照固化的旧合并仍存在');
});
await check('CER-19', 'baseline', '重复编译与数据倒序不修改源模板且简单分组结果稳定', () => {
  const d = basic(); const before = JSON.stringify(d);
  const a = expandCellDrivenTemplate(d, rows).grid; const b = expandCellDrivenTemplate(d, [...rows].reverse()).grid;
  assert.equal(JSON.stringify(d), before); assert.deepEqual(a.cells, b.cells);
});
await check('CER-20', 'format', '当前侧栏number格式在v2发布保持千分位与两位小数', () => {
  const d = basic(); d.cells[1].content.format = 'number'; const r = rows.map(x => ({ ...x, qty: 1234 }));
  const c = compileCellReport(d, r);
  assert.equal(c.publication.sheets[0].cells.find(c => c.r === 1 && c.c === 1)?.displayText, '1,234.00', 'v2格式器未处理现有number选项');
});
await check('CER-21', 'merge', '取消合并的快照经过保存与模式往返后不会自动复活', () => {
  const d = basic(); d.cells.push(field('defects', 'defects', 2, 1, 'sum', 'inherit', 'team'));
  d.mergeConfig = { capability: 'template-merge-v1', identityVersion: 1, legacyFallback: 'explicit-only', policies: [{ id: 'p-team', kind: 'group-span', sheetId: 'sheet-1', regionId: 'r1', target: { kind: 'template-cell', templateCellId: 'team', subject: 'row-member-label' }, enabled: true, direction: 'auto', boundary: 'parent-group', source: 'user', sequence: 1 }], suppressions: [] };
  const g = expandCellDrivenTemplate(d, rows).grid; assert.ok(g.merges.length >= 2);
  const cancelled = snap(g); cancelled.sheets['sheet-1'].mergeData = [];
  const saved = JSON.parse(JSON.stringify(syncDocumentFromWorkbookSnapshot(d, cancelled, 'preview', g)));
  const c = compileCellReport(saved, rows); assert.equal(c.valid, true);
  assert.equal(c.publication.sheets[0].merges.length, 0, '取消快照未生成关闭策略或成员例外，重编译后合并重新出现');
});

await mkdir(out, { recursive: true });
const summary = { timestamp: new Date().toISOString(), scope: '共享v2展开器、编译器、快照同步、JSON边界与VTable适配；自由入口检查已退役；非浏览器E2E', total: results.length, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results };
await writeFile(new URL('focused.json', out), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ total: summary.total, passed: summary.passed, failed: summary.failed }));
if (summary.failed) process.exitCode = 1;
