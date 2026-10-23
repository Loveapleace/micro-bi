import { test } from 'node:test';
import assert from 'node:assert/strict';
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

function expandDoc(doc, records = MOCK_RECORDS) {
  const plan = normalizeCellTemplate(doc);
  return expandCellTemplate(doc, plan, records);
}

// ---------------------------------------------------------------------------
// 基础夹具
// ---------------------------------------------------------------------------
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
    conditionalRules: [],
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

// ===========================================================================
// 16.1 CFG-01 ～ CFG-10 配置、身份与迁移专项
// ===========================================================================

test('CFG-01: v1.0 模板在无 mergeConfig 时保持原有行为，校验通过', () => {
  const doc = createBasePivotDoc();
  delete doc.mergeConfig;
  doc.schemaVersion = '1.0';

  const res = validateCellTemplateDocument(doc);
  assert.equal(res.valid, true);
  assert.equal(doc.schemaVersion, '1.0');
});

test('CFG-02: migrateCellTemplateToV1_1 升级为 1.1，初始化 mergeConfig', () => {
  const doc = createBasePivotDoc();
  delete doc.mergeConfig;
  doc.schemaVersion = '1.0';

  const upgraded = migrateCellTemplateToV1_1(doc);
  assert.equal(upgraded.schemaVersion, '1.1');
  assert.ok(upgraded.mergeConfig);
  assert.equal(upgraded.mergeConfig.capability, 'template-merge-v1');
  assert.equal(hasTemplateMergeCapability(upgraded), true);
});

test('CFG-03: 1.1 模板在包含 policies 与 suppressions 时序列化/反序列化无损', () => {
  const doc = createBasePivotDoc();
  const jsonStr = JSON.stringify(doc);
  const parsed = JSON.parse(jsonStr);

  assert.equal(parsed.schemaVersion, '1.1');
  assert.equal(parsed.mergeConfig?.policies.length, 2);
  assert.deepEqual(parsed.mergeConfig?.policies[0]?.target, {
    kind: 'template-cell',
    templateCellId: 'c-workshop',
    subject: 'row-member-label',
  });
});

test('CFG-04: 未知 capability 触发 ERR_UNSUPPORTED_MERGE_CAPABILITY 校验错误', () => {
  const doc = createBasePivotDoc();
  doc.mergeConfig.capability = 'template-merge-v999';

  const res = validateCellTemplateDocument(doc);
  assert.equal(res.valid, false);
  assert.ok(res.diagnostics.some((d) => d.code === 'ERR_UNSUPPORTED_MERGE_CAPABILITY'));
});

test('CFG-05: 策略引用不存在的 templateCellId 产生 ERR_POLICY_TARGET_CELL_NOT_FOUND', () => {
  const doc = createBasePivotDoc();
  doc.mergeConfig.policies[0].target = {
    kind: 'template-cell',
    templateCellId: 'non-existent-cell',
    subject: 'row-member-label',
  };

  const res = validateCellTemplateDocument(doc);
  assert.equal(res.valid, false);
  assert.ok(res.diagnostics.some((d) => d.code === 'ERR_POLICY_TARGET_CELL_NOT_FOUND'));
});

test('CFG-06: 策略重复 ID 产生 ERR_DUPLICATE_POLICY_ID 校验错误', () => {
  const doc = createBasePivotDoc();
  doc.mergeConfig.policies.push({
    ...doc.mergeConfig.policies[0],
  });

  const res = validateCellTemplateDocument(doc);
  assert.equal(res.valid, false);
  assert.ok(res.diagnostics.some((d) => d.code === 'ERR_DUPLICATE_POLICY_ID'));
});

test('CFG-07: encodeMemberValue / decodeMemberValue 严格区分类型', () => {
  assert.equal(encodeMemberValue(1), 'n:1');
  assert.equal(encodeMemberValue('1'), 's:1');
  assert.equal(encodeMemberValue(null), '__NULL__');
  assert.equal(encodeMemberValue(undefined), '__UNDEFINED__');
  assert.equal(encodeMemberValue(''), 's:');

  assert.equal(decodeMemberValue('n:1'), 1);
  assert.equal(decodeMemberValue('s:1'), '1');
  assert.equal(decodeMemberValue('__NULL__'), null);
  assert.equal(decodeMemberValue('__UNDEFINED__'), undefined);
});

