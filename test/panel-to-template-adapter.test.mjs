import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePanelToCellTemplate } from '../dist/esm/report-template/panelToTemplateAdapter.js';
import { expandCellDrivenTemplate } from '../dist/esm/report-template/cellExpansionEngine.js';

test('panelToTemplateAdapter: compiles pivot table config into valid dual-parent cell template', () => {
  const config = {
    datasetId: 'industrial_device_inventory',
    headers: {
      workshop: '承制车间',
      device_type: '设备类型',
      power_kw: '额定功率',
      energy_kwh: '累计耗电',
    },
    dimensions: {
      categories: ['workshop'],
      columnCategories: ['device_type'],
    },
    columns: [
      { type: 'aggregated', field: 'power_kw', agg: 'sum', label: '额定功率' },
      { type: 'aggregated', field: 'energy_kwh', agg: 'sum', label: '累计耗电' },
    ],
  };

  const doc = compilePanelToCellTemplate(config, 'industrial_device_inventory', {
    datasetName: '车间设备台账',
  });

  assert.equal(doc.schemaVersion, '2.0');
  assert.equal(doc.regions[0].datasetId, 'industrial_device_inventory');

  // 验证关键单元格
  const rowDimCell = doc.cells.find((c) => c.content.kind === 'field' && c.content.role === 'row-dimension');
  assert.ok(rowDimCell);
  assert.equal(rowDimCell.content.fieldKey, 'workshop');
  assert.equal(rowDimCell.content.expand, 'down');

  const colDimCell = doc.cells.find((c) => c.content.kind === 'field' && c.content.role === 'column-dimension');
  assert.ok(colDimCell);
  assert.equal(colDimCell.content.fieldKey, 'device_type');
  assert.equal(colDimCell.content.expand, 'right');

  const measCells = doc.cells.filter((c) => c.content.kind === 'field' && c.content.role === 'measure');
  assert.equal(measCells.length, 2);

  // 验证展开求值
  const sampleData = [
    { workshop: '1号车间', device_type: '切削机', power_kw: 50, energy_kwh: 120 },
    { workshop: '1号车间', device_type: '冲压机', power_kw: 80, energy_kwh: 200 },
    { workshop: '2号车间', device_type: '切削机', power_kw: 60, energy_kwh: 140 },
  ];

  const result = expandCellDrivenTemplate(doc, sampleData);
  assert.ok(result.grid);
  assert.ok(result.grid.cells.length > 0);
});

test('panelToTemplateAdapter: compiles grouped table config with primary and secondary hierarchy', () => {
  const config = {
    datasetId: 'orders',
    headers: {
      workshop: '车间',
      part_name: '零件名称',
      output_qty: '产量',
    },
    dimensions: {
      categories: ['workshop', 'part_name'],
    },
    columns: [
      { type: 'aggregated', field: 'output_qty', agg: 'sum', label: '产量' },
    ],
  };

  const doc = compilePanelToCellTemplate(config, 'orders');
  assert.equal(doc.schemaVersion, '2.0');

  const priCell = doc.cells.find((c) => c.id === 'cell-pri-workshop');
  assert.ok(priCell);
  assert.equal(priCell.content.fieldKey, 'workshop');

  const secCell = doc.cells.find((c) => c.id === 'cell-sec-part_name');
  assert.ok(secCell);
  assert.equal(secCell.parents.row, 'cell-pri-workshop');

  const measCell = doc.cells.find((c) => c.content.role === 'measure');
  assert.ok(measCell);
  assert.equal(measCell.parents.row, 'cell-sec-part_name');
});

test('panelToTemplateAdapter: compiles detail list table for pure fixed columns', () => {
  const config = {
    datasetId: 'logs',
    headers: {
      id: '序号',
      code: '代码',
    },
    columns: [
      { type: 'fixed', field: 'id', label: '序号' },
      { type: 'fixed', field: 'code', label: '代码' },
    ],
  };

  const doc = compilePanelToCellTemplate(config, 'logs');
  assert.equal(doc.schemaVersion, '2.0');

  const detailCells = doc.cells.filter((c) => c.content.role === 'detail-column');
  assert.equal(detailCells.length, 2);
  assert.equal(detailCells[0].parents.row, 'none');
  assert.equal(detailCells[1].parents.row, detailCells[0].id);
});

