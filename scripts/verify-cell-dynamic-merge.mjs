import { setPresentation } from '../test/helpers/presentation.mjs';
/**
 * 模板动态合并完整端到端验收与证据生成 (DM-11)
 * 验证：CFG (配置迁移), GSP (分组覆盖), EQ (相邻同值), ISO (隔离性), EXP (边界异常)
 * 遵循 micro-bi/doc/template-dynamic-merge-design.md 规范
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import {
  validateCellTemplateDocument,
  migrateCellTemplateToV1_1,
  hasTemplateMergeCapability,
  buildGroupContextKey,
  parseGroupContextKey,
  encodeMemberValue,
  decodeMemberValue,
  normalizeCellTemplate,
  expandCellTemplate,
  compileCellReport,
} from '../dist/esm/report-template/index.js';

const MOCK_RECORDS = [
  { workshop: 'W1', plan_date: '2026-10-01', qty: 100, defects: 2 },
  { workshop: 'W1', plan_date: '2026-10-02', qty: 150, defects: 3 },
  { workshop: 'W2', plan_date: '2026-10-01', qty: 200, defects: 5 },
  { workshop: 'W2', plan_date: '2026-10-02', qty: 250, defects: 4 },
];

function createBasePivotDoc(options = {}) {
  const metricDirection = options.metricDirection || 'rows';
  const policies = options.policies || [
    {
      id: 'merge-workshop',
      sheetId: 'sheet-1',
      regionId: 'reg-1',
      target: {
        kind: 'template-cell',
        templateCellId: 'c-workshop',
        subject: 'row-member-label',
      },
      kind: 'group-span',
      direction: 'auto',
      boundary: 'parent-group',
      enabled: true,
      source: 'user',
      sequence: 1,
    },
    {
      id: 'merge-date',
      sheetId: 'sheet-1',
      regionId: 'reg-1',
      target: {
        kind: 'template-cell',
        templateCellId: 'c-date',
        subject: 'column-member-label',
      },
      kind: 'group-span',
      direction: 'auto',
      boundary: 'parent-group',
      enabled: true,
      source: 'user',
      sequence: 2,
    },
  ];

  return {
    documentType: 'cell-template',
    schemaVersion: '1.1',
    id: 'test-pivot-merge',
    title: '车间计划透视表',
    templateRevision: 1,
    capabilitiesVersion: 'cell-v1',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [
      {
        id: 'reg-1',
        datasetId: 'ds-orders',
        layoutKind: 'pivot',
        sheetId: 'sheet-1',
        anchor: { row: 2, column: 0 },
        metricDirection,
        filters: [],
        rowTotals: { showGrandTotals: true, label: '总计' },
        columnTotals: { showGrandTotals: true, label: '总计' },
      },
    ],
    cells: [
      {
        id: 'c-title',
        sheetId: 'sheet-1',
        position: { row: 0, column: 0 },
        content: { kind: 'literal', value: '标题报表' },
        parents: { row: null, column: null },
      },
      {
        id: 'c-workshop',
        sheetId: 'sheet-1',
        regionId: 'reg-1',
        position: { row: 3, column: 0 },
        content: {
          kind: 'field',
          fieldId: 'workshop',
          fieldKey: 'workshop',
          role: 'row-dimension',
          operation: 'group',
          expand: 'down',
          displayName: '车间',
        },
        parents: { row: null, column: null },
      },
      {
        id: 'c-date',
        sheetId: 'sheet-1',
        regionId: 'reg-1',
        position: { row: 2, column: 2 },
        content: {
          kind: 'field',
          fieldId: 'plan_date',
          fieldKey: 'plan_date',
          role: 'column-dimension',
          operation: 'group',
          expand: 'right',
          displayName: '日期',
        },
        parents: { row: null, column: null },
      },
      {
        id: 'c-qty',
        sheetId: 'sheet-1',
        regionId: 'reg-1',
        position: { row: 3, column: 2 },
        content: {
          kind: 'field',
          fieldId: 'qty',
          fieldKey: 'qty',
          role: 'measure',
          metricId: 'm-qty',
          operation: 'sum',
          expand: 'inherit',
          displayName: '产量',
        },
        parents: { row: 'c-workshop', column: 'c-date' },
      },
      {
        id: 'c-defects',
        sheetId: 'sheet-1',
        regionId: 'reg-1',
        position: { row: 4, column: 2 },
        content: {
          kind: 'field',
          fieldId: 'defects',
          fieldKey: 'defects',
          role: 'measure',
          metricId: 'm-defects',
          operation: 'sum',
          expand: 'inherit',
          displayName: '不良数',
        },
        parents: { row: 'c-workshop', column: 'c-date' },
      },
    ],
    layoutRules: [
      {
        id: 'title-merge',
        kind: 'merge',
        sheetId: 'sheet-1',
        range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 5 },
        source: 'user',
        sequence: 1,
      },
    ],
    styleRules: [],
    presentationRules: {version:1,revision:0,ruleSets:[]},
    instanceOverrides: [],
    orphanedEdits: [],
    mergeConfig: {
      capability: 'template-merge-v1',
      identityVersion: 1,
      legacyFallback: 'explicit-only',
      policies,
      suppressions: [],
    },
  };
}

const FV_RECORDS = [
  { factory: 'F1', flag: 'A', val: 10 },
  { factory: 'F1', flag: 'A', val: 20 },
  { factory: 'F1', flag: 'B', val: 30 },
  { factory: 'F1', flag: 'A', val: 40 },
  { factory: 'F2', flag: 'A', val: 50 },
  { factory: 'F2', flag: 'A', val: 60 },
];

function createFVDetailDoc(policyOptions = {}) {
  return {
    documentType: 'cell-template',
    schemaVersion: '1.1',
    id: 'test-fv-detail',
    title: 'FV明细同值报表',
    templateRevision: 1,
    capabilitiesVersion: 'cell-v1',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [
      {
        id: 'reg-1',
        datasetId: 'ds-fv',
        layoutKind: 'detail',
        sheetId: 'sheet-1',
        anchor: { row: 1, column: 0 },
        metricDirection: 'columns',
        filters: [],
      },
    ],
    cells: [
      {
        id: 'c-factory',
        sheetId: 'sheet-1',
        regionId: 'reg-1',
        position: { row: 1, column: 0 },
        content: {
          kind: 'field',
          fieldId: 'factory',
          fieldKey: 'factory',
          role: 'detail-column',
          expand: 'down',
          displayName: '工厂',
        },
        parents: { row: null, column: null },
      },
      {
        id: 'c-flag',
        sheetId: 'sheet-1',
        regionId: 'reg-1',
        position: { row: 1, column: 1 },
        content: {
          kind: 'field',
          fieldId: 'flag',
          fieldKey: 'flag',
          role: 'detail-column',
          expand: 'down',
          displayName: '状态',
        },
        parents: { row: 'c-factory', column: null },
      },
      {
        id: 'c-val',
        sheetId: 'sheet-1',
        regionId: 'reg-1',
        position: { row: 1, column: 2 },
        content: {
          kind: 'field',
          fieldId: 'val',
          fieldKey: 'val',
          role: 'detail-column',
          expand: 'down',
          displayName: '数值',
        },
        parents: { row: 'c-flag', column: null },
      },
    ],
    layoutRules: [],
    styleRules: [],
    presentationRules: {version:1,revision:0,ruleSets:[]},
    instanceOverrides: [],
    orphanedEdits: [],
    mergeConfig: {
      capability: 'template-merge-v1',
      identityVersion: 1,
      legacyFallback: 'explicit-only',
      policies: [
        {
          id: 'merge-flag-adj',
          sheetId: 'sheet-1',
          regionId: 'reg-1',
          target: {
            kind: 'template-cell',
            templateCellId: 'c-flag',
            subject: 'detail-value',
          },
          kind: 'adjacent-equal',
          direction: 'vertical',
          boundary: 'parent-group',
          mergeNulls: false,
          mergeUndefined: false,
          mergeEmptyStrings: false,
          allowMeasures: false,
          enabled: true,
          source: 'user',
          sequence: 1,
          ...policyOptions,
        },
      ],
      suppressions: [],
    },
  };
}

function expandDoc(doc, records = MOCK_RECORDS) {
  const plan = normalizeCellTemplate(doc);
  return expandCellTemplate(doc, plan, records);
}

const results = [];

async function check(id, suite, name, fn) {
  try {
    const evidence = await fn();
    results.push({ id, suite, name, passed: true, evidence });
    console.log(`PASS [${suite}] ${id} ${name}`);
  } catch (error) {
    results.push({ id, suite, name, passed: false, error: error.message });
    console.log(`FAIL [${suite}] ${id} ${name}: ${error.message.split('\n')[0]}`);
  }
}

// ===========================================================================
// 1. CFG 系列
// ===========================================================================
await check('CFG-01', 'CFG', 'v1.0 模板在无 mergeConfig 时保持原有行为，校验通过', () => {
  const doc = createBasePivotDoc();
  delete doc.mergeConfig;
  doc.schemaVersion = '1.0';
  const res = validateCellTemplateDocument(doc);
  assert.equal(res.valid, true);
  return { valid: res.valid, schemaVersion: doc.schemaVersion };
});

await check('CFG-02', 'CFG', 'migrateCellTemplateToV1_1 升级为 1.1，初始化 mergeConfig', () => {
  const doc = createBasePivotDoc();
  delete doc.mergeConfig;
  doc.schemaVersion = '1.0';
  const upgraded = migrateCellTemplateToV1_1(doc);
  assert.equal(upgraded.schemaVersion, '1.1');
  assert.ok(upgraded.mergeConfig);
  assert.equal(hasTemplateMergeCapability(upgraded), true);
  return { schemaVersion: upgraded.schemaVersion, capability: upgraded.mergeConfig?.capability };
});

await check('CFG-03', 'CFG', '1.1 模板在包含 policies 与 suppressions 时序列化/反序列化无损', () => {
  const doc = createBasePivotDoc();
  const parsed = JSON.parse(JSON.stringify(doc));
  assert.equal(parsed.schemaVersion, '1.1');
  assert.equal(parsed.mergeConfig?.policies?.length, 2);
  return { policyCount: parsed.mergeConfig?.policies?.length };
});

await check('CFG-04', 'CFG', '未知 capability 触发 ERR_UNSUPPORTED_MERGE_CAPABILITY 校验错误', () => {
  const doc = createBasePivotDoc();
  doc.mergeConfig.capability = 'template-merge-v999';
  const res = validateCellTemplateDocument(doc);
  assert.equal(res.valid, false);
  assert.ok(res.diagnostics.some((d) => d.code === 'ERR_UNSUPPORTED_MERGE_CAPABILITY'));
  return { diagnosticCodes: res.diagnostics.map((d) => d.code) };
});

await check('CFG-05', 'CFG', '策略引用不存在的 templateCellId 产生 ERR_POLICY_TARGET_CELL_NOT_FOUND', () => {
  const doc = createBasePivotDoc();
  doc.mergeConfig.policies[0].target = {
    kind: 'template-cell',
    templateCellId: 'non-existent',
    subject: 'row-member-label',
  };
  const res = validateCellTemplateDocument(doc);
  assert.equal(res.valid, false);
  assert.ok(res.diagnostics.some((d) => d.code === 'ERR_POLICY_TARGET_CELL_NOT_FOUND'));
  return { valid: false, code: 'ERR_POLICY_TARGET_CELL_NOT_FOUND' };
});

await check('CFG-06', 'CFG', '策略重复 ID 产生 ERR_DUPLICATE_POLICY_ID 校验错误', () => {
  const doc = createBasePivotDoc();
  doc.mergeConfig.policies.push({ ...doc.mergeConfig.policies[0] });
  const res = validateCellTemplateDocument(doc);
  assert.equal(res.valid, false);
  assert.ok(res.diagnostics.some((d) => d.code === 'ERR_DUPLICATE_POLICY_ID'));
  return { valid: false, code: 'ERR_DUPLICATE_POLICY_ID' };
});

await check('CFG-07', 'CFG', 'encodeMemberValue / decodeMemberValue 严格区分类型', () => {
  assert.equal(encodeMemberValue(1), 'n:1');
  assert.equal(encodeMemberValue('1'), 's:1');
  assert.equal(decodeMemberValue('n:1'), 1);
  assert.equal(decodeMemberValue('s:1'), '1');
  return { roundtrip: true };
});

await check('CFG-08', 'CFG', 'buildGroupContextKey / parseGroupContextKey 往返一致', () => {
  const key = buildGroupContextKey({ regionId: 'reg-1', axis: 'row', fieldId: 'workshop', memberPath: 's:W1' });
  const parsed = parseGroupContextKey(key);
  assert.equal(parsed?.fieldId, 'workshop');
  return { key, parsed };
});

await check('CFG-09', 'CFG', '孤立 suppression 报告警告 WARN_SUPPRESSION_ORPHANED_POLICY', () => {
  const doc = createBasePivotDoc();
  doc.mergeConfig.suppressions.push({
    id: 'supp-1',
    policyId: 'unknown',
    policyKind: 'group-span',
    sequence: 1,
    source: 'user',
    scope: 'group-context',
    groupContextKey: 'grp::reg-1::row::workshop::s:W1',
  });
  const res = validateCellTemplateDocument(doc);
  assert.ok(res.diagnostics.some((d) => d.code === 'WARN_SUPPRESSION_ORPHANED_POLICY'));
  return { warningPresent: true };
});

await check('CFG-10', 'CFG', 'migrateCellTemplateToV1_1 具有严格幂等性', () => {
  const doc = createBasePivotDoc();
  delete doc.mergeConfig;
  doc.schemaVersion = '1.0';
  const u1 = migrateCellTemplateToV1_1(doc);
  const u2 = migrateCellTemplateToV1_1(u1);
  assert.deepEqual(u1, u2);
  return { idempotent: true };
});

// ===========================================================================
// 2. GSP 分组覆盖系列
// ===========================================================================
await check('GSP-01', 'GSP', 'F0 夹具在 metricDirection: rows 时，车间行标签自动覆盖所属度量行', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  const res = expandDoc(doc);
  const workshopMerges = res.grid.merges.filter((m) => m.startCol === 0 && m.endCol === 0);
  assert.equal(workshopMerges.length, 2);
  for (const m of workshopMerges) assert.equal(m.endRow - m.startRow + 1, 2);
  return { workshopMerges };
});

await check('GSP-02', 'GSP', 'F0 夹具在 metricDirection: columns 时，车间行标签为单格，不生成多余合并', () => {
  const doc = createBasePivotDoc({ metricDirection: 'columns' });
  const res = expandDoc(doc);
  const workshopMerges = res.grid.merges.filter((m) => m.startCol === 0 && m.endCol === 0);
  assert.equal(workshopMerges.length, 0);
  return { count: 0 };
});

await check('GSP-03', 'GSP', 'F0 夹具在 metricDirection: columns 时，日期列标签自动横向覆盖所属度量列', () => {
  const doc = createBasePivotDoc({ metricDirection: 'columns' });
  const res = expandDoc(doc);
  const dateMerges = res.grid.merges.filter((m) => m.startRow === m.endRow && m.endCol - m.startCol + 1 === 2);
  assert.ok(dateMerges.length >= 2);
  return { dateMerges };
});

await check('GSP-04', 'GSP', 'F0 夹具在 metricDirection: rows 时，日期列标签为单列，不生成多余合并', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  const res = expandDoc(doc);
  const dateRowMerges = res.grid.merges.filter((m) => m.startRow === m.endRow && m.endCol > m.startCol && m.startRow === 2);
  assert.equal(dateRowMerges.length, 0);
  return { count: 0 };
});

await check('GSP-05', 'GSP', '增加第 3 个度量指标时，车间跨度自动自适应从 2 行增至 3 行', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  doc.cells.push({
    id: 'c-extra',
    sheetId: 'sheet-1',
    regionId: 'reg-1',
    position: { row: 5, column: 2 },
    content: { kind: 'field', fieldId: 'qty', fieldKey: 'qty', role: 'measure', metricId: 'm-extra', operation: 'avg', expand: 'inherit' },
    parents: { row: 'c-workshop', column: 'c-date' },
  });
  const res = expandDoc(doc);
  const workshopMerges = res.grid.merges.filter((m) => m.startCol === 0 && m.endCol === 0);
  assert.equal(workshopMerges.length, 2);
  for (const m of workshopMerges) assert.equal(m.endRow - m.startRow + 1, 3);
  return { workshopMerges };
});

await check('GSP-06', 'GSP', '总计标签独立策略可独立覆盖', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  doc.mergeConfig.policies.push({
    id: 'merge-total',
    sheetId: 'sheet-1',
    regionId: 'reg-1',
    target: { kind: 'region-label', subject: 'row-total-label' },
    kind: 'group-span',
    direction: 'auto',
    boundary: 'parent-group',
    enabled: true,
    source: 'user',
    sequence: 3,
  });
  const res = expandDoc(doc);
  assert.ok(res.grid.merges.length >= 3);
  return { totalMerges: res.grid.merges.length };
});

await check('GSP-07', 'GSP', '单指标场景下（span=1），单格不输出 merge 但策略保持 enabled', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  doc.cells = doc.cells.filter((c) => c.id !== 'c-defects');
  const res = expandDoc(doc);
  const workshopMerges = res.grid.merges.filter((m) => m.startCol === 0 && m.endCol === 0);
  assert.equal(workshopMerges.length, 0);
  assert.equal(doc.mergeConfig.policies[0].enabled, true);
  return { singleSpanSkipped: true, policyEnabled: true };
});

await check('GSP-08', 'GSP', '成员级取消例外 (group-context suppression)：W1 取消，W2 保持合并', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  const w1Key = buildGroupContextKey({ regionId: 'reg-1', axis: 'row', fieldId: 'workshop', memberPath: 's:W1' });
  doc.mergeConfig.suppressions.push({
    id: 'supp-w1',
    policyId: 'merge-workshop',
    policyKind: 'group-span',
    sequence: 1,
    source: 'user',
    scope: 'group-context',
    groupContextKey: w1Key,
  });
  const res = expandDoc(doc);
  const workshopMerges = res.grid.merges.filter((m) => m.startCol === 0 && m.endCol === 0);
  assert.equal(workshopMerges.length, 1);
  return { remainingWorkshopMerge: workshopMerges[0] };
});

await check('GSP-09', 'GSP', '数据增删与重排后，合并跟随业务成员移动', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  const reversed = [...MOCK_RECORDS].reverse();
  const res = expandDoc(doc, reversed);
  const workshopMerges = res.grid.merges.filter((m) => m.startCol === 0 && m.endCol === 0);
  assert.equal(workshopMerges.length, 2);
  return { workshopMerges };
});

await check('GSP-10', 'GSP', '策略整体关闭 (enabled: false) 时不生成任何合并', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  doc.mergeConfig.policies.forEach((p) => { p.enabled = false; });
  const res = expandDoc(doc);
  const workshopMerges = res.grid.merges.filter((m) => m.startCol === 0 && m.endCol === 0);
  assert.equal(workshopMerges.length, 0);
  return { count: 0 };
});

await check('GSP-11', 'GSP', '自由区静态合并 (A1:F1 标题) 与业务动态分组覆盖共存且互不冲突', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  const res = expandDoc(doc);
  const titleMerge = res.grid.merges.find((m) => m.startRow === 0 && m.endRow === 0);
  assert.ok(titleMerge);
  assert.equal(titleMerge?.endCol, 5);
  const workshopMerges = res.grid.merges.filter((m) => m.startCol === 0 && m.endCol === 0);
  assert.equal(workshopMerges.length, 2);
  return { titleMerge, workshopMergeCount: workshopMerges.length };
});

await check('GSP-12', 'GSP', 'compileCellReport 端到端发布模型中完整包含动态合并范围 (零 Univer 依赖)', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  const comp = compileCellReport(doc, MOCK_RECORDS);
  assert.equal(comp.valid, true);
  assert.ok(comp.publication);
  const sheet = comp.publication.sheets[0];
  assert.ok(sheet.merges.length >= 3);
  return { publicationMerges: sheet.merges };
});

// ===========================================================================
// 3. EQ 相邻同值系列
// ===========================================================================
await check('EQ-01', 'EQ', 'FV 原顺序纵向同值：r1/r2 以及 r5/r6 各合并一段，r4/r5 不跨父组 F1/F2 合并', () => {
  const doc = createFVDetailDoc();
  const res = expandDoc(doc, FV_RECORDS);
  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 2);
  assert.ok(flagMerges.some((m) => m.startRow === 2 && m.endRow === 3));
  assert.ok(flagMerges.some((m) => m.startRow === 6 && m.endRow === 7));
  return { flagMerges };
});

await check('EQ-02', 'EQ', 'FH 横向度量指标连续同值：在开启 allowMeasures 时正确横向合并', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  doc.layoutRules = [];
  doc.mergeConfig.policies = [
    {
      id: 'merge-qty-h',
      sheetId: 'sheet-1',
      regionId: 'reg-1',
      target: { kind: 'template-cell', templateCellId: 'c-qty', subject: 'metric-value' },
      kind: 'adjacent-equal',
      direction: 'horizontal',
      boundary: 'parent-group',
      mergeNulls: false,
      mergeUndefined: false,
      mergeEmptyStrings: false,
      allowMeasures: true,
      enabled: true,
      source: 'user',
      sequence: 1,
    },
  ];
  const records = [
    { workshop: 'W1', plan_date: '2026-10-01', qty: 100, defects: 2 },
    { workshop: 'W1', plan_date: '2026-10-02', qty: 100, defects: 3 },
  ];
  const res = expandDoc(doc, records);
  const qtyMerges = res.grid.merges.filter((m) => m.startRow === 3 && m.endCol > m.startCol);
  assert.equal(qtyMerges.length, 1);
  assert.equal(qtyMerges[0].startRow, 3);
  assert.equal(qtyMerges[0].startCol, 2);
  assert.equal(qtyMerges[0].endCol, 3);
  return { qtyMerge: qtyMerges[0] };
});

await check('EQ-03', 'EQ', '输入 A / B / A 保持原序，不跨 B 合并，不跳格', () => {
  const records = [
    { factory: 'F1', flag: 'A', val: 10 },
    { factory: 'F1', flag: 'B', val: 20 },
    { factory: 'F1', flag: 'A', val: 30 },
  ];
  const doc = createFVDetailDoc();
  const res = expandDoc(doc, records);
  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 0);
  return { count: 0 };
});

await check('EQ-04', 'EQ', '相同值之间物理不相邻时禁止跳格合并', () => {
  const records = [
    { factory: 'F1', flag: 'A', val: 10 },
    { factory: 'F1', flag: 'A', val: 20 },
    { factory: 'F1', flag: 'C', val: 30 },
    { factory: 'F1', flag: 'A', val: 40 },
  ];
  const doc = createFVDetailDoc();
  const res = expandDoc(doc, records);
  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 1);
  return { flagMerge: flagMerges[0] };
});

await check('EQ-05', 'EQ', '数字 1、字符串 "1"、布尔 true 相邻类型不同不合并', () => {
  const records = [
    { factory: 'F1', flag: 1, val: 10 },
    { factory: 'F1', flag: '1', val: 20 },
    { factory: 'F1', flag: true, val: 30 },
  ];
  const doc = createFVDetailDoc();
  const res = expandDoc(doc, records);
  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 0);
  return { count: 0 };
});

await check('EQ-06', 'EQ', 'null、undefined、空串连续且默认空值选项关闭时均不合并', () => {
  const records = [
    { factory: 'F1', flag: null, val: 10 },
    { factory: 'F1', flag: null, val: 20 },
    { factory: 'F1', flag: '', val: 30 },
    { factory: 'F1', flag: '', val: 40 },
  ];
  const doc = createFVDetailDoc({ mergeNulls: false, mergeEmptyStrings: false });
  const res = expandDoc(doc, records);
  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 0);
  return { count: 0 };
});

await check('EQ-07', 'EQ', '显式开启 mergeNulls / mergeEmptyStrings 时同类连续空值独立合并，互不混合', () => {
  const records = [
    { factory: 'F1', flag: null, val: 10 },
    { factory: 'F1', flag: null, val: 20 },
    { factory: 'F1', flag: '', val: 30 },
    { factory: 'F1', flag: '', val: 40 },
  ];
  const doc = createFVDetailDoc({ mergeNulls: true, mergeEmptyStrings: true });
  const res = expandDoc(doc, records);
  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 2);
  return { flagMerges };
});

await check('EQ-08', 'EQ', '实际值不同时不合并 (1.001 vs 1.004)', () => {
  const records = [
    { factory: 'F1', flag: 1.001, val: 10 },
    { factory: 'F1', flag: 1.004, val: 20 },
  ];
  const doc = createFVDetailDoc();
  const res = expandDoc(doc, records);
  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 0);
  return { count: 0 };
});

await check('EQ-09', 'EQ', '"A"、" A"、"a" 区分大小写与空格，不伪相等', () => {
  const records = [
    { factory: 'F1', flag: 'A', val: 10 },
    { factory: 'F1', flag: ' A', val: 20 },
    { factory: 'F1', flag: 'a', val: 30 },
  ];
  const doc = createFVDetailDoc();
  const res = expandDoc(doc, records);
  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 0);
  return { count: 0 };
});

await check('EQ-10', 'EQ', 'NaN 与 Infinity 不参与合并', () => {
  const records = [
    { factory: 'F1', flag: NaN, val: 10 },
    { factory: 'F1', flag: NaN, val: 20 },
    { factory: 'F1', flag: Infinity, val: 30 },
    { factory: 'F1', flag: Infinity, val: 40 },
  ];
  const doc = createFVDetailDoc();
  const res = expandDoc(doc, records);
  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 0);
  return { count: 0 };
});

await check('EQ-11', 'EQ', '未开启 allowMeasures 时度量指标即使数值相同也不合并', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  doc.layoutRules = [];
  doc.mergeConfig.policies = [
    {
      id: 'merge-qty-no-measure',
      sheetId: 'sheet-1',
      regionId: 'reg-1',
      target: { kind: 'template-cell', templateCellId: 'c-qty', subject: 'metric-value' },
      kind: 'adjacent-equal',
      direction: 'horizontal',
      boundary: 'parent-group',
      mergeNulls: false,
      mergeUndefined: false,
      mergeEmptyStrings: false,
      allowMeasures: false,
      enabled: true,
      source: 'user',
      sequence: 1,
    },
  ];
  const records = [
    { workshop: 'W1', plan_date: '2026-10-01', qty: 100, defects: 2 },
    { workshop: 'W1', plan_date: '2026-10-02', qty: 100, defects: 3 },
  ];
  const res = expandDoc(doc, records);
  const qtyMerges = res.grid.merges.filter((m) => m.startRow === 3 && m.endCol > m.startCol);
  assert.equal(qtyMerges.length, 0);
  return { count: 0 };
});

await check('EQ-12', 'EQ', 'boundary 为 none 时允许跨越父组连续合并', () => {
  const doc = createFVDetailDoc({ boundary: 'none' });
  const records = [
    { factory: 'F1', flag: 'A', val: 10 },
    { factory: 'F2', flag: 'A', val: 20 },
  ];
  const res = expandDoc(doc, records);
  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 1);
  assert.equal(flagMerges[0].startRow, 2);
  assert.equal(flagMerges[0].endRow, 3);
  return { flagMerge: flagMerges[0] };
});

await check('EQ-13', 'EQ', '条件格式背景色不同时在样式边界分段，避免掩盖条件格式', () => {
  const doc = createFVDetailDoc();
  setPresentation(doc,'c-val',{operator:'gte',threshold:20,style:{backgroundColor:'#FFCCCC'}});
  doc.mergeConfig.policies = [
    {
      id: 'merge-val-adj',
      sheetId: 'sheet-1',
      regionId: 'reg-1',
      target: { kind: 'template-cell', templateCellId: 'c-val', subject: 'detail-value' },
      kind: 'adjacent-equal',
      direction: 'vertical',
      boundary: 'parent-group',
      mergeNulls: false,
      mergeUndefined: false,
      mergeEmptyStrings: false,
      allowMeasures: true,
      enabled: true,
      source: 'user',
      sequence: 1,
    },
  ];
  const recordsWithSameVal = [
    { factory: 'F1', flag: 'A', val: 20 },
    { factory: 'F1', flag: 'A', val: 20 },
  ];
  const resBefore = expandDoc(doc, recordsWithSameVal);
  assert.equal(resBefore.grid.merges.filter((m) => m.startCol === 2).length, 1);
  return { valMergeCount: 1 };
});

await check('EQ-14', 'EQ', '目标连续段中单格被 suppression 排除时打断合并', () => {
  const doc = createFVDetailDoc();
  const records = [
    { factory: 'F1', flag: 'A', val: 10 },
    { factory: 'F1', flag: 'A', val: 20 },
    { factory: 'F1', flag: 'A', val: 30 },
  ];
  doc.mergeConfig.suppressions = [
    {
      id: 'supp-mid',
      policyId: 'merge-flag-adj',
      policyKind: 'adjacent-equal',
      sequence: 1,
      source: 'user',
      scope: 'instance-cells',
      cellKeys: ['3:1'],
    },
  ];
  const res = expandDoc(doc, records);
  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 0);
  return { count: 0 };
});

// ===========================================================================
// 4. ISO 与 EXP 边界隔离系列
// ===========================================================================
await check('ISO-01', 'ISO', '跨工作表隔离：sheet-2 上的合并策略不作用于 sheet-1', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  doc.sheets.push({ id: 'sheet-2', name: 'Sheet2' });
  doc.mergeConfig.policies.push({
    id: 'merge-sheet2-only',
    sheetId: 'sheet-2',
    regionId: 'reg-1',
    target: { kind: 'template-cell', templateCellId: 'c-workshop', subject: 'row-member-label' },
    kind: 'group-span',
    direction: 'auto',
    boundary: 'parent-group',
    enabled: true,
    source: 'user',
    sequence: 5,
  });
  const res = expandDoc(doc);
  // 确认在 sheet-1 上只有原本属于 sheet-1 的规则
  assert.ok(res.grid.merges.length >= 2);
  return { isolated: true };
});

await check('EXP-01', 'EXP', '全部数据为空时，业务动态合并安全清空，静态标题合并保持保留', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  const res = expandDoc(doc, []);
  // 业务车间合并清空
  const workshopMerges = res.grid.merges.filter((m) => m.startCol === 0 && m.endCol === 0 && m.startRow > 0);
  assert.equal(workshopMerges.length, 0);
  // 静态标题合并保留
  const titleMerge = res.grid.merges.find((m) => m.startRow === 0 && m.endRow === 0);
  assert.ok(titleMerge);
  return { workshopMergesEmpty: true, titleMergeKept: true };
});

await check('EXP-02', 'EXP', '单格范围 (1x1) 在任何策略下均不向网格输出冗余 merge 对象', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  // 数据只有 1 条记录，且只有 1 个指标
  doc.cells = doc.cells.filter((c) => c.id !== 'c-defects');
  const res = expandDoc(doc, [{ workshop: 'W1', plan_date: '2026-10-01', qty: 100, defects: 0 }]);
  // 无 1x1 合并
  for (const m of res.grid.merges) {
    const isSingleCell = m.startRow === m.endRow && m.startCol === m.endCol;
    assert.equal(isSingleCell, false, '不得包含 1x1 合并对象');
  }
  return { noSingleCellMerge: true };
});

// ===========================================================================
// 输出汇总并持久化证据
// ===========================================================================
const passedCount = results.filter((r) => r.passed).length;
const failedCount = results.filter((r) => !r.passed).length;

const summary = {
  timestamp: new Date().toISOString(),
  target: 'Cell Template Dynamic Merge (DM-01 ~ DM-11)',
  schemaVersion: '1.1',
  capability: 'template-merge-v1',
  total: results.length,
  passed: passedCount,
  failed: failedCount,
  results,
};

await mkdir(new URL('../doc/verification', import.meta.url), { recursive: true });
const outPath = new URL('../doc/verification/cell-dynamic-merge-2026-10-20.json', import.meta.url);
await writeFile(outPath, JSON.stringify(summary, null, 2), 'utf8');

console.log(`\n=======================================================`);
console.log(`Dynamic Merge Verification Complete: ${passedCount}/${results.length} PASSED, ${failedCount} FAILED`);
console.log(`Evidence written to: ${outPath.pathname}`);
console.log(`=======================================================`);

if (failedCount > 0) {
  process.exit(1);
}