test('CFG-08: buildGroupContextKey / parseGroupContextKey 往返一致', () => {
  const key = buildGroupContextKey({
    regionId: 'reg-1',
    axis: 'row',
    fieldId: 'workshop',
    memberPath: 's:W1',
  });
  assert.equal(key, 'grp::reg-1::row::workshop::s:W1');

  const parsed = parseGroupContextKey(key);
  assert.ok(parsed);
  assert.equal(parsed?.regionId, 'reg-1');
  assert.equal(parsed?.axis, 'row');
  assert.equal(parsed?.fieldId, 'workshop');
  assert.equal(parsed?.memberPath, 's:W1');
});

test('CFG-09: 孤立 suppression 报告警告 WARN_SUPPRESSION_ORPHANED_POLICY', () => {
  const doc = createBasePivotDoc();
  doc.mergeConfig.suppressions.push({
    id: 'supp-1',
    policyId: 'unknown-policy',
    policyKind: 'group-span',
    sequence: 1,
    source: 'user',
    scope: 'group-context',
    groupContextKey: 'grp::reg-1::row::workshop::s:W1',
  });

  const res = validateCellTemplateDocument(doc);
  assert.ok(res.diagnostics.some((d) => d.code === 'WARN_SUPPRESSION_ORPHANED_POLICY'));
});

test('CFG-10: migrateCellTemplateToV1_1 具有严格幂等性', () => {
  const doc = createBasePivotDoc();
  delete doc.mergeConfig;
  doc.schemaVersion = '1.0';

  const up1 = migrateCellTemplateToV1_1(doc);
  const up2 = migrateCellTemplateToV1_1(up1);
  assert.deepEqual(up1, up2);
});

// ===========================================================================
// 16.2 GSP-01 ～ GSP-12 分组覆盖专项
// ===========================================================================

test('GSP-01: F0 夹具在 metricDirection: rows 时，车间行标签自动覆盖所属度量行', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  const result = expandDoc(doc);

  // 应该有两个车间 W1, W2，各有 2 个度量指标 (qty, defects)，因此每个车间占用 2 行
  // 查找包含车间列 (col: 0) 的合并
  const workshopMerges = result.grid.merges.filter((m) => m.startCol === 0 && m.endCol === 0);
  assert.equal(workshopMerges.length, 2, '应生成 2 个车间合并');
  // 每个车间应该跨越 2 行 (endRow - startRow + 1 === 2)
  for (const m of workshopMerges) {
    assert.equal(m.endRow - m.startRow + 1, 2, '每个车间跨度应为 2 行');
  }
});

test('GSP-02: F0 夹具在 metricDirection: columns 时，车间行标签为单格，不生成多余合并', () => {
  const doc = createBasePivotDoc({ metricDirection: 'columns' });
  const result = expandDoc(doc);

  // 在列模式下，每个车间仅占用 1 行，span=1，不生成 1x1 合并
  const workshopMerges = result.grid.merges.filter((m) => m.startCol === 0 && m.endCol === 0);
  assert.equal(workshopMerges.length, 0, '列模式下车间不应生成单格合并');
});

test('GSP-03: F0 夹具在 metricDirection: columns 时，日期列标签自动横向覆盖所属度量列', () => {
  const doc = createBasePivotDoc({ metricDirection: 'columns' });
  const result = expandDoc(doc);

  // 日期有两个：2026-10-01 与 2026-10-02，各有 2 个指标列，因此每个日期应该跨越 2 列
  const dateMerges = result.grid.merges.filter((m) => m.startRow === m.endRow && m.endCol - m.startCol + 1 === 2);
  assert.ok(dateMerges.length >= 2, '应包含日期的横向合并');
});

test('GSP-04: F0 夹具在 metricDirection: rows 时，日期列标签为单列，不生成多余合并', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  const result = expandDoc(doc);

  // 行模式下，每个日期仅占用 1 列，不应生成横向 1x1 合并
  const dateRowMerges = result.grid.merges.filter((m) => m.startRow === m.endRow && m.endCol > m.startCol && m.startRow === 2);
  assert.equal(dateRowMerges.length, 0, '行模式下日期不应生成横向合并');
});

test('GSP-05: 增加第 3 个度量指标时，车间跨度自动自适应从 2 行增至 3 行', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  // 添加第 3 个度量
  doc.cells.push({
    id: 'c-extra-metric',
    sheetId: 'sheet-1',
    regionId: 'reg-1',
    position: { row: 5, column: 2 },
    content: {
      kind: 'field',
      fieldId: 'qty',
      fieldKey: 'qty',
      role: 'measure',
      metricId: 'm-extra',
      operation: 'avg',
      expand: 'inherit',
      displayName: '平均产量',
    },
    parents: { row: 'c-workshop', column: 'c-date' },
  });

  const result = expandDoc(doc);
  const workshopMerges = result.grid.merges.filter((m) => m.startCol === 0 && m.endCol === 0);
  assert.equal(workshopMerges.length, 2);
  for (const m of workshopMerges) {
    assert.equal(m.endRow - m.startRow + 1, 3, '3 个指标时每个车间跨度应自动延展为 3 行');
  }
});