test('panelToTemplateAdapter: supports diagram-2 card configuration (time buckets in row/col and auto-deduction)', () => {
  // 1. 测试图二透视表配置（列时间周期 + 行分类维度）
  const pivotConfig = {
    datasetId: 'workshop_stream',
    headers: {
      plan_date: '投产日期',
      workshop: '车间',
      output_qty: '产量',
    },
    dimensions: {
      categories: ['workshop'],
      columnTimeBucket: {
        field: 'plan_date',
        granularity: 'month',
      },
    },
    columns: [
      { type: 'aggregated', field: 'output_qty', agg: 'sum', label: '产量' },
    ],
  };

  const pivotDoc = compilePanelToCellTemplate(pivotConfig, 'workshop_stream');
  assert.equal(pivotDoc.title, '车间 × 投产日期 双向交叉报表');
  const colCell = pivotDoc.cells.find((c) => c.content.role === 'column-dimension');
  assert.ok(colCell);
  assert.equal(colCell.content.fieldKey, 'plan_date');
  assert.equal(colCell.content.timeBucket?.granularity, 'month');

  // 2. 测试图二分组表配置（行时间周期 + 行分类维度）
  const groupedConfig = {
    datasetId: 'workshop_stream',
    headers: {
      plan_date: '投产日期',
      workshop: '车间',
      output_qty: '产量',
    },
    dimensions: {
      categories: ['workshop'],
      timeBucket: {
        field: 'plan_date',
        granularity: 'day',
      },
    },
    columns: [
      { type: 'aggregated', field: 'output_qty', agg: 'sum', label: '产量' },
    ],
  };

  const groupedDoc = compilePanelToCellTemplate(groupedConfig, 'workshop_stream');
  assert.ok(groupedDoc.title.includes('层级分组统计表'));
  const priCell = groupedDoc.cells.find((c) => c.id.startsWith('cell-pri-'));
  assert.ok(priCell);
});

test('panelToTemplateAdapter: supports ported Mode-2 features (formatting, row totals, unmerged flat policy)', () => {
  const pivotConfig = {
    datasetId: 'workshop_stream',
    headers: {
      workshop: '车间',
      device: '设备',
      revenue: '营收',
    },
    dimensions: {
      categories: ['workshop'],
      columnCategories: ['device'],
    },
    columns: [
      { type: 'aggregated', field: 'revenue', agg: 'sum', label: '营收' },
    ],
  };

  // 1. 测试 formats 与 showRowTotals
  const docWithTotals = compilePanelToCellTemplate(pivotConfig, 'workshop_stream', {
    showRowTotals: true,
    formats: { revenue: 'currency' },
    enableGroupMerge: false,
  });

  // 校验格式化
  const measCell = docWithTotals.cells.find((c) => c.id === 'meas-revenue');
  assert.ok(measCell);
  assert.equal(measCell.content.format, 'currency');

  // 校验行总计
  const rowTotalHdr = docWithTotals.cells.find((c) => c.id === 'hdr-row-total');
  assert.ok(rowTotalHdr);
  const rowTotalMeas = docWithTotals.cells.find((c) => c.id === 'meas-rowtotal-revenue');
  assert.ok(rowTotalMeas);
  assert.equal(rowTotalMeas.content.format, 'currency');
  assert.equal(rowTotalMeas.parents.row, 'default');
  assert.equal(rowTotalMeas.parents.column, 'none'); // 显式无列父格，禁止几何自动推断

  // 校验平铺策略 (enableGroupMerge: false 时无 group-span 规则)
  assert.equal(docWithTotals.mergeConfig?.policies?.length || 0, 0);

  // 验证双父格引擎展开求值
  const sampleData = [
    { workshop: '一车间', device: '机床A', revenue: 100 },
    { workshop: '一车间', device: '机床B', revenue: 200 },
    { workshop: '二车间', device: '机床A', revenue: 300 },
  ];
  const expanded = expandCellDrivenTemplate(docWithTotals, sampleData);
  assert.ok(expanded.grid);
  assert.ok(expanded.grid.cells.length > 0);
});
