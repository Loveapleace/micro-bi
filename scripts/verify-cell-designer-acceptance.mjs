/** 主应用实现验收诊断。真实编译器/适配器；不冒充浏览器 E2E。缺口用例应返回非零。 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { compileCellReport, normalizeCellTemplate, expandCellTemplate, buildInstanceKey } from '../dist/esm/report-template/index.js';
import { syncDocumentFromWorkbookSnapshot } from '../dist/esm/cell-designer/syncWorkbookToTemplate.js';
import { adaptPublishedSheetToVTable } from '../dist/esm/ui/presentation/report/gridAdapter.js';
const template = JSON.parse(await readFile(new URL('../examples/cell-reports/workshop-delivery-quality.json', import.meta.url), 'utf8'));
const mockSource = await readFile(new URL('../../dynamic-data-test/src/mockData.ts', import.meta.url), 'utf8');
const mockJS = ts.transpileModule(mockSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { MOCK_INDUSTRIAL_2_TIME: data } = await import(`data:text/javascript;base64,${Buffer.from(mockJS).toString('base64')}`);
const fresh = () => structuredClone(template);
const results = [];
async function check(id, name, specification, fn, expectedGap = false) {
  try {
    const evidence = await fn();
    results.push({ id, name, specification, passed: true, expectedGap, evidence });
    console.log(`PASS ${id} ${name}`);
  } catch (err) {
    results.push({ id, name, specification, passed: false, expectedGap, error: err.message });
    console.log(`FAIL ${id} ${name}: ${err.message.split('\n')[0]}`);
  }
}
const compile = (doc = fresh(), facts = data) => {
  const result = compileCellReport(doc, facts);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  return result;
};
const grid = (doc, facts = data) => expandCellTemplate(doc, normalizeCellTemplate(doc), facts).grid;
const cellFor = (g, id, workshop, date, role = 'metric-value') => g.cells.find((c) => c.metricId === id && c.role === role &&
  (!workshop || (c.rowPath || []).some((p) => p.memberKey === workshop)) &&
  (!date || (c.colPath || c.columnPath || []).some((p) => p.memberKey === date)));

await check('AC-01', '现有13条工单的总量和加权缺陷率', 'CD-18/19/21', () => {
  const r = compile();
  const values = r.publication.sheets[0].cells;
  assert.ok(values.some((c) => c.v === 10850 && c.displayText === '10,850.00'));
  assert.ok(values.some((c) => c.v === 237));
  assert.ok(values.some((c) => c.v === 0.021843 && c.displayText === '2.18%'));
  return { facts: data.length, totalQty: 10850, totalDefects: 237, weightedDefectRate: '2.18%' };
});
await check('AC-02', '新增日期、删除日期、顺序重排后格式仍生效', 'CD-23/24/25/27', () => {
  const variants = [ [...data].reverse(), data.filter((r) => !r.plan_start_time.startsWith('2026-08-05')),
    [...data, { ...data[0], order_code: 'QA-NEW', plan_start_time: '2026-09-01', output_qty: 50, defect_count: 5 }] ];
  for (const facts of variants) {
    const g = grid(fresh(), facts);
    assert.ok(g.cells.some((c) => c.role === 'grand-total' && c.metricId === 'qty-sum' && c.value === facts.reduce((n, r) => n + r.output_qty, 0)));
    for (const c of g.cells.filter((c) => c.metricId === 'defect-rate' && typeof c.value === 'number')) {
      assert.equal(c.style.bold, true);
      assert.equal(c.style.color, '#d46b08');
      assert.match(c.displayText, /%$/);
    }
  }
  return { variants: variants.length, addedTotalQty: 10900 };
});
await check('AC-03', '指标方向切换与分组报表复用', 'CD-17/20/26', () => {
  for (const layoutKind of ['pivot', 'grouped']) {
    for (const metricDirection of ['columns', 'rows']) {
      const doc = fresh(); Object.assign(doc.regions[0], { layoutKind, metricDirection });
      const r = compile(doc);
      assert.ok(r.publication.sheets[0].cells.some((c) => c.v === 10850));
      assert.ok(r.publication.sheets[0].cells.some((c) => c.v === 0.021843 && c.displayText === '2.18%'));
    }
  }
  return { layouts: 2, directions: 2 };
});
await check('AC-04', '标题、非零锚点、合并文字与VTable格式', 'CD-36/38（局部）', () => {
  const r = compile(); const s = r.publication.sheets[0];
  const a = adaptPublishedSheetToVTable(s, r.publication.styles);
  assert.equal(a.records[0].col_0, '车间交付与质量交叉报表');
  assert.equal(a.records[3].col_0, '承制车间');
  assert.equal(a.customMergeCell.find((m) => m.range.start.row === 0).text, a.records[0].col_0);
  assert.equal(a.columns[0].width, 180);
  assert.ok(a.records.some((r) => Object.values(r).includes('2.18%')));
  return { title: a.records[0].col_0, anchorRow: 3, firstColumnWidth: 180 };
});
await check('AC-05', 'ready-empty不保留旧业务数值', 'CD-22（编译部分）', () => {
  const r = compile(fresh(), []);
  assert.ok(!r.publication.sheets[0].cells.some((c) => c.v === 10850));
  return { numericValues: r.publication.sheets[0].cells.filter((c) => typeof c.v === 'number').map((c) => c.v) };
});

await check('CX-01', 'Excel解除合并应在保存与刷新后保留', 'CD-30', () => {
  const doc = fresh(); doc.layoutRules = [];
  const s = compile(doc).publication.sheets[0];
  assert.equal(s.merges.length, 0, '清空用户合并后，投影器仍重新生成默认合并；UI操作也没有回写模板');
}, true);
await check('CX-02', '实例人工覆盖999应被编译器消费', 'CD-24/25/29', () => {
  const doc = fresh(); const p = normalizeCellTemplate(doc); const g = grid(doc);
  const b = g.bindings.find((b) => b.semantic.metricId === 'qty-sum' && b.semantic.role === 'metric-value');
  doc.instanceOverrides.push({ instanceKey: buildInstanceKey({ templateCellId: 'quantity', regionId: p.regionId, rowPath: JSON.stringify(b.semantic.rowPath), columnPath: JSON.stringify(b.semantic.columnPath), metricId: 'qty-sum', role: 'measure' }), templateCellId: 'quantity', originalBaseValue: 600, overrideValue: 999, dataRevision: 'D0', status: 'active' });
  assert.ok(compile(doc).publication.sheets[0].cells.some((c) => c.v === 999), 'instanceOverrides完全未被展开器消费');
}, true);
await check('CX-03', '样式规则和条件格式必须在新数据上重算', 'CD-36', () => {
  const doc = fresh(); doc.conditionalRules.push({ id: 'high-qty', sheetId: 'sheet-1', regionId: 'delivery-region', targetMetricId: 'qty-sum', condition: { operator: 'gt', values: [100] }, style: { backgroundColor: '#ff0000' }, priority: 1 });
  const target = cellFor(grid(doc), 'qty-sum', data[0].workshop, '2026-08-01');
  assert.equal(target.style.bgColor, '#ff0000', 'conditionalRules未被执行');
}, true);
await check('CX-04', 'Excel工作表公式应执行或明确阻断发布', 'CD-12/37/39', () => {
  const doc = fresh(); doc.cells.push({ id: 'manual-formula', sheetId: 'sheet-1', position: { row: 20, column: 0 }, content: { kind: 'sheet-formula', formula: '=1+1' }, parents: { row: null, column: null } });
  const r = compileCellReport(doc, data);
  assert.ok(!r.valid || r.publication.sheets[0].cells.some((c) => c.r === 20 && c.c === 0 && c.v === 2), 'sheet-formula被静默丢弃但valid=true');
}, true);
await check('CX-05', '列父格环路应阻断发布', 'CD-39', () => {
  const doc = fresh(); doc.cells.find((c) => c.id === 'plan-date').parents.column = 'quantity';
  const result = compileCellReport(doc, data);
  assert.equal(result.valid, false, 'quantity与plan-date形成列父格循环，却通过校验');
}, true);
await check('CX-06', '自由区碰撞不得覆盖自动数据', 'CD-31', () => {
  const doc = fresh(); doc.cells.push({ id: 'collision', sheetId: 'sheet-1', position: { row: 4, column: 2 }, content: { kind: 'literal', value: '冲突备注' }, parents: { row: null, column: null } });
  const result = compileCellReport(doc, data);
  assert.equal(result.valid, false, '标题/备注覆盖数据格但编译仍成功');
}, true);
await check('CX-07', '第二张静态表不能丢失或串入第一张', 'CD-38', () => {
  const doc = fresh(); doc.sheets.push({ id: 'notes', name: '说明' });
  doc.cells.push({ id: 'notes-text', sheetId: 'notes', position: { row: 0, column: 0 }, content: { kind: 'literal', value: '第二张说明页' }, parents: { row: null, column: null } });
  const r = compile(doc);
  assert.equal(r.publication.sheets.length, 2, '编译仅返回活动数据区域所在的一张表');
}, true);
await check('CX-08', '主键缺失或重复时应诊断身份问题', 'CD-16', () => {
  const doc = fresh(); doc.regions[0].layoutKind = 'detail';
  doc.cells = [{ id: 'detail-qty', sheetId: 'sheet-1', regionId: 'delivery-region', position: { row: 3, column: 0 }, content: { kind: 'field', fieldId: 'output_qty', fieldKey: 'output_qty', role: 'detail-column', operation: 'list', expand: 'down' }, parents: { row: null, column: null } }];
  const r = compileCellReport(doc, [{ id: 'same', output_qty: 1 }, { id: 'same', output_qty: 2 }]);
  assert.ok(!r.valid || r.diagnostics.some((d) => /key|id|identity/i.test(d.code)), '重复主键未诊断；现有实现还在缺少id时退回行号');
}, true);
await check('CX-09', '原生编辑快照同步回写模板与发布模型', 'CD-12/32/35/37', () => {
  const doc = fresh();
  const mockSnapshot = {
    sheetOrder: ['sheet-1'],
    sheets: {
      'sheet-1': {
        cellData: {
          0: { 0: { v: '画布编辑验收' } },
        },
      },
    },
  };
  const synced = syncDocumentFromWorkbookSnapshot(doc, mockSnapshot, 'design');
  const compiled = compileCellReport(synced, data);
  assert.equal(compiled.publication.sheets[0].cells.find((c) => c.r === 0 && c.c === 0).v, '画布编辑验收');
  return { updatedTitle: '画布编辑验收' };
}, true);
await check('CX-10', '展示首页入口完全剥离 Univer 依赖', 'CD-06', async () => {
  const indexHtml = await readFile(new URL('../../dynamic-data-test/dist/index.html', import.meta.url), 'utf8');
  assert.ok(!indexHtml.includes('UniverPreview'), 'index.html 不得静态加载 UniverPreview');
  assert.ok(!indexHtml.includes('preset-sheets-core'), 'index.html 不得静态引入 Univer CSS');
  return { entryHtml: 'index.html isolated from Univer' };
}, true);

const summary = { timestamp: new Date().toISOString(), scope: 'Node真实编译/适配诊断；浏览器验收另见Markdown记录', total: results.length, passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length, results };
const output = process.argv[2]
  ? pathToFileURL(resolve(process.argv[2]))
  : new URL('../doc/verification/cell-designer-acceptance-2026-10-19.json', import.meta.url);
await mkdir(new URL('./', output), { recursive: true });
await writeFile(output, JSON.stringify(summary, null, 2));
console.log(`${summary.passed}/${summary.total} passed; ${summary.failed} open gaps.`);
if (summary.failed) process.exitCode = 1;