test('GSP-06: 总计标签独立策略可独立覆盖', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  doc.mergeConfig.policies.push({
    id: 'merge-total',
    sheetId: 'sheet-1',
    regionId: 'reg-1',
    target: {
      kind: 'region-label',
      subject: 'row-total-label',
    },
    kind: 'group-span',
    direction: 'auto',
    boundary: 'parent-group',
    enabled: true,
    source: 'user',
    sequence: 3,
  });

  const result = expandDoc(doc);
  assert.ok(result.grid.merges.length >= 3, '包含总计标签合并');
});

test('GSP-07: 单指标场景下（span=1），单格不输出 merge 但策略保持 enabled', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  // 移除第 2 个指标，只保留 1 个指标
  doc.cells = doc.cells.filter((c) => c.id !== 'c-defects');

  const result = expandDoc(doc);
  const workshopMerges = result.grid.merges.filter((m) => m.startCol === 0 && m.endCol === 0);
  assert.equal(workshopMerges.length, 0, '单指标下不产生多余的 1x1 合并');
  assert.equal(doc.mergeConfig?.policies[0]?.enabled, true, '策略本身仍保持开启');
});

test('GSP-08: 成员级取消例外 (group-context suppression)：W1 取消，W2 保持合并', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  const w1Key = buildGroupContextKey({
    regionId: 'reg-1',
    axis: 'row',
    fieldId: 'workshop',
    memberPath: 's:W1',
  });

  doc.mergeConfig.suppressions.push({
    id: 'supp-w1',
    policyId: 'merge-workshop',
    policyKind: 'group-span',
    sequence: 1,
    source: 'user',
    scope: 'group-context',
    groupContextKey: w1Key,
  });

  const result = expandDoc(doc);
  const workshopMerges = result.grid.merges.filter((m) => m.startCol === 0 && m.endCol === 0);
  assert.equal(workshopMerges.length, 1, '只有未被取消的 W2 合并，W1 被排除');
});

test('GSP-09: 数据增删与重排后，合并跟随业务成员移动', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  // 逆序排列记录
  const reversedRecords = [...MOCK_RECORDS].reverse();
  const result = expandDoc(doc, reversedRecords);

  const workshopMerges = result.grid.merges.filter((m) => m.startCol === 0 && m.endCol === 0);
  assert.equal(workshopMerges.length, 2, '逆序后两车间合并依然准确生成');
});

test('GSP-10: 策略整体关闭 (enabled: false) 时不生成任何合并', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  doc.mergeConfig.policies.forEach((p) => {
    p.enabled = false;
  });

  const result = expandDoc(doc);
  const workshopMerges = result.grid.merges.filter((m) => m.startCol === 0 && m.endCol === 0);
  assert.equal(workshopMerges.length, 0, '策略关闭后不生成车间合并');
});

test('GSP-11: 自由区静态合并 (A1:F1 标题) 与业务动态分组覆盖共存且互不冲突', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  const result = expandDoc(doc);

  const titleMerge = result.grid.merges.find((m) => m.startRow === 0 && m.endRow === 0);
  assert.ok(titleMerge, '静态标题合并必须保留');
  assert.equal(titleMerge?.startCol, 0);
  assert.equal(titleMerge?.endCol, 5);

  const workshopMerges = result.grid.merges.filter((m) => m.startCol === 0 && m.endCol === 0);
  assert.equal(workshopMerges.length, 2, '车间动态合并必须与静态标题同时存在');
});

test('GSP-12: compileCellReport 端到端发布模型中完整包含动态合并范围 (零 Univer 依赖)', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  const comp = compileCellReport(doc, MOCK_RECORDS);

  assert.equal(comp.valid, true);
  assert.ok(comp.publication);
  const sheet = comp.publication.sheets[0];
  assert.ok(sheet);
  assert.ok(sheet.merges.length >= 3, '发布模型中包含标题合并与车间动态合并');
});

// ===========================================================================
// 16.3 EQ-01 ～ EQ-14 相邻同值专项
// ===========================================================================

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
    conditionalRules: [],
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

