import { setPresentation } from '../test/helpers/presentation.mjs';
/** 独立复验边界条件；调用实际编译器、快照适配器和已安装SDK，不修改业务实现。 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { Univer, LocaleType } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import enUS from '@univerjs/sheets/locale/en-US';
import '@univerjs/sheets/facade';
import { compileCellReport, normalizeCellTemplate, expandCellTemplate, buildInstanceKey, encodeMemberTuple } from '../dist/esm/report-template/index.js';
import { syncDocumentFromWorkbookSnapshot } from '../dist/esm/cell-designer/syncWorkbookToTemplate.js';
import { attachUniverDesignerEvents } from '../dist/esm/cell-designer/univerEvents.js';

const example = JSON.parse(await readFile(new URL('../examples/cell-reports/workshop-delivery-quality.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../../dynamic-data-test/src/mockData.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { MOCK_INDUSTRIAL_2_TIME: facts } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const fresh = () => structuredClone(example);
const expand = (doc, data = facts) => expandCellTemplate(doc, normalizeCellTemplate(doc), data).grid;
const cellAt = (grid, row, col) => grid.cells.find((c) => c.row === row && c.col === col);
const targetBinding = (grid) => grid.bindings.find((b) => b.semantic.metricId === 'qty-sum' && b.semantic.role === 'metric-value' && cellAt(grid, b.target.row, b.target.column)?.value === 600);
function override(doc, binding, value = 999) {
  const base = cellAt(expand(doc), binding.target.row, binding.target.column)?.value;
  return {
    templateCellId: 'quantity',
    instanceKey: buildInstanceKey({ templateCellId: 'quantity', regionId: doc.regions[0].id,
      rowPath: encodeMemberTuple(binding.semantic.rowPath.map((p) => p.memberKey)),
      columnPath: encodeMemberTuple(binding.semantic.columnPath.map((p) => p.memberKey)),
      metricId: 'qty-sum', role: binding.semantic.role }),
    originalBaseValue: base, overrideValue: value, dataRevision: 'D0', status: 'active',
  };
}
function snapshot(grid, modify) {
  const cellData = {};
  for (const cell of grid.cells) {
    (cellData[cell.row] ||= {})[cell.col] = { v: cell.value };
  }
  modify?.(cellData);
  return { sheetOrder: ['sheet-1'], sheets: { 'sheet-1': { cellData, mergeData: [] } } };
}
function detail() {
  const doc = fresh();
  doc.regions[0].layoutKind = 'detail';
  doc.layoutRules = [];
  doc.cells = [{ id: 'detail-qty', sheetId: 'sheet-1', regionId: doc.regions[0].id, position: { row: 3, column: 0 },
    content: { kind: 'field', fieldId: 'output_qty', fieldKey: 'output_qty', role: 'detail-column', operation: 'list', expand: 'down' }, parents: { row: null, column: null } }];
  return doc;
}
const results = [];
async function check(id, requirement, name, fn) {
  try {
    const evidence = await fn();
    results.push({ id, requirement, name, passed: true, evidence });
    console.log(`PASS ${id} ${name}`);
  } catch (error) {
    results.push({ id, requirement, name, passed: false, error: error.message });
    console.log(`FAIL ${id} ${name}: ${error.message.split('\n')[0]}`);
  }
}

await check('RC-01', 'DCR-01', '分组多层成员解除全部合并后不自动合并', () => {
  const doc = fresh(); doc.regions[0].layoutKind = 'grouped'; doc.layoutRules = [];
  doc.cells.push({ id: 'part-group', sheetId: 'sheet-1', regionId: doc.regions[0].id, position: { row: 5, column: 1 },
    content: { kind: 'field', fieldId: 'part_name', fieldKey: 'part_name', role: 'row-dimension', operation: 'group', expand: 'down', displayName: '工件' }, parents: { row: 'workshop', column: null } });
  const result = compileCellReport(doc, facts);
  assert.equal(result.publication.sheets[0].merges.length, 0, '分组投影器重新补出了默认合并');
});

await check('RC-02', 'DCR-02/09', '未编辑的展开预览保存不生成任何人工覆盖', () => {
  const doc = fresh(); const g = expand(doc);
  const synced = syncDocumentFromWorkbookSnapshot(doc, snapshot(g), 'preview', g);
  assert.equal(synced.instanceOverrides.length, 0, `未编辑却生成${synced.instanceOverrides.length}条覆盖`);
});

await check('RC-03', 'DCR-02/09', '预览编辑600为999后保存能命中同一业务格', () => {
  const doc = fresh(); const g = expand(doc); const b = targetBinding(g);
  const synced = syncDocumentFromWorkbookSnapshot(doc, snapshot(g, (cells) => { cells[b.target.row][b.target.column].v = 999; }), 'preview', g);
  const updated = expand(synced);
  assert.equal(cellAt(updated, b.target.row, b.target.column)?.value, 999, '快照生成的实例键无法被展开器匹配');
  assert.equal(synced.instanceOverrides.length, 1, '只改一格不应冻结整个预览');
});

await check('RC-04', 'DCR-02', '非法实例键不能将同一度量全表改成999', () => {
  const doc = fresh(); const b = targetBinding(expand(doc));
  doc.instanceOverrides = [{ ...override(doc, b), instanceKey: 'broken-key' }];
  const result = compileCellReport(doc, facts);
  assert.ok(!result.valid || result.diagnostics.some((d) => /INSTANCE|KEY/.test(d.code)), '非法实例键被当成匹配所有行列的通配符');
});

await check('RC-05', 'DCR-02', '正确实例键仅影响目标业务格', () => {
  const doc = fresh(); const g = expand(doc); const b = targetBinding(g);
  doc.instanceOverrides = [override(doc, b)];
  const changed = expand(doc);
  assert.equal(cellAt(changed, b.target.row, b.target.column)?.value, 999);
  assert.equal(changed.cells.filter((c) => c.value === 999).length, 1);
  return { row: b.target.row, column: b.target.column };
});

await check('RC-06', 'DCR-02', '源值变化连续刷新仍报告未解决的覆盖冲突', () => {
  const doc = fresh(); doc.instanceOverrides = [override(doc, targetBinding(expand(doc)))];
  const changed = facts.map((r, i) => i === 0 ? { ...r, output_qty: 700 } : r);
  for (let i = 0; i < 2; i++) {
    const result = compileCellReport(doc, changed);
    assert.ok(result.diagnostics.some((d) => /CONFLICT/i.test(d.code)), '600变700仍静默套用999，未产生基线冲突诊断');
  }
});

await check('RC-07', 'DCR-02', '被编辑成员删除后产生归档或失效诊断', () => {
  const doc = fresh(); doc.instanceOverrides = [override(doc, targetBinding(expand(doc)))];
  const result = compileCellReport(doc, facts.filter((r) => r.workshop !== facts[0].workshop));
  assert.ok(result.diagnostics.some((d) => /ORPHAN|MISSING.*INSTANCE/i.test(d.code)) || doc.orphanedEdits.length > 0, '消失成员的编辑未归档也无诊断');
});

await check('RC-08', 'DCR-03', '模板格styleRules实际作用于展开度量', () => {
  const doc = fresh(); const b = targetBinding(expand(doc));
  doc.styleRules.push({ id: 'qty-style', sheetId: 'sheet-1', scope: 'template-cell', targetId: 'quantity', priority: 10, style: { backgroundColor: '#123456' } });
  assert.equal(cellAt(expand(doc), b.target.row, b.target.column)?.style?.bgColor, '#123456', 'styleRules仍未被执行');
});

await check('RC-09', 'DCR-03', '条件背景色不清掉原有加粗、字体色和数字格式', () => {
  const doc = fresh(); const b = targetBinding(expand(doc));
  setPresentation(doc,doc.cells.find(c=>c.content.metricId==='qty-sum').id,{operator:'gt',threshold:100,style:{backgroundColor:'#00FF00'}});
  const style = cellAt(expand(doc), b.target.row, b.target.column)?.style;
  assert.equal(style.bgColor, '#00FF00');
  assert.equal(style.bold, true, '背景色规则把原加粗覆盖成undefined');
  assert.equal(style.color, '#1677ff');
  assert.equal(style.format, '#,##0.00');
});

await check('RC-10', 'DCR-03', '缺失事实的null交叉格不被条件规则当作数值0', () => {
  const doc = fresh(); const before = expand(doc); const empty = before.cells.find((c) => c.metricId === 'qty-sum' && c.value === null);
  assert.ok(empty, '测试数据应存在空交叉格');
  setPresentation(doc,doc.cells.find(c=>c.content.metricId==='qty-sum').id,{operator:'eq',threshold:0,style:{backgroundColor:'#FF0000'}});
  assert.notEqual(cellAt(expand(doc), empty.row, empty.col)?.style?.bgColor, '#FF0000', 'Number(null)=0导致空格被错误高亮');
});

await check('RC-11', 'DCR-04', 'Excel引用公式SUM(K1:K2)应计算或明确阻断', () => {
  const doc = fresh();
  for (const [id, row, content] of [['f-a', 0, { kind: 'literal', value: 10 }], ['f-b', 1, { kind: 'literal', value: 20 }], ['f-sum', 2, { kind: 'sheet-formula', formula: '=SUM(K1:K2)' }]]) {
    doc.cells.push({ id, sheetId: 'sheet-1', position: { row, column: 10 }, content, parents: { row: null, column: null } });
  }
  const result = compileCellReport(doc, facts);
  const value = result.publication.sheets[0].cells.find((c) => c.r === 2 && c.c === 10)?.v;
  assert.ok(!result.valid || value === 30, `公式未计算、未阻断，直接发布${String(value)}`);
});

await check('RC-12', 'DCR-04', '除零不能以Infinity成功发布', () => {
  const doc = fresh(); doc.cells.push({ id: 'div-zero', sheetId: 'sheet-1', position: { row: 20, column: 10 }, content: { kind: 'sheet-formula', formula: '=1/0' }, parents: { row: null, column: null } });
  const result = compileCellReport(doc, facts);
  assert.ok(!result.valid || result.diagnostics.some((d) => /FORMULA|DIV|NON_FINITE/.test(d.code)), 'Infinity作为数值发布，序列化后还会变null');
});

await check('RC-13', 'DCR-05', '行父格和列父格混合环路应被阻断', () => {
  const doc = fresh();
  doc.cells.find((c) => c.id === 'workshop').parents.row = 'quantity';
  doc.cells.find((c) => c.id === 'quantity').parents.row = null;
  doc.cells.find((c) => c.id === 'quantity').parents.column = 'workshop';
  assert.equal(compileCellReport(doc, facts).valid, false, '只分别检查行链和列链，遗漏混合有向环');
});

await check('RC-14', 'DCR-06', '自由区与业务格碰撞返回错误而非覆盖', () => {
  const doc = fresh(); doc.cells.push({ id: 'collision', sheetId: 'sheet-1', position: { row: 4, column: 2 }, content: { kind: 'literal', value: '备注' }, parents: { row: null, column: null } });
  const result = compileCellReport(doc, facts);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((d) => d.code === 'ERR_REGION_CELL_COLLISION'));
});

await check('RC-15', 'DCR-07', '第二张静态表保留隐藏属性', () => {
  const doc = fresh(); doc.sheets.push({ id: 'notes', name: '隐藏说明', visible: false });
  doc.cells.push({ id: 'notes-text', sheetId: 'notes', position: { row: 0, column: 0 }, content: { kind: 'literal', value: '说明' }, parents: { row: null, column: null } });
  const sheet = compileCellReport(doc, facts).publication.sheets.find((s) => s.id === 'notes');
  assert.equal(sheet?.hidden, true, 'visible=false未映射hidden=true');
});

await check('RC-16', 'DCR-07', '无活动数据区域的静态工作表仍完整发布', () => {
  const doc = fresh(); doc.regions = []; doc.cells = doc.cells.filter((c) => !c.regionId);
  const result = compileCellReport(doc, []);
  assert.ok(result.publication.sheets[0].cells.some((c) => c.v === '车间交付与质量交叉报表'), 'normalize无plan后直接返回空表丢掉静态内容');
});

await check('RC-17', 'DCR-08', '数字1和字符串1为不同主键', () => {
  const result = compileCellReport(detail(), [{ id: 1, output_qty: 10 }, { id: '1', output_qty: 20 }]);
  assert.equal(result.valid, true, '主键校验String化后将不同类型错误判为重复');
});

await check('RC-18', 'DCR-08', '主键缺失必须明确诊断而非静默退回行号', () => {
  const result = compileCellReport(detail(), [{ output_qty: 10 }, { output_qty: 20 }]);
  assert.ok(!result.valid || result.diagnostics.some((d) => /PRIMARY|IDENTITY/.test(d.code)), '缺失主键仍valid=true且无诊断');
});

await check('RC-19', 'DCR-08', '已接受的_id主键在明细重排后仍为同一实例', () => {
  const doc = detail(); const data = [{ _id: 'a', output_qty: 10 }, { _id: 'b', output_qty: 20 }];
  function keyFor(g) { const c = g.cells.find((c) => c.value === 10); return g.bindings.find((b) => b.target.row === c.row && b.target.column === c.col)?.instanceKey; }
  assert.equal(keyFor(expand(doc, data)), keyFor(expand(doc, [...data].reverse())), '唯一性检查接受_id，实例展开却仍用行号');
});

await check('RC-20', 'DCR-09', '工具栏取消加粗能从工作簿落回源模板', () => {
  const doc = fresh();
  const synced = syncDocumentFromWorkbookSnapshot(doc, { sheetOrder: ['sheet-1'], sheets: { 'sheet-1': { cellData: { 4: { 2: { v: '{交付件数}', s: { bl: 0 } } } } } } }, 'design');
  assert.notEqual(synced.cells.find((c) => c.id === 'quantity')?.style?.bold, true, 'bl=0被忽略，旧bold=true恢复');
});

await check('RC-21', 'DCR-09', '工作簿清空静态格不会在保存后复活旧值', () => {
  const doc = fresh();
  const synced = syncDocumentFromWorkbookSnapshot(doc, { sheetOrder: ['sheet-1'], sheets: { 'sheet-1': { cellData: { 0: { 0: { v: null } } } } } }, 'design');
  const cell = synced.cells.find((c) => c.id === 'title');
  assert.ok(!cell || cell.content.value === '' || cell.content.value === null, 'v=null被跳过而保留旧标题');
});

await check('RC-22', 'DCR-09', '真实SDK程序网格写入不应登记成用户编辑', async () => {
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: enUS } });
  univer.registerPlugin(UniverSheetsPlugin);
  const api = FUniver.newAPI(univer);
  try {
    const workbook = api.createWorkbook({ id: 'recheck-program', sheetOrder: ['sheet-1'], sheets: { 'sheet-1': { id: 'sheet-1', name: '测试', rowCount: 30, columnCount: 20, cellData: {} } } });
    const edits = [];
    const dispose = attachUniverDesignerEvents(api, { onCellEdited: (e) => edits.push(e) });
    api.__isProgrammaticWrite = true;
    await workbook.getActiveSheet().getRange(0, 0).setValue({ v: '程序刷新', t: 1 });
    await Promise.resolve();
    dispose();
    assert.equal(edits.length, 0, `已有程序写入标记仍回传${edits.length}条用户编辑`);
  } finally { univer.dispose(); }
});

const manifest = JSON.parse(await readFile(new URL('../../dynamic-data-test/dist/.vite/manifest.json', import.meta.url), 'utf8'));
function closure(entry) {
  const keys = new Set();
  const visit = (key) => { if (keys.has(key) || !manifest[key]) return; keys.add(key); for (const item of manifest[key].imports || []) visit(item); };
  visit(entry); return [...keys];
}
await check('RC-23', 'DCR-10', '生产入口静态依赖图不包含Univer预览及设计器', () => {
  const entry = Object.keys(manifest).find((k) => manifest[k].isEntry);
  const graph = closure(entry);
  assert.ok(!graph.some((k) => /UniverPreview|HybridReportEditModal|DashboardEditModal|univerAcceptance/.test(k)), graph.join(','));
  return { entry, staticImports: graph.map((k) => manifest[k].file), dynamicImports: manifest[entry].dynamicImports };
});
await check('RC-24', 'DCR-10/新回归', '模式三编辑入口加载Univer CSS，图表入口保持隔离', () => {
  const cellEntry = Object.keys(manifest).find((k) => /HybridReportEditModal\.tsx$/.test(k));
  const panelEntry = Object.keys(manifest).find((k) => /DashboardEditModal\.tsx$/.test(k));
  assert.ok(cellEntry && panelEntry);
  const cellCSS = new Set(closure(cellEntry).flatMap((k) => manifest[k].css || []));
  const panelCSS = new Set(closure(panelEntry).flatMap((k) => manifest[k].css || []));
  assert.ok(cellCSS.size > 0 && ![...panelCSS].some((css) => cellCSS.has(css)), `单元格入口CSS=${[...cellCSS].join(',') || '空'}；原面板CSS=${[...panelCSS].join(',')}`);
});

const outDir = process.argv[2]
  ? pathToFileURL(resolve(process.argv[2]) + '/')
  : new URL('../doc/verification/cell-recheck-2026-10-19/', import.meta.url);
await mkdir(outDir, { recursive: true });
const summary = { timestamp: new Date().toISOString(), scope: '实际编译器/快照/已安装SDK/生产manifest；浏览器证据另存', total: results.length, passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length, results };
await writeFile(new URL('extended.json', outDir), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ total: summary.total, passed: summary.passed, failed: summary.failed }));
if (summary.failed) process.exitCode = 1;
