import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBiGrid,
  biGridToUniverWorksheetData,
} from '../dist/esm/report/index.js';
import { compileReport } from '../dist/esm/univer/index.js';
import { adaptPublishedSheetToVTable } from '../dist/esm/ui/presentation/report/gridAdapter.js';

test('reportCompiler: 将 Univer 快照规范化编译为 PublishedReport 并生成样式字典', () => {
  const mockSnapshot = {
    id: 'wb-test-1',
    name: '测试工作簿',
    sheetOrder: ['sheet-01'],
    styles: {
      s1: {
        ff: 'Arial',
        fs: 14,
        bl: 1, // bold
        it: 1, // italic
        ht: 2, // center align
        vt: 2, // middle vertical align
        tb: 2, // wrap text
        cl: { rgb: '#1e293b' },
        bg: { rgb: '#f1f5f9' },
        bd: {
          b: { cl: { rgb: '#cbd5e1' } },
        },
      },
    },
    sheets: {
      'sheet-01': {
        id: 'sheet-01',
        name: '报表页',
        rowCount: 20,
        columnCount: 10,
        defaultRowHeight: 32,
        defaultColumnWidth: 120,
        rowData: {
          0: { h: 40 },
        },
        columnData: {
          0: { w: 150 },
        },
        mergeData: [
          { startRow: 0, endRow: 0, startColumn: 0, endColumn: 2 },
        ],
        cellData: {
          0: {
            0: { v: '2026年第四季度生产总报表', s: 's1' },
          },
          1: {
            0: { v: '车间A' },
            1: { v: 100 },
            2: { v: 200 },
            3: { f: '=SUM(B2:C2)', v: 300 },
          },
        },
      },
    },
  };

  const { publication, diagnostics } = compileReport(mockSnapshot, {
    reportId: 'rep-compiled-1',
    title: '生产总报表',
  });

  assert.equal(publication.version, '1.0');
  assert.equal(publication.id, 'rep-compiled-1');
  assert.equal(publication.title, '生产总报表');
  assert.equal(publication.sheets.length, 1);

  const sheet = publication.sheets[0];
  assert.ok(sheet);
  assert.equal(sheet.name, '报表页');
  assert.equal(sheet.rowHeights?.[0], 40);
  assert.equal(sheet.colWidths?.[0], 150);

  // 合并区域校验
  assert.equal(sheet.merges.length, 1);
  assert.deepEqual(sheet.merges[0], {
    startRow: 0,
    endRow: 0,
    startCol: 0,
    endCol: 2,
  });

  // 单元格数据校验
  const titleCell = sheet.cells.find((c) => c.r === 0 && c.c === 0);
  assert.equal(titleCell?.v, '2026年第四季度生产总报表');
  assert.equal(titleCell?.styleId, 's1');

  // 公式单元格校验
  const formulaCell = sheet.cells.find((c) => c.r === 1 && c.c === 3);
  assert.equal(formulaCell?.v, 300);
  assert.equal(formulaCell?.formula, '=SUM(B2:C2)');

  // 样式字典校验
  const s1 = publication.styles['s1'];
  assert.ok(s1);
  assert.equal(s1.fontFamily, 'Arial');
  assert.equal(s1.fontSize, 14);
  assert.equal(s1.bold, true);
  assert.equal(s1.italic, true);
  assert.equal(s1.align, 'center');
  assert.equal(s1.verticalAlign, 'middle');
  assert.equal(s1.wrapText, true);
  assert.equal(s1.color, '#1e293b');
  assert.equal(s1.bgColor, '#f1f5f9');
  assert.equal(s1.border?.bottom?.color, '#cbd5e1');

  // 校验诊断中无严重错误
  assert.equal(diagnostics.filter((d) => d.severity === 'error').length, 0);
});

test('reportCompiler: 纯端到端报表管道贯通 (BI矩阵 -> Univer数据 -> 编译发布 -> VTable展示适配)', () => {
  const sampleData = [
    { workshop: '车间A', line: '产线1', qty: 10, defect: 2 },
    { workshop: '车间A', line: '产线2', qty: 20, defect: 4 },
    { workshop: '车间A', line: '产线3', qty: 30, defect: 6 },
    { workshop: '车间B', line: '产线1', qty: 100, defect: 20 },
    { workshop: '车间B', line: '产线2', qty: 40, defect: 8 },
  ];

  const config = {
    dimensions: {
      categories: ['workshop', 'line'],
      rowTotals: { showGrandTotals: true, grandTotalLabel: '总计' },
    },
    columns: [
      { type: 'aggregated', field: 'qty', agg: 'sum', label: '产量' },
      { type: 'aggregated', field: 'qty', agg: 'avg', label: '平均产量' },
      {
        type: 'computed',
        name: 'defect_rate',
        label: '不良率',
        expression: '[SUM(defect)] / [SUM(qty)] * 100',
      },
    ],
  };

  // 1. 生成 BiGridModel
  const grid = buildBiGrid(config, sampleData);

  // 2. 转换为 Univer Worksheet Data
  const worksheetData = biGridToUniverWorksheetData(grid, {
    sheetId: 'sheet-prod',
    name: '生产汇总表',
  });

  const fullWorkbookSnapshot = {
    id: 'wb-prod-01',
    sheetOrder: ['sheet-prod'],
    sheets: {
      'sheet-prod': worksheetData,
    },
  };

  // 3. 编译发布为 PublishedReport
  const { publication, diagnostics } = compileReport(fullWorkbookSnapshot, {
    reportId: 'published-prod-report',
    title: '生产监控报表',
  });

  assert.equal(publication.sheets.length, 1);
  const publishedSheet = publication.sheets[0];
  assert.ok(publishedSheet);
  assert.equal(publishedSheet.id, 'sheet-prod');

  // 4. 将 PublishedReport 映射为 VTable ListTable 配置
  const vtableConfig = adaptPublishedSheetToVTable(publishedSheet, publication.styles);

  assert.equal(vtableConfig.options.showHeader, false, '遵循Section 11.3: 关闭自动业务表头');
  assert.equal(vtableConfig.columns.length, publishedSheet.colCount);
  assert.equal(vtableConfig.records.length, publishedSheet.rowCount);

  // 验证 VTable records 第一行充当真实表头
  const r0 = vtableConfig.records[0];
  assert.equal(r0?.['col_0'], 'workshop');
  assert.equal(r0?.['col_1'], 'line');
  assert.equal(r0?.['col_2'], '产量');
  assert.equal(r0?.['col_3'], '平均产量');
  assert.equal(r0?.['col_4'], '不良率');

  // 验证总计行（最后一行）计算结果精准
  const rLast = vtableConfig.records[publishedSheet.rowCount - 1];
  assert.equal(rLast?.['col_0'], '总计');
  assert.equal(rLast?.['col_2'], '200'); // SUM 200
  assert.equal(rLast?.['col_3'], '40');  // 加权 AVG 40
  assert.equal(rLast?.['col_4'], '20.00%'); // 不良率 20%
});
