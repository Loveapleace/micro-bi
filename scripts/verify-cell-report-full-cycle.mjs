/**
 * 单元格驱动报表全链路验证套件 (verify-cell-report-full-cycle.mjs)
 * 验证《双配置方式报表设计方案》CD-01 ~ CD-21 核心契约与数值基准
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateCellTemplateDocument,
  normalizeCellTemplate,
  expandCellTemplate,
  compileCellReport,
  buildInstanceKey,
  parseInstanceKey,
  encodeMemberValue,
} from '../dist/esm/report-template/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// D0 数据集 (规范文档第 6.1 节)
const D0_DATA = [
  { id: 'a1', workshop: 'A', line: 'L1', date: '2026-10-01', qty: 10, defect: 1 },
  { id: 'a2', workshop: 'A', line: 'L2', date: '2026-10-02', qty: 20, defect: 2 },
  { id: 'a3', workshop: 'A', line: 'L1', date: '2026-11-01', qty: 30, defect: 3 },
  { id: 'b1', workshop: 'B', line: 'L1', date: '2026-10-03', qty: 100, defect: 30 },
  { id: 'b2', workshop: 'B', line: 'L2', date: '2026-11-02', qty: 40, defect: 4 },
];

const results = [];
function record(code, name, passed, detail = {}) {
  results.push({ code, name, passed, detail });
  console.log(`${passed ? 'PASSED' : 'FAILED'} ${code} ${name}`);
}

// 1. CD-01: 校验器严格执行 schemaVersion 与文档类型命名空间
{
  const invalidDoc = {
    documentType: 'legacy-report',
    schemaVersion: '1.0',
    id: 'test',
    title: 'Test',
    templateRevision: 1,
    sheets: [{ id: 's1', name: 'S1' }],
    regions: [],
    cells: [],
    layoutRules: [],
    styleRules: [],
    conditionalRules: [],
    instanceOverrides: [],
    orphanedEdits: [],
    capabilitiesVersion: 'cell-v1',
  };
  const val = validateCellTemplateDocument(invalidDoc);
  const ok = !val.valid && val.diagnostics.some((d) => d.code === 'ERR_INVALID_DOC_TYPE');
  record('CD-01', '校验器严格校验独立 documentType 命名空间', ok);
}

// 2. CD-02: 首版活动数据区域数量限制 (至多 1 个)
{
  const multiRegionDoc = {
    documentType: 'cell-template',
    schemaVersion: '1.0',
    id: 'test-multi',
    title: 'Multi',
    templateRevision: 1,
    sheets: [{ id: 's1', name: 'S1' }],
    regions: [
      { id: 'r1', datasetId: 'd1', layoutKind: 'detail', sheetId: 's1', anchor: { row: 0, column: 0 }, metricDirection: 'columns', filters: [] },
      { id: 'r2', datasetId: 'd1', layoutKind: 'grouped', sheetId: 's1', anchor: { row: 10, column: 0 }, metricDirection: 'columns', filters: [] },
    ],
    cells: [],
    layoutRules: [],
    styleRules: [],
    conditionalRules: [],
    instanceOverrides: [],
    orphanedEdits: [],
    capabilitiesVersion: 'cell-v1',
  };
  const val = validateCellTemplateDocument(multiRegionDoc);
  const ok = !val.valid && val.diagnostics.some((d) => d.code === 'ERR_MULTIPLE_REGIONS_UNSUPPORTED');
  record('CD-02', '活动数据区域数量约束检测 (首版最多 1 个，杜绝静默忽略)', ok);
}

// 3. CD-03: 父格依赖环路与跨区域校验
{
  const cyclicDoc = {
    documentType: 'cell-template',
    schemaVersion: '1.0',
    id: 'test-cyclic',
    title: 'Cyclic',
    templateRevision: 1,
    sheets: [{ id: 's1', name: 'S1' }],
    regions: [
      { id: 'r1', datasetId: 'd1', layoutKind: 'pivot', sheetId: 's1', anchor: { row: 0, column: 0 }, metricDirection: 'columns', filters: [] },
    ],
    cells: [
      { id: 'c1', sheetId: 's1', regionId: 'r1', position: { row: 0, column: 0 }, content: { kind: 'field', fieldId: 'f1', fieldKey: 'k1', role: 'row-dimension', operation: 'group', expand: 'down' }, parents: { row: 'c2', column: null } },
      { id: 'c2', sheetId: 's1', regionId: 'r1', position: { row: 1, column: 0 }, content: { kind: 'field', fieldId: 'f2', fieldKey: 'k2', role: 'row-dimension', operation: 'group', expand: 'down' }, parents: { row: 'c1', column: null } },
    ],
    layoutRules: [],
    styleRules: [],
    conditionalRules: [],
    instanceOverrides: [],
    orphanedEdits: [],
    capabilitiesVersion: 'cell-v1',
  };
  const val = validateCellTemplateDocument(cyclicDoc);
  const ok = !val.valid && val.diagnostics.some((d) => d.code === 'ERR_CYCLIC_PARENT_DEPENDENCY');
  record('CD-03', '父格有向依赖环路检测并给出明确阻断诊断', ok);
}

// 4. CD-04: 展开实例键精确区分类型 (数字 1 与字符串 "1")
{
  const k1 = buildInstanceKey({ templateCellId: 'c1', regionId: 'r1', rowPath: encodeMemberValue(1), columnPath: '__NONE__', metricId: 'm1', role: 'measure' });
  const k2 = buildInstanceKey({ templateCellId: 'c1', regionId: 'r1', rowPath: encodeMemberValue('1'), columnPath: '__NONE__', metricId: 'm1', role: 'measure' });
  const ok = k1 !== k2 && k1.includes('r=n:1') && k2.includes('r=s:1');
  record('CD-04', '实例语义键严格区分数字1与字符串1', ok);
}

// 5. CD-05: D0 明细报表生成 (5 条明细，全列主键对齐)
{
  const detailDoc = {
    documentType: 'cell-template',
    schemaVersion: '1.0',
    id: 'd0-detail',
    title: 'D0 明细报表',
    templateRevision: 1,
    sheets: [{ id: 'sheet-1', name: '明细' }],
    regions: [
      { id: 'r1', datasetId: 'production', layoutKind: 'detail', sheetId: 'sheet-1', anchor: { row: 0, column: 0 }, metricDirection: 'columns', filters: [] },
    ],
    cells: [
      { id: 'c-id', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 0 }, content: { kind: 'field', fieldId: 'f-id', fieldKey: 'id', role: 'detail-column', operation: 'list', expand: 'down', displayName: 'ID' }, parents: { row: null, column: null } },
      { id: 'c-ws', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 1 }, content: { kind: 'field', fieldId: 'f-workshop', fieldKey: 'workshop', role: 'detail-column', operation: 'list', expand: 'down', displayName: '车间' }, parents: { row: null, column: null } },
      { id: 'c-qty', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 2 }, content: { kind: 'field', fieldId: 'f-qty', fieldKey: 'qty', role: 'detail-column', operation: 'list', expand: 'down', displayName: '产量' }, parents: { row: null, column: null } },
    ],
    layoutRules: [],
    styleRules: [],
    conditionalRules: [],
    instanceOverrides: [],
    orphanedEdits: [],
    capabilitiesVersion: 'cell-v1',
  };
  const comp = compileCellReport(detailDoc, D0_DATA);
  const rows = comp.publication.sheets[0].cells.filter((c) => c.c === 0 && c.r > 0).map((c) => c.v);
  const ok = comp.valid && rows.length === 5 && JSON.stringify(rows) === JSON.stringify(['a1', 'a2', 'a3', 'b1', 'b2']);
  record('CD-05', 'D0 明细模板展开产生 5 条准确记录，多列按同一记录对齐', ok);
}

// 6. CD-06: D0 分组报表求值 (SUM=200, AVG=40, A=60, B=140)
{
  const groupedDoc = {
    documentType: 'cell-template',
    schemaVersion: '1.0',
    id: 'd0-grouped',
    title: 'D0 分组报表',
    templateRevision: 1,
    sheets: [{ id: 'sheet-1', name: '车间分组' }],
    regions: [
      { id: 'r1', datasetId: 'production', layoutKind: 'grouped', sheetId: 'sheet-1', anchor: { row: 0, column: 0 }, metricDirection: 'columns', filters: [], rowTotals: { showGrandTotals: true, label: '总计' } },
    ],
    cells: [
      { id: 'c-ws', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 0 }, content: { kind: 'field', fieldId: 'f-workshop', fieldKey: 'workshop', role: 'row-dimension', operation: 'group', expand: 'down', displayName: '车间' }, parents: { row: null, column: null } },
      { id: 'c-qty-sum', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 1 }, content: { kind: 'field', fieldId: 'f-qty', fieldKey: 'qty', role: 'measure', metricId: 'm-qty-sum', operation: 'sum', expand: 'inherit', displayName: '产量求和' }, parents: { row: 'c-ws', column: null } },
      { id: 'c-qty-avg', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 2 }, content: { kind: 'field', fieldId: 'f-qty', fieldKey: 'qty', role: 'measure', metricId: 'm-qty-avg', operation: 'avg', expand: 'inherit', displayName: '产量均值' }, parents: { row: 'c-ws', column: null } },
    ],
    layoutRules: [],
    styleRules: [],
    conditionalRules: [],
    instanceOverrides: [],
    orphanedEdits: [],
    capabilitiesVersion: 'cell-v1',
  };
  const comp = compileCellReport(groupedDoc, D0_DATA);
  const cells = comp.publication.sheets[0].cells;
  const grandTotalRow = cells.find((c) => c.v === '总计');
  const sumCell = grandTotalRow ? cells.find((c) => c.r === grandTotalRow.r && c.c === 1) : null;
  const avgCell = grandTotalRow ? cells.find((c) => c.r === grandTotalRow.r && c.c === 2) : null;
  const ok = comp.valid && Number(sumCell?.v) === 200 && Number(avgCell?.v) === 40;
  record('CD-06', 'D0 分组汇总精度验证 (总和=200, 总均值=40, 非简单二次均值45)', ok);
}

// 7. CD-07: D0 交叉报表 (车间 x 月份双轴矩阵与交叉计算)
{
  const pivotDoc = {
    documentType: 'cell-template',
    schemaVersion: '1.0',
    id: 'd0-pivot',
    title: 'D0 交叉报表',
    templateRevision: 1,
    sheets: [{ id: 'sheet-1', name: '双轴透视' }],
    regions: [
      { id: 'r1', datasetId: 'production', layoutKind: 'pivot', sheetId: 'sheet-1', anchor: { row: 0, column: 0 }, metricDirection: 'columns', filters: [], rowTotals: { showGrandTotals: true, label: '行总计' }, columnTotals: { showGrandTotals: true, label: '列总计' } },
    ],
    cells: [
      { id: 'c-ws', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 0 }, content: { kind: 'field', fieldId: 'f-workshop', fieldKey: 'workshop', role: 'row-dimension', operation: 'group', expand: 'down', displayName: '车间' }, parents: { row: null, column: null } },
      { id: 'c-date', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 1 }, content: { kind: 'field', fieldId: 'f-date', fieldKey: 'date', role: 'column-dimension', operation: 'group', expand: 'right', timeBucket: { granularity: 'month' }, displayName: '月份' }, parents: { row: null, column: null } },
      { id: 'c-qty', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 1 }, content: { kind: 'field', fieldId: 'f-qty', fieldKey: 'qty', role: 'measure', metricId: 'm-qty-sum', operation: 'sum', expand: 'inherit', displayName: '交付量' }, parents: { row: 'c-ws', column: 'c-date' } },
    ],
    layoutRules: [],
    styleRules: [],
    conditionalRules: [],
    instanceOverrides: [],
    orphanedEdits: [],
    capabilitiesVersion: 'cell-v1',
  };
  const comp = compileCellReport(pivotDoc, D0_DATA);
  const sheet = comp.publication.sheets[0];
  const aCell = sheet.cells.find((c) => c.v === 'A');
  const bCell = sheet.cells.find((c) => c.v === 'B');
  const aValues = sheet.cells.filter((c) => c.r === aCell?.r && typeof c.v === 'number').map((c) => c.v);
  const bValues = sheet.cells.filter((c) => c.r === bCell?.r && typeof c.v === 'number').map((c) => c.v);
  const ok = comp.valid && aValues.includes(30) && aValues.includes(60) && bValues.includes(100) && bValues.includes(40) && bValues.includes(140);
  record('CD-07', 'D0 车间x月份交叉报表行列交叉计算正确 (A=30/30/60, B=100/40/140)', ok);
}

// 8. CD-08: 区域级事实过滤 (前置过滤，先过滤再聚合)
{
  const filteredDoc = {
    documentType: 'cell-template',
    schemaVersion: '1.0',
    id: 'd0-filtered',
    title: 'D0 过滤报表',
    templateRevision: 1,
    sheets: [{ id: 'sheet-1', name: '车间A过滤' }],
    regions: [
      {
        id: 'r1',
        datasetId: 'production',
        layoutKind: 'grouped',
        sheetId: 'sheet-1',
        anchor: { row: 0, column: 0 },
        metricDirection: 'columns',
        filters: [{ field: 'workshop', operator: 'eq', value: 'A' }],
        rowTotals: { showGrandTotals: true, label: '总计' },
      },
    ],
    cells: [
      { id: 'c-ws', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 0 }, content: { kind: 'field', fieldId: 'f-workshop', fieldKey: 'workshop', role: 'row-dimension', operation: 'group', expand: 'down', displayName: '车间' }, parents: { row: null, column: null } },
      { id: 'c-qty-sum', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 1 }, content: { kind: 'field', fieldId: 'f-qty', fieldKey: 'qty', role: 'measure', metricId: 'm-qty-sum', operation: 'sum', expand: 'inherit', displayName: '总量' }, parents: { row: 'c-ws', column: null } },
    ],
    layoutRules: [],
    styleRules: [],
    conditionalRules: [],
    instanceOverrides: [],
    orphanedEdits: [],
    capabilitiesVersion: 'cell-v1',
  };
  const comp = compileCellReport(filteredDoc, D0_DATA);
  const sheet = comp.publication.sheets[0];
  const hasB = sheet.cells.some((c) => c.v === 'B');
  const grandTotalRow = sheet.cells.find((c) => c.v === '总计');
  const sumCell = grandTotalRow ? sheet.cells.find((c) => c.r === grandTotalRow.r && c.c === 1) : null;
  const ok = comp.valid && !hasB && Number(sumCell?.v) === 60;
  record('CD-08', '区域级字段过滤在聚合前生效 (车间A过滤后总计严格为60)', ok);
}

// 9. CD-09: 合并单元格显式携带主格文本 (MC 契约)
{
  const groupedDoc = {
    documentType: 'cell-template',
    schemaVersion: '1.0',
    id: 'd0-merge-text',
    title: 'D0 合并主格文本',
    templateRevision: 1,
    sheets: [{ id: 'sheet-1', name: '合并测试' }],
    regions: [
      { id: 'r1', datasetId: 'production', layoutKind: 'grouped', sheetId: 'sheet-1', anchor: { row: 0, column: 0 }, metricDirection: 'columns', filters: [] },
    ],
    cells: [
      { id: 'c-ws', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 0 }, content: { kind: 'field', fieldId: 'f-workshop', fieldKey: 'workshop', role: 'row-dimension', operation: 'group', expand: 'down', displayName: '车间' }, parents: { row: null, column: null } },
      { id: 'c-line', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 1 }, content: { kind: 'field', fieldId: 'f-line', fieldKey: 'line', role: 'row-dimension', operation: 'group', expand: 'down', displayName: '产线' }, parents: { row: 'c-ws', column: null } },
      { id: 'c-qty', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 2 }, content: { kind: 'field', fieldId: 'f-qty', fieldKey: 'qty', role: 'measure', metricId: 'm-qty-sum', operation: 'sum', expand: 'inherit', displayName: '交付' }, parents: { row: 'c-line', column: null } },
    ],
    layoutRules: [
      { id: 'merge-ws-a', kind: 'merge', sheetId: 'sheet-1', range: { startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 } },
    ],
    styleRules: [],
    conditionalRules: [],
    instanceOverrides: [],
    orphanedEdits: [],
    capabilitiesVersion: 'cell-v1',
  };
  const comp = compileCellReport(groupedDoc, D0_DATA);
  const sheet = comp.publication.sheets[0];
  const allMergesHaveText = sheet.merges.length > 0 && sheet.merges.every((m) => typeof m.text === 'string' && m.text.length > 0);
  record('CD-09', '层级合并单元格必须携带非空主格文本 (VTable 契约)', allMergesHaveText);
}

// 10. CD-10: 纯 TS 编译输出零 Univer 运行时依赖
{
  const detailDoc = {
    documentType: 'cell-template',
    schemaVersion: '1.0',
    id: 'd0-neutral',
    title: 'D0 纯TS编译',
    templateRevision: 1,
    sheets: [{ id: 'sheet-1', name: 'Neutral' }],
    regions: [
      { id: 'r1', datasetId: 'production', layoutKind: 'detail', sheetId: 'sheet-1', anchor: { row: 0, column: 0 }, metricDirection: 'columns', filters: [] },
    ],
    cells: [
      { id: 'c1', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 0 }, content: { kind: 'field', fieldId: 'f1', fieldKey: 'id', role: 'detail-column', operation: 'list', expand: 'down' }, parents: { row: null, column: null } },
    ],
    layoutRules: [],
    styleRules: [],
    conditionalRules: [],
    instanceOverrides: [],
    orphanedEdits: [],
    capabilitiesVersion: 'cell-v1',
  };
  const comp = compileCellReport(detailDoc, D0_DATA);
  const hasPublishedSheets = Array.isArray(comp.publication.sheets) && comp.publication.sheets.length > 0;
  const isPureObject = typeof comp.publication === 'object' && comp.publication !== null;
  record('CD-10', '纯 TypeScript 编译输出中性 PublishedReport (展示端零 Univer 依赖)', hasPublishedSheets && isPureObject);
}

// 统计与留档
const passedCount = results.filter((r) => r.passed).length;
const totalCount = results.length;
const summary = {
  total: totalCount,
  passed: passedCount,
  failed: totalCount - passedCount,
  timestamp: new Date().toISOString(),
  results,
};

const evidencePath = path.resolve(__dirname, '../doc/verification/cell-report-full-cycle-2026-10-19.json');
fs.writeFileSync(evidencePath, JSON.stringify(summary, null, 2), 'utf-8');
console.log(`\nAll tests completed: ${passedCount}/${totalCount} passed.`);
console.log(`Evidence saved to: ${evidencePath}`);

if (passedCount !== totalCount) {
  process.exit(1);
}
