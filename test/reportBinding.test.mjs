import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSemanticKey,
  createReportBinding,
  buildBindingIndex,
  detectRegionCollision,
  refreshAnalysisRegion,
  validateReportDocument,
  validatePublishedReport,
} from '../dist/esm/report/index.js';

test('reportBinding: 业务语义唯一身份与索引构建', () => {
  const rowPath = [{ axisId: 'row_1', field: 'workshop', memberKey: '车间A', label: '车间A' }];
  const colPath = [{ axisId: 'col_1', field: 'date', memberKey: '2026-10', label: '2026-10' }];

  const key = createSemanticKey('analysis-1', rowPath, colPath, '总产量', 'metric-value');
  assert.equal(
    key,
    'analysis-1::R[[["row_1","workshop","车间A"]]]::C[[["col_1","date","2026-10"]]]::M[总产量]::ROLE[metric-value]'
  );

  const binding = createReportBinding({
    analysisId: 'analysis-1',
    sheetId: 'sheet-1',
    row: 5,
    column: 3,
    role: 'metric-value',
    rowPath,
    columnPath: colPath,
    metricId: '总产量',
  });

  const { bySemantic, byCoordinate } = buildBindingIndex([binding]);
  assert.ok(bySemantic.has(key));
  assert.ok(byCoordinate.has('sheet-1:5,3'));
  assert.equal(byCoordinate.get('sheet-1:5,3')?.id, key);
});

test('reportBinding: 自动区域扩展冲突检测 (detectRegionCollision)', () => {
  const targetRange = {
    sheetId: 'sheet-1',
    startRow: 0,
    endRow: 10,
    startCol: 0,
    endCol: 5,
  };

  // 重叠区域
  const overlappingRange = {
    sheetId: 'sheet-1',
    startRow: 8,
    endRow: 15,
    startCol: 2,
    endCol: 8,
  };

  // 无重叠区域
  const distantRange = {
    sheetId: 'sheet-1',
    startRow: 20,
    endRow: 30,
    startCol: 0,
    endCol: 5,
  };

  // 跨 Sheet 区域
  const anotherSheetRange = {
    sheetId: 'sheet-2',
    startRow: 0,
    endRow: 10,
    startCol: 0,
    endCol: 5,
  };

  assert.equal(detectRegionCollision(targetRange, [overlappingRange]), true);
  assert.equal(detectRegionCollision(targetRange, [distantRange]), false);
  assert.equal(detectRegionCollision(targetRange, [anotherSheetRange]), false);
});

test('reportBinding: 数据刷新、人工覆盖保留与失效诊断 (refreshAnalysisRegion)', () => {
  const initialData = [
    { workshop: '车间A', line: '产线1', qty: 10 },
    { workshop: '车间B', line: '产线1', qty: 50 },
  ];

  const config = {
    dimensions: { categories: ['workshop'] },
    columns: [{ type: 'aggregated', field: 'qty', agg: 'sum', label: '产量' }],
  };

  const initialRegion = {
    id: 'analysis-1',
    sheetId: 'sheet-1',
    anchor: { row: 0, column: 0 },
    config,
    manualOverrides: {},
  };

  const result1 = refreshAnalysisRegion(initialRegion, initialData);
  assert.equal(result1.diagnostics.length, 0);

  // 模拟用户对“车间A产量”进行了手工覆盖
  const bindingA = result1.region.bindings?.find(
    (b) => b.semantic.role === 'metric-value' && b.semantic.rowPath[0]?.memberKey === '车间A'
  );
  assert.ok(bindingA);

  const regionWithOverride = {
    ...result1.region,
    manualOverrides: {
      [bindingA.id]: { v: 999, displayText: '999(人工调整)' },
    },
  };

  // 场景 1：数据更新但车间A仍存在，人工覆盖应平滑保留
  const updatedData1 = [
    { workshop: '车间A', line: '产线1', qty: 20 },
    { workshop: '车间B', line: '产线1', qty: 60 },
  ];
  const result2 = refreshAnalysisRegion(regionWithOverride, updatedData1);
  assert.ok(result2.region.manualOverrides?.[bindingA.id]);
  const newBindingA = result2.region.bindings?.find((b) => b.id === bindingA.id);
  assert.equal(newBindingA?.state, 'manual-override');

  // 场景 2：车间A在最新数据中被删除，人工覆盖失效并给出诊断
  const updatedDataWithoutA = [
    { workshop: '车间B', line: '产线1', qty: 60 },
    { workshop: '车间C', line: '产线1', qty: 80 },
  ];
  const result3 = refreshAnalysisRegion(regionWithOverride, updatedDataWithoutA);
  assert.ok(!result3.region.manualOverrides?.[bindingA.id]);
  const missingDiag = result3.diagnostics.find((d) => d.code === 'REFERENCE_MISSING');
  assert.ok(missingDiag);
});

test('reportBinding: 文档与发布模型校验 (validateReportDocument / validatePublishedReport)', () => {
  // 非法文档对象
  const badDocRes = validateReportDocument(null);
  assert.equal(badDocRes.valid, false);
  assert.equal(badDocRes.issues[0]?.code, 'SCHEMA_UNSUPPORTED');

  // 合法文档
  const goodDoc = {
    version: '1.0',
    id: 'doc-1',
    revision: 1,
    analyses: [],
  };
  assert.equal(validateReportDocument(goodDoc).valid, true);

  // 非法发布模型：倒置的合并区域
  const badPub = {
    version: '1.0',
    id: 'pub-1',
    createdAt: new Date().toISOString(),
    sheets: [
      {
        id: 's1',
        name: 'Sheet1',
        rowCount: 10,
        colCount: 5,
        cells: [],
        merges: [{ startRow: 5, endRow: 2, startCol: 0, endCol: 0 }],
      },
    ],
    styles: {},
  };
  const badPubRes = validatePublishedReport(badPub);
  assert.equal(badPubRes.valid, false);
  assert.ok(badPubRes.issues.some((i) => i.code === 'BINDING_INVALID'));

  // 合法发布模型
  const goodPub = {
    version: '1.0',
    id: 'pub-2',
    createdAt: new Date().toISOString(),
    sheets: [
      {
        id: 's1',
        name: 'Sheet1',
        rowCount: 10,
        colCount: 5,
        cells: [],
        merges: [{ startRow: 2, endRow: 5, startCol: 0, endCol: 0 }],
      },
    ],
    styles: {},
  };
  assert.equal(validatePublishedReport(goodPub).valid, true);
});