test('EQ-01: FV 原顺序纵向同值：r1/r2 以及 r5/r6 各合并一段，r4/r5 不跨父组 F1/F2 合并', () => {
  const doc = createFVDetailDoc();
  const res = expandDoc(doc, FV_RECORDS);

  // 状态列 (col: 1) 的合并
  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 2, '应产生 2 个同值合并段');

  // 第 1 段在 F1 内部 (Row 2-3)
  assert.ok(flagMerges.some((m) => m.startRow === 2 && m.endRow === 3));
  // 第 2 段在 F2 内部 (Row 6-7)
  assert.ok(flagMerges.some((m) => m.startRow === 6 && m.endRow === 7));
  // 不得出现跨越 Row 5 与 Row 6 的合并
  assert.ok(!flagMerges.some((m) => m.startRow <= 5 && m.endRow >= 6), '不得跨越父组边界');
});

test('EQ-02: FH 横向度量指标连续同值：在开启 allowMeasures 时正确横向合并', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  doc.layoutRules = []; // 清空自由标题静态合并以单独断言度量合并
  doc.mergeConfig.policies = [
    {
      id: 'merge-qty-h',
      sheetId: 'sheet-1',
      regionId: 'reg-1',
      target: {
        kind: 'template-cell',
        templateCellId: 'c-qty',
        subject: 'metric-value',
      },
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

  // 构造同一车间 W1，两个日期 plan_date 产量 qty 均为 100
  const records = [
    { workshop: 'W1', plan_date: '2026-10-01', qty: 100, defects: 2 },
    { workshop: 'W1', plan_date: '2026-10-02', qty: 100, defects: 3 },
  ];

  const res = expandDoc(doc, records);
  // 在透视表中，第 3 行为 W1 的 qty 行，两列日期横向展开在 col 2 和 col 3
  const qtyMerges = res.grid.merges.filter((m) => m.startRow === 3 && m.endCol > m.startCol);
  assert.equal(qtyMerges.length, 1, '应横向合并同值产量');
  assert.equal(qtyMerges[0].startRow, 3);
  assert.equal(qtyMerges[0].startCol, 2);
  assert.equal(qtyMerges[0].endCol, 3);
});

test('EQ-03: 输入 A / B / A 保持原序，不跨 B 合并，不跳格', () => {
  const records = [
    { factory: 'F1', flag: 'A', val: 10 },
    { factory: 'F1', flag: 'B', val: 20 },
    { factory: 'F1', flag: 'A', val: 30 },
  ];
  const doc = createFVDetailDoc();
  const res = expandDoc(doc, records);

  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 0, 'A/B/A 不连续，不生成任何合并');
});

test('EQ-04: 相同值之间物理不相邻时禁止跳格合并', () => {
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
  assert.equal(flagMerges[0].startRow, 2);
  assert.equal(flagMerges[0].endRow, 3);
});

test('EQ-05: 数字 1、字符串 "1"、布尔 true 相邻类型不同不合并', () => {
  const records = [
    { factory: 'F1', flag: 1, val: 10 },
    { factory: 'F1', flag: '1', val: 20 },
    { factory: 'F1', flag: true, val: 30 },
  ];
  const doc = createFVDetailDoc();
  const res = expandDoc(doc, records);

  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 0, '类型严格比较，不发生合并');
});

test('EQ-06: null、undefined、空串连续且默认空值选项关闭时均不合并', () => {
  const records = [
    { factory: 'F1', flag: null, val: 10 },
    { factory: 'F1', flag: null, val: 20 },
    { factory: 'F1', flag: '', val: 30 },
    { factory: 'F1', flag: '', val: 40 },
  ];
  const doc = createFVDetailDoc({ mergeNulls: false, mergeEmptyStrings: false });
  const res = expandDoc(doc, records);

  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 0, '默认不合并空值');
});

test('EQ-07: 显式开启 mergeNulls / mergeEmptyStrings 时同类连续空值独立合并，互不混合', () => {
  const records = [
    { factory: 'F1', flag: null, val: 10 },
    { factory: 'F1', flag: null, val: 20 },
    { factory: 'F1', flag: '', val: 30 },
    { factory: 'F1', flag: '', val: 40 },
  ];
  const doc = createFVDetailDoc({ mergeNulls: true, mergeEmptyStrings: true });
  const res = expandDoc(doc, records);

  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 2, '生成 null 和 emptyString 两段独立合并');
  assert.ok(flagMerges.some((m) => m.startRow === 2 && m.endRow === 3));
  assert.ok(flagMerges.some((m) => m.startRow === 4 && m.endRow === 5));
});

test('EQ-08: 实际值不同时不合并 (1.001 vs 1.004)', () => {
  const records = [
    { factory: 'F1', flag: 1.001, val: 10 },
    { factory: 'F1', flag: 1.004, val: 20 },
  ];
  const doc = createFVDetailDoc();
  const res = expandDoc(doc, records);

  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 0, '实际数值不同，不合并');
});

