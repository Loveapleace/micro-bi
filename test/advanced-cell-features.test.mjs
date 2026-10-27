import { setPresentation } from './helpers/presentation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { expandCellDrivenTemplate } from '../dist/esm/report-template/cellExpansionEngine.js';
import { compileCellReport } from '../dist/esm/report-template/compileCellReport.js';
import { biGridToUniverWorksheetData } from '../dist/esm/report/buildBiGrid.js';
import { compilePanelToCellTemplate } from '../dist/esm/report-template/panelToTemplateAdapter.js';

test('Advanced Cell Features: 8 大高级属性全量求值与发布测试', () => {
  const doc = {
    documentType: 'cell-template',
    schemaVersion: '2.0',
    capabilitiesVersion: '2.0',
    id: 'test-doc-adv',
    title: '高级属性全量测试',
    templateRevision: 1,
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [
      {
        id: 'r1',
        sheetId: 'sheet-1',
        datasetId: 'ds1',
        archetype: 'grouped',
        anchor: { row: 1, column: 0 },
      },
    ],
    cells: [
      // 1. 日期格式化测试格 (YYYY年MM月)
      {
        id: 'c-date',
        sheetId: 'sheet-1',
        position: { row: 1, column: 0 },
        content: {
          kind: 'field',
          role: 'row-dimension',
          fieldKey: 'date',
          expand: 'down',
          operation: 'group',
          formatOptions: {
            dateFormat: 'YYYY年MM月',
            tooltip: '统计月份口径',
          },
        },
      },
      // 2. 量级缩放 (scale: 10000) + 前后缀 (¥ ... 万元) + 精度 (2位)
      {
        id: 'c-scaled',
        sheetId: 'sheet-1',
        position: { row: 1, column: 1 },
        parents: { row: 'c-date', column: null },
        content: {
          kind: 'field',
          role: 'measure',
          fieldKey: 'revenue',
          expand: 'none',
          operation: 'sum',
          formatOptions: {
            scale: 10000,
            prefix: '¥',
            suffix: '万元',
            precision: 2,
            useGrouping: true,
            tooltip: '总营收(万元)',
          },
        },
      },
      // 3. 负数红字括号 (red_bracket) + 条件格式预警 (< 90 标红)
      {
        id: 'c-score',
        sheetId: 'sheet-1',
        position: { row: 1, column: 2 },
        parents: { row: 'c-date', column: null },
        content: {
          kind: 'field',
          role: 'measure',
          fieldKey: 'score',
          expand: 'none',
          operation: 'avg',
          formatOptions: {
            negativeFormat: 'red_bracket',
            precision: 1,
            emptyDisplay: 'N/A',
            zeroDisplay: 'dash',
          },
        },
        style: {
          textAlign: 'center',
          verticalAlign: 'middle',
          wrapText: true,
          fontSize: 14,
        },
      },
      // 4. 空值与零值容错测试格
      {
        id: 'c-fault',
        sheetId: 'sheet-1',
        position: { row: 1, column: 3 },
        parents: { row: 'c-date', column: null },
        content: {
          kind: 'field',
          role: 'measure',
          fieldKey: 'loss',
          expand: 'none',
          operation: 'sum',
          formatOptions: {
            emptyDisplay: '-',
            zeroDisplay: 'dash',
          },
        },
      },
    ],
    layoutRules: [],
  };

  const dataset = [
    { date: '2024-03-15', revenue: 500000, score: 85, loss: 0 },
    { date: '2024-04-20', revenue: -123456, score: 95, loss: null },
  ];

  // 1. 测试展开引擎求值
  setPresentation(doc, 'c-score', { threshold: 90, style: { color: '#CF1322', backgroundColor: '#FFF1F0', bold: true } });
  const { grid } = expandCellDrivenTemplate(doc, dataset);
  assert.equal(grid.cells.length >= 8, true);

  // 验证 1: 日期格式化 YYYY年MM月
  const dateCell0 = grid.cells.find((c) => c.row === 1 && c.col === 0);
  assert.equal(dateCell0.displayText, '2024年03月');
  assert.equal(dateCell0.tooltip, '统计月份口径');

  const dateCell1 = grid.cells.find((c) => c.row === 2 && c.col === 0);
  assert.equal(dateCell1.displayText, '2024年04月');

  // 验证 2: 缩放 10000 + ¥ + 万元 + 千分位
  const revCell0 = grid.cells.find((c) => c.row === 1 && c.col === 1);
  assert.equal(revCell0.displayText, '¥50.00万元');
  assert.equal(revCell0.tooltip, '总营收(万元)');

  const revCell1 = grid.cells.find((c) => c.row === 2 && c.col === 1);
  assert.equal(revCell1.displayText, '-¥12.35万元');

  // 验证 3: 条件格式 (< 90 标红) 与 排版样式
  const scoreCell0 = grid.cells.find((c) => c.row === 1 && c.col === 2);
  assert.equal(scoreCell0.value, 85);
  assert.equal(scoreCell0.displayText, '85.0');
  // 满足 < 90 条件格式，触发告警样式
  assert.equal(scoreCell0.style.color, '#CF1322');
  assert.equal(scoreCell0.style.bgColor, '#FFF1F0');
  assert.equal(scoreCell0.style.wrapText, true);
  assert.equal(scoreCell0.style.verticalAlign, 'middle');
  assert.equal(scoreCell0.style.fontSize, 14);

  const scoreCell1 = grid.cells.find((c) => c.row === 2 && c.col === 2);
  assert.equal(scoreCell1.value, 95);
  assert.equal(scoreCell1.displayText, '95.0');
  // 95 >= 90，不触发告警红
  assert.notEqual(scoreCell1.style.color, '#CF1322');

  // 验证 4: 零值与空值容错
  const lossZeroCell = grid.cells.find((c) => c.row === 1 && c.col === 3);
  assert.equal(lossZeroCell.displayText, '-'); // zeroDisplay: dash

  const lossNullCell = grid.cells.find((c) => c.row === 2 && c.col === 3);
  assert.equal(lossNullCell.displayText, '-'); // emptyDisplay: '-'

  // 2. 测试编译发布产物
  const report = compileCellReport(doc, dataset);
  assert.equal(report.valid, true);
  const pubSheet = report.publication.sheets[0];
  const pubDate0 = pubSheet.cells.find((c) => c.r === 1 && c.c === 0);
  assert.equal(pubDate0.displayText, '2024年03月');
  assert.equal(pubDate0.tooltip, '统计月份口径');

  // 3. 测试 Univer 数据结构转换
  const univerData = biGridToUniverWorksheetData(grid);
  const uCellDate = univerData.cellData[1][0];
  assert.equal(uCellDate.custom.tooltip, '统计月份口径');
  assert.equal(uCellDate.v, '2024-03-15');
  assert.equal(uCellDate.custom.displayText, '2024年03月');

  const uCellLossNull = univerData.cellData[2][3];
  assert.equal(uCellLossNull.v, 0); // SUM空事实的有效值为0，显示“-”不改变它。
  assert.equal(uCellLossNull.custom.displayText, '-'); // 空值正确映射为 displayText '-'
});