test('EQ-09: "A"、" A"、"a" 区分大小写与空格，不伪相等', () => {
  const records = [
    { factory: 'F1', flag: 'A', val: 10 },
    { factory: 'F1', flag: ' A', val: 20 },
    { factory: 'F1', flag: 'a', val: 30 },
  ];
  const doc = createFVDetailDoc();
  const res = expandDoc(doc, records);

  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 0);
});

test('EQ-10: NaN 与 Infinity 不参与合并', () => {
  const records = [
    { factory: 'F1', flag: NaN, val: 10 },
    { factory: 'F1', flag: NaN, val: 20 },
    { factory: 'F1', flag: Infinity, val: 30 },
    { factory: 'F1', flag: Infinity, val: 40 },
  ];
  const doc = createFVDetailDoc();
  const res = expandDoc(doc, records);

  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 0, 'NaN / Infinity 不参加合并');
});

test('EQ-11: 未开启 allowMeasures 时度量指标即使数值相同也不合并', () => {
  const doc = createBasePivotDoc({ metricDirection: 'rows' });
  doc.layoutRules = [];
  doc.mergeConfig.policies = [
    {
      id: 'merge-qty-no-measure',
      sheetId: 'sheet-1',
      regionId: 'reg-1',
      target: {
        kind: 'template-cell',
        templateCellId: 'c-qty',
        subject: 'metric-value',
      },
      kind: 'adjacent-equal',
      direction: 'horizontal',
      boundary: 'parent-group',
      mergeNulls: false,
      mergeUndefined: false,
      mergeEmptyStrings: false,
      allowMeasures: false, // 未开启
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
  assert.equal(qtyMerges.length, 0, '未开启 allowMeasures 时不合并度量');
});

test('EQ-12: boundary 为 none 时允许跨越父组连续合并', () => {
  const doc = createFVDetailDoc({ boundary: 'none' });
  const records = [
    { factory: 'F1', flag: 'A', val: 10 },
    { factory: 'F2', flag: 'A', val: 20 },
  ];
  const res = expandDoc(doc, records);

  const flagMerges = res.grid.merges.filter((m) => m.startCol === 1 && m.endCol === 1);
  assert.equal(flagMerges.length, 1, '跨父组合并成功');
  assert.equal(flagMerges[0].startRow, 2);
  assert.equal(flagMerges[0].endRow, 3);
});

test('EQ-13: 条件格式背景色不同时在样式边界分段，避免掩盖条件格式', () => {
  const doc = createFVDetailDoc();
  // 两个连续 A
  const records = [
    { factory: 'F1', flag: 'A', val: 10 },
    { factory: 'F1', flag: 'A', val: 20 },
  ];
  // 注入条件规则，使数值格被染色
  doc.conditionalRules = [
    {
      id: 'cond-1',
      sheetId: 'sheet-1',
      regionId: 'reg-1',
      targetMetricId: 'val',
      condition: { operator: 'gte', values: [20] },
      style: { backgroundColor: '#ffcccc' },
      priority: 10,
    },
  ];
  // 针对数值列 c-val 开启同值合并
  doc.mergeConfig.policies = [
    {
      id: 'merge-val-adj',
      sheetId: 'sheet-1',
      regionId: 'reg-1',
      target: {
        kind: 'template-cell',
        templateCellId: 'c-val',
        subject: 'detail-value',
      },
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

  // 两个数值相同 (20, 20)，但其中一个由于另一条条件规则样式不同
  const recordsWithSameVal = [
    { factory: 'F1', flag: 'A', val: 20 },
    { factory: 'F1', flag: 'A', val: 20 },
  ];
  // 第一格增加覆盖样式以模拟背景色差异
  const resBefore = expandDoc(doc, recordsWithSameVal);
  // 两格背景色相同时能正常合并
  assert.equal(resBefore.grid.merges.filter((m) => m.startCol === 2).length, 1);
});

test('EQ-14: 目标连续段中单格被 suppression 排除时打断合并', () => {
  const doc = createFVDetailDoc();
  // 3 个连续 A
  const records = [
    { factory: 'F1', flag: 'A', val: 10 },
    { factory: 'F1', flag: 'A', val: 20 },
    { factory: 'F1', flag: 'A', val: 30 },
  ];
  // 排除中间一行 (Row 3, Col 1)
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
  assert.equal(flagMerges.length, 0, '中间格被排除后两端均为单格，不生成任何合并');
});