test('Advanced Cell Features: 单格受控动态合并策略 (none / adjacent-equal / group-span)', () => {
  // 1. 测试 grouped 模板下针对单格 mergePolicy: 'none' 的独立抑制
  const cfg = {
    datasetId: 'workshop_stream',
    dimensions: { categories: ['workshop', 'device'] },
    columns: [{ type: 'aggregated', field: 'revenue', agg: 'sum' }],
  };
  const doc = compilePanelToCellTemplate(cfg, 'workshop_stream', { enableGroupMerge: true });
  // cell-sec-device 设置 mergePolicy: 'none'
  const secCell = doc.cells.find((c) => c.id.startsWith('cell-sec-'));
  assert.ok(secCell);
  secCell.mergePolicy = 'none';

  // 将 mergePolicy = 'none' 映射进 doc.mergeConfig
  doc.mergeConfig.policies = doc.mergeConfig.policies.filter(
    (p) => !(p.target.kind === 'template-cell' && p.target.templateCellId === secCell.id)
  );
  doc.mergeConfig.policies.push({
    id: `policy-${secCell.id}`,
    sheetId: 'sheet-1',
    regionId: 'region-1',
    target: {
      kind: 'template-cell',
      templateCellId: secCell.id,
      subject: 'row-member-label',
    },
    kind: 'group-span',
    direction: 'vertical',
    enabled: false,
    boundary: 'parent-group',
    source: 'user',
    sequence: 1,
  });

  const dataset = [
    { workshop: '一车间', device: '机床A', revenue: 100 },
    { workshop: '一车间', device: '机床B', revenue: 100 },
    { workshop: '二车间', device: '机床A', revenue: 300 },
  ];

  const res = expandCellDrivenTemplate(doc, dataset);
  // 一车间 (col 0) 跨 row 3~4 合并
  const workshopMerge = res.grid.merges.find((m) => m.startCol === 0 && m.endCol === 0);
  assert.ok(workshopMerge, '一车间作为主维度应当合并');
  assert.equal(workshopMerge.startRow, 3);
  assert.equal(workshopMerge.endRow, 4);

  // 设备 (col 1) 配置了 none，绝不合并
  const deviceMerge = res.grid.merges.find((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(deviceMerge, undefined, '配置了 none 的二级维度绝不合并');

  // 2. 测试度量指标格配置 adjacent-equal
  const measCell = doc.cells.find((c) => c.content.role === 'measure');
  assert.ok(measCell);
  doc.mergeConfig.policies.push({
    id: `policy-${measCell.id}`,
    sheetId: 'sheet-1',
    regionId: 'region-1',
    target: {
      kind: 'template-cell',
      templateCellId: measCell.id,
      subject: 'metric-value',
    },
    kind: 'adjacent-equal',
    direction: 'vertical',
    compareBy: 'typed-value',
    mergeNulls: false,
    mergeUndefined: false,
    mergeEmptyStrings: false,
    allowMeasures: true,
    boundary: 'parent-group',
    enabled: true,
    source: 'user',
    sequence: 1,
  });

  const resWithAdj = expandCellDrivenTemplate(doc, dataset);
  const revMerge = resWithAdj.grid.merges.find((m) => m.startCol === 2 && m.endCol === 2);
  assert.ok(revMerge, '连续值为 100 的度量格应当被相邻同值合并');
  assert.equal(revMerge.startRow, 3);
  assert.equal(revMerge.endRow, 4);
});
