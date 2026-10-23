import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileCellReport, normalizeCellTemplate, expandCellTemplate } from '../dist/esm/report-template/index.js';
import { designerReducer, createInitialDesignerState } from '../dist/esm/cell-designer/designerReducer.js';
import { attachUniverDesignerEvents } from '../dist/esm/cell-designer/univerEvents.js';
import { syncDocumentFromWorkbookSnapshot } from '../dist/esm/cell-designer/syncWorkbookToTemplate.js';
import { adaptPublishedSheetToVTable } from '../dist/esm/ui/presentation/report/gridAdapter.js';
import { biGridToUniverWorksheetData } from '../dist/esm/report/buildBiGrid.js';

const example = JSON.parse(await readFile(new URL('../examples/cell-reports/workshop-delivery-quality.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(example);
const rows = [
  { id: 'a1', workshop: 'A', plan_start_time: '2026-10-01', output_qty: 10, defect_count: 1 },
  { id: 'a2', workshop: 'A', plan_start_time: '2026-10-02', output_qty: 20, defect_count: 2 },
  { id: 'a3', workshop: 'A', plan_start_time: '2026-11-01', output_qty: 30, defect_count: 3 },
  { id: 'b1', workshop: 'B', plan_start_time: '2026-10-03', output_qty: 100, defect_count: 30 },
  { id: 'b2', workshop: 'B', plan_start_time: '2026-11-02', output_qty: 40, defect_count: 4 },
];
function monthly() {
  const doc = clone();
  doc.cells.find((c) => c.id === 'plan-date').content.timeBucket.granularity = 'month';
  return doc;
}
function expanded(doc, data = rows) {
  return expandCellTemplate(doc, normalizeCellTemplate(doc), data).grid;
}
function metric(grid, metricId, workshop, month) {
  return grid.cells.find((c) => c.metricId === metricId &&
    (workshop === undefined ? c.role === 'grand-total' && !(c.rowPath || []).length : (c.rowPath || []).some((p) => p.memberKey === workshop)) &&
    (month === undefined ? !(c.colPath || c.columnPath || []).length : (c.colPath || c.columnPath || []).some((p) => p.memberKey === month)));
}

test('cell designer: save commits a focused inspector draft before reading the template', () => {
  let state = createInitialDesignerState(clone());
  state = designerReducer(state, { type: 'UPDATE_DRAFT_CONTENT', content: { value: '已编辑标题' } });
  const committed = designerReducer(state, { type: 'APPLY_DRAFT' });
  assert.equal(committed.document.cells.find((c) => c.id === 'title').content.value, '已编辑标题');
  assert.equal(committed.document.templateRevision, 2);
  assert.equal(designerReducer(committed, { type: 'APPLY_DRAFT' }), committed);
});

test('cell designer: changing selection commits to the previous cell and undo restores it', () => {
  let state = createInitialDesignerState(clone());
  state = designerReducer(state, { type: 'UPDATE_DRAFT_CONTENT', content: { value: '原目标编辑' } });
  state = designerReducer(state, { type: 'SELECT_CELL', position: { row: 4, column: 2 }, sheetId: 'sheet-1' });
  assert.equal(state.document.cells.find((c) => c.id === 'title').content.value, '原目标编辑');
  assert.equal(state.selectedCell.id, 'quantity');
  state = designerReducer(state, { type: 'UNDO' });
  assert.equal(state.document.cells.find((c) => c.id === 'title').content.value, example.cells[0].content.value);
});

test('cell designer: region layout and metric direction remain in the source document', () => {
  let state = createInitialDesignerState(clone());
  state = designerReducer(state, { type: 'UPDATE_REGION', changes: { layoutKind: 'grouped', metricDirection: 'columns' } });
  assert.equal(state.document.regions[0].layoutKind, 'grouped');
  assert.equal(state.document.regions[0].metricDirection, 'columns');
  assert.equal(designerReducer(state, { type: 'UNDO' }).document.regions[0].layoutKind, 'pivot');
});

test('cell designer: SDK double click cancels native editing, F2 remains available, events dispose', () => {
  const listeners = new Map();
  let selected;
  let advanced = 0;
  const api = { Event: { SelectionChanged: 'selection', BeforeSheetEditStart: 'edit' }, addEvent(name, fn) { listeners.set(name, fn); return { dispose: () => listeners.delete(name) }; } };
  const dispose = attachUniverDesignerEvents(api, { onSelectCell: (p) => { selected = p; }, onDoubleClicked: () => { advanced++; } });
  listeners.get('selection')({ selections: [{ startRow: 4, startColumn: 2 }], worksheet: { getSheetId: () => 'sheet-1' } });
  assert.deepEqual(selected, { row: 4, column: 2, sheetId: 'sheet-1' });
  const doubleClick = { eventType: 3, row: 4, column: 2 };
  listeners.get('edit')(doubleClick);
  assert.equal(doubleClick.cancel, true);
  assert.equal(advanced, 1);
  const f2 = { eventType: 2, keycode: 113, row: 4, column: 2 };
  listeners.get('edit')(f2);
  assert.equal(f2.cancel, undefined);
  assert.equal(advanced, 1);
  dispose();
  assert.equal(listeners.size, 0);
});

test('cell template example: both pivot directions preserve D0 intersections and weighted totals', () => {
  for (const direction of ['columns', 'rows']) {
    const doc = monthly();
    doc.regions[0].metricDirection = direction;
    const grid = expanded(doc);
    assert.equal(metric(grid, 'qty-sum', 'A', '2026-10')?.value, 30);
    assert.equal(metric(grid, 'qty-sum', 'B', '2026-10')?.value, 100);
    assert.ok(grid.cells.some((c) => c.role === 'grand-total' && c.metricId === 'qty-sum' && c.value === 200));
    assert.ok(grid.cells.some((c) => c.role === 'grand-total' && c.metricId === 'defect-rate' && c.value === 0.2 && c.displayText === '20.00%'));
  }
});

test('cell template example: new earlier/later pivot members and row removal preserve metric formatting', () => {
  const doc = monthly();
  const variants = [
    [...rows].reverse(),
    [...rows, { id: 'a4', workshop: 'A', plan_start_time: '2026-12-01', output_qty: 50, defect_count: 5 }],
    [{ id: 'b0', workshop: 'B', plan_start_time: '2026-09-01', output_qty: 5, defect_count: 0 }, ...rows],
    rows.filter((r) => r.workshop !== 'B'),
    rows.filter((r) => !r.plan_start_time.startsWith('2026-11')),
  ];
  for (const data of variants) {
    const publication = compileCellReport(doc, data).publication;
    const grid = expanded(doc, data);
    const expectedTotal = data.reduce((n, r) => n + r.output_qty, 0);
    assert.ok(grid.cells.some((c) => c.role === 'grand-total' && c.metricId === 'qty-sum' && c.value === expectedTotal));
    for (const c of grid.cells.filter((c) => c.metricId === 'defect-rate' && typeof c.value === 'number')) {
      assert.match(c.displayText, /^\d+\.\d{2}%$/);
      assert.equal(c.style.color, '#d46b08');
      assert.equal(c.style.bold, true);
    }
    const adapter = adaptPublishedSheetToVTable(publication.sheets[0], publication.styles);
    assert.ok(adapter.records.some((r) => Object.values(r).some((v) => typeof v === 'string' && v.endsWith('%'))));
  }
});

test('cell template example: grouped report and changed grouping retain numeric and percentage formats', () => {
  const doc = monthly();
  doc.regions[0].layoutKind = 'grouped';
  const date = doc.cells.find((c) => c.id === 'plan-date');
  date.content.role = 'row-dimension';
  date.content.expand = 'down';
  date.parents.row = 'workshop';
  const grid = expanded(doc);
  assert.ok(grid.cells.some((c) => c.metricId === 'qty-sum' && c.role === 'grand-total' && c.value === 200));
  assert.ok(grid.cells.some((c) => c.metricId === 'defect-rate' && c.role === 'grand-total' && c.displayText === '20.00%'));
});

test('cell template example: nonzero anchor reserves title and merges retain visible text in VTable', () => {
  const result = compileCellReport(monthly(), rows, { dataRevision: 0 });
  assert.equal(result.valid, true);
  assert.equal(result.stamp.dataRevisions.industrial_lifecycle_orders, 0);
  const sheet = result.publication.sheets[0];
  assert.equal(sheet.cells.find((c) => c.r === 0 && c.c === 0).v, '车间交付与质量交叉报表');
  assert.equal(sheet.cells.find((c) => c.r === 3 && c.c === 0).v, '承制车间');
  assert.equal(sheet.colWidths[0], 180);
  const adapter = adaptPublishedSheetToVTable(sheet, result.publication.styles);
  assert.equal(adapter.customMergeCell.find((m) => m.range.start.row === 0).text, '车间交付与质量交叉报表');
  assert.equal(adapter.columns[0].width, 180);
});

test('cell template example: template numeric values and styles transfer into the Univer grid', () => {
  const grid = expanded(monthly());
  const sheet = biGridToUniverWorksheetData(grid);
  const rate = grid.cells.find((c) => c.metricId === 'defect-rate' && typeof c.value === 'number');
  const cell = sheet.cellData[rate.row][rate.col];
  assert.equal(cell.v, rate.value);
  assert.equal(cell.t, 2);
  assert.equal(cell.s.n.pattern, '0.00%');
  assert.equal(cell.s.cl.rgb, '#d46b08');
});

test('DCR-09: CommandExecuted set-range-values captures native F2 cell edits and dispatches to template', () => {
  const listeners = new Map();
  const edits = [];
  const api = {
    Event: { SelectionChanged: 'selection', BeforeSheetEditStart: 'edit', CommandExecuted: 'command' },
    addEvent(name, fn) { listeners.set(name, fn); return { dispose: () => listeners.delete(name) }; },
  };
  const dispose = attachUniverDesignerEvents(api, {
    onCellEdited: (e) => edits.push(e),
  });

  // 模拟 F2 编辑单元格并回车提交：CommandExecuted sheet.command.set-range-values
  listeners.get('command')({
    id: 'sheet.command.set-range-values',
    params: {
      subUnitId: 'sheet-1',
      range: { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
      value: { v: '画布编辑验收' },
    },
  });

  assert.equal(edits.length, 1);
  assert.equal(edits[0].row, 0);
  assert.equal(edits[0].column, 0);
  assert.equal(edits[0].value, '画布编辑验收');

  // Reducer 应用该原生编辑
  let state = createInitialDesignerState(clone());
  state = designerReducer(state, {
    type: 'APPLY_NATIVE_CELL_EDIT',
    row: 0,
    column: 0,
    sheetId: 'sheet-1',
    value: '画布编辑验收',
  });
  assert.equal(state.document.cells.find((c) => c.position.row === 0 && c.position.column === 0).content.value, '画布编辑验收');
  assert.equal(state.selectedCell.content.value, '画布编辑验收');

  dispose();
});

test('DCR-09: syncDocumentFromWorkbookSnapshot accurately syncs canvas edits, merges, and styles back into template', () => {
  const doc = clone();
  const mockSnapshot = {
    sheetOrder: ['sheet-1'],
    styles: {
      s1: { bl: 1, cl: { rgb: '#ff0000' }, ht: 2 },
    },
    sheets: {
      'sheet-1': {
        mergeData: [
          { startRow: 0, endRow: 0, startColumn: 0, endColumn: 4 },
        ],
        cellData: {
          0: {
            0: { v: '画布编辑验收', s: 's1' },
          },
          1: {
            2: { v: '新增自由说明' },
          },
        },
      },
    },
  };

  const synced = syncDocumentFromWorkbookSnapshot(doc, mockSnapshot, 'design');
  const titleCell = synced.cells.find((c) => c.position.row === 0 && c.position.column === 0);
  assert.equal(titleCell.content.value, '画布编辑验收');
  assert.equal(titleCell.style.bold, true);
  assert.equal(titleCell.style.color, '#ff0000');
  assert.equal(titleCell.style.textAlign, 'center');

  const newFreeCell = synced.cells.find((c) => c.position.row === 1 && c.position.column === 2);
  assert.ok(newFreeCell);
  assert.equal(newFreeCell.content.value, '新增自由说明');

  // 合并意图同步
  const mergeRule = synced.layoutRules.find((r) => r.kind === 'merge');
  assert.ok(mergeRule);
  assert.equal(mergeRule.range.endColumn, 4);

  // 编译确认 VTable 发布模型体现该标题
  const compiled = compileCellReport(synced, rows);
  assert.equal(compiled.publication.sheets[0].cells.find((c) => c.r === 0 && c.c === 0).v, '画布编辑验收');
});

test('cell designer: switching literal -> field -> literal preserves text and leaves draft clean', () => {
  const docWithLabel = clone();
  docWithLabel.cells.push({
    id: 'qty-header',
    sheetId: 'sheet-1',
    position: { row: 4, column: 1 },
    content: { kind: 'literal', value: '交付件数' },
    parents: { row: null, column: null },
  });

  let state = createInitialDesignerState(docWithLabel);
  // Select B5 (row 4, col 1)
  state = designerReducer(state, { type: 'SELECT_CELL', position: { row: 4, column: 1 }, sheetId: 'sheet-1' });
  assert.equal(state.draftDirty, false);
  assert.equal(state.selectedCell.content.value, '交付件数');

  // User accidentally switches to field
  state = designerReducer(state, {
    type: 'UPDATE_DRAFT_CONTENT',
    content: {
      kind: 'field',
      fieldId: 'f-output_qty',
      fieldKey: 'output_qty',
      role: 'measure',
      operation: 'sum',
      expand: 'inherit',
      displayName: '交付件数',
    },
  });
  assert.equal(state.draftDirty, true);

  // User realizes mistake and switches back to literal with original value
  state = designerReducer(state, {
    type: 'UPDATE_DRAFT_CONTENT',
    content: {
      kind: 'literal',
      value: '交付件数',
    },
  });
  // Should be recognized as idempotent / clean
  assert.equal(state.draftDirty, false);

  // Clicking another blank cell (e.g. H12: row 11, col 7) should NOT overwrite B5
  state = designerReducer(state, { type: 'SELECT_CELL', position: { row: 11, column: 7 }, sheetId: 'sheet-1' });
  const b5After = state.document.cells.find((c) => c.position.row === 4 && c.position.column === 1);
  assert.equal(b5After.content.kind, 'literal');
  assert.equal(b5After.content.value, '交付件数');
});

test('cell designer: REVERT_DRAFT restores original cell and prevents accidental commit on selection change', () => {
  const docWithLabel = clone();
  docWithLabel.cells.push({
    id: 'qty-header',
    sheetId: 'sheet-1',
    position: { row: 4, column: 1 },
    content: { kind: 'literal', value: '交付件数' },
    parents: { row: null, column: null },
  });

  let state = createInitialDesignerState(docWithLabel);
  // Select B5
  state = designerReducer(state, { type: 'SELECT_CELL', position: { row: 4, column: 1 }, sheetId: 'sheet-1' });

  // Accidentally change to field
  state = designerReducer(state, {
    type: 'UPDATE_DRAFT_CONTENT',
    content: {
      kind: 'field',
      fieldId: 'f-order_code',
      fieldKey: 'order_code',
      role: 'measure',
      operation: 'sum',
      expand: 'inherit',
      displayName: '工单流水号',
    },
  });
  assert.equal(state.draftDirty, true);

  // User clicks Revert button
  state = designerReducer(state, { type: 'REVERT_DRAFT' });
  assert.equal(state.draftDirty, false);
  assert.equal(state.selectedCell.content.kind, 'literal');
  assert.equal(state.selectedCell.content.value, '交付件数');

  // Clicking another cell does not commit the reverted change
  state = designerReducer(state, { type: 'SELECT_CELL', position: { row: 11, column: 7 }, sheetId: 'sheet-1' });
  const b5After = state.document.cells.find((c) => c.position.row === 4 && c.position.column === 1);
  assert.equal(b5After.content.kind, 'literal');
  assert.equal(b5After.content.value, '交付件数');
});

test('Report wizard template: generates repeating metric labels, group-span merge, and compact published bounds', () => {
  const dataset = [
    { id: 1, workshop: '1号车间', month: '2026-03', output_qty: 100, defect_count: 5 },
    { id: 2, workshop: '1号车间', month: '2026-04', output_qty: 120, defect_count: 6 },
    { id: 3, workshop: '2号车间', month: '2026-03', output_qty: 200, defect_count: 10 },
    { id: 4, workshop: '2号车间', month: '2026-04', output_qty: 210, defect_count: 12 },
  ];

  const rowDimCellId = 'cell-row-dim-workshop';
  const colDimCellId = 'cell-col-dim-month';
  const sheetId = 'sheet-1';
  const regionId = 'region-1';

  const doc = {
    documentType: 'cell-template',
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'test-wizard-pivot',
    title: '车间 × 月份 双向交叉表',
    templateRevision: 1,
    sheets: [{ id: sheetId, name: '交叉分析' }],
    regions: [{ id: regionId, datasetId: 'ds-1', sheetId, anchor: { row: 2, column: 0 }, filters: [] }],
    cells: [
      { id: 'title', sheetId, position: { row: 0, column: 0 }, content: { kind: 'literal', value: '车间 × 月份 双向交叉表' }, parents: { row: null, column: null } },
      { id: 'hdr-row', sheetId, position: { row: 2, column: 0 }, content: { kind: 'literal', value: '车间' }, parents: { row: null, column: null } },
      { id: 'hdr-metric', sheetId, position: { row: 2, column: 1 }, content: { kind: 'literal', value: '指标名称' }, parents: { row: null, column: null } },
      { id: colDimCellId, sheetId, regionId, position: { row: 2, column: 2 }, content: { kind: 'field', fieldId: 'month', fieldKey: 'month', role: 'column-dimension', operation: 'group', expand: 'right', displayName: '月份' }, parents: { row: null, column: null } },
      { id: rowDimCellId, sheetId, regionId, position: { row: 3, column: 0 }, content: { kind: 'field', fieldId: 'workshop', fieldKey: 'workshop', role: 'row-dimension', operation: 'group', expand: 'down', displayName: '车间' }, parents: { row: null, column: null } },
      // Metric 1: output_qty (SUM)
      { id: 'lbl-output', sheetId, regionId, position: { row: 3, column: 1 }, content: { kind: 'literal', value: '产量' }, parents: { row: rowDimCellId, column: null } },
      { id: 'meas-output', sheetId, regionId, position: { row: 3, column: 2 }, content: { kind: 'field', fieldId: 'output_qty', fieldKey: 'output_qty', role: 'measure', operation: 'sum', expand: 'inherit', displayName: '产量' }, parents: { row: rowDimCellId, column: colDimCellId } },
      // Metric 2: defect_count (SUM)
      { id: 'lbl-defect', sheetId, regionId, position: { row: 4, column: 1 }, content: { kind: 'literal', value: '不良数' }, parents: { row: rowDimCellId, column: null } },
      { id: 'meas-defect', sheetId, regionId, position: { row: 4, column: 2 }, content: { kind: 'field', fieldId: 'defect_count', fieldKey: 'defect_count', role: 'measure', operation: 'sum', expand: 'inherit', displayName: '不良数' }, parents: { row: rowDimCellId, column: colDimCellId } },
    ],
    layoutRules: [
      { id: 'merge-title', kind: 'merge', sheetId, range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 4 }, source: 'user', sequence: 1 },
      { id: 'col-w-0', kind: 'column-width', sheetId, index: 0, size: 160, source: 'preset', sequence: 2 },
      { id: 'col-w-1', kind: 'column-width', sheetId, index: 1, size: 130, source: 'preset', sequence: 3 },
    ],
    mergeConfig: {
      capability: 'template-merge-v1',
      identityVersion: 1,
      legacyFallback: 'explicit-only',
      policies: [
        {
          id: `merge-policy-${rowDimCellId}`,
          sheetId,
          regionId,
          target: { kind: 'template-cell', templateCellId: rowDimCellId, subject: 'row-member-label' },
          kind: 'group-span',
          direction: 'vertical',
          enabled: true,
          boundary: 'parent-group',
          source: 'preset',
          sequence: 1,
        },
      ],
      suppressions: [],
    },
  };

  const compiled = compileCellReport(doc, dataset);
  assert.equal(compiled.valid, true);
  const sheet = compiled.publication.sheets[0];

  // 1. 验证每个车间（1号车间、2号车间）都具备完整的指标标签
  const labelsInCol1 = sheet.cells.filter((c) => c.c === 1 && c.r >= 3).sort((a, b) => a.r - b.r);
  assert.equal(labelsInCol1.length, 4, '必须为每个车间都生成对应的 2 个指标标签行');
  assert.equal(labelsInCol1[0].displayText, '产量');
  assert.equal(labelsInCol1[1].displayText, '不良数');
  assert.equal(labelsInCol1[2].displayText, '产量');   // 2号车间也有产量标签！
  assert.equal(labelsInCol1[3].displayText, '不良数'); // 2号车间也有不良数标签！

  // 2. 验证 group-span 垂直合并：车间单元格跨所有指标行纵向合并
  const dimMerges = sheet.merges.filter((m) => m.startCol === 0 && m.endCol === 0);
  assert.equal(dimMerges.length, 2, '两个车间都应具有垂直跨度合并');
  assert.equal(dimMerges[0].startRow, 3);
  assert.equal(dimMerges[0].endRow, 4); // 跨 2 个指标行
  assert.equal(dimMerges[1].startRow, 5);
  assert.equal(dimMerges[1].endRow, 6); // 跨 2 个指标行

  // 3. 验证紧凑边界裁切：精确4列（车间、指标、2026-03、2026-04），7行（标题、空、表头、2车间*2指标），无冗余空行列
  assert.equal(sheet.colCount, 4, '列数应精确紧凑裁切为4列，无右侧多余空列');
  assert.equal(sheet.rowCount, 7, '行数应精确紧凑裁切为7行，无底部多余空行');

  // 4. 验证列宽规则生效
  assert.equal(sheet.colWidths?.[0], 160);
  assert.equal(sheet.colWidths?.[1], 130);
});

test('cell designer: INSERT_COLUMNS shifts cells/layout/regions and expands hierarchical pivot correctly', () => {
  // 1. Initial template: A: workshop (row 2, col 0), B: date (row 1, col 1), B: delivered (row 2, col 1)
  const initialDoc = {
    documentType: 'cell-template',
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-insert-col-test',
    title: '插入列测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1', anchor: { row: 2, column: 0 }, filters: [] }],
    cells: [
      {
        id: 'c-workshop',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 2, column: 0 },
        parents: { row: 'default', column: 'default' },
        content: { kind: 'field', fieldId: 'workshop', fieldKey: 'workshop', role: 'row-dimension', operation: 'group', expand: 'down' },
      },
      {
        id: 'c-date',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 1 },
        parents: { row: 'default', column: 'default' },
        content: { kind: 'field', fieldId: 'plan_date', fieldKey: 'plan_date', role: 'column-dimension', operation: 'group', expand: 'right' },
      },
      {
        id: 'c-delivered',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 2, column: 1 },
        parents: { row: 'default', column: 'default' },
        content: { kind: 'field', fieldId: 'delivered', fieldKey: 'delivered', role: 'measure', operation: 'sum', expand: 'none' },
      },
    ],
    layoutRules: [
      { id: 'w0', kind: 'column-width', sheetId: 'sheet-1', index: 0, size: 150 },
      { id: 'w1', kind: 'column-width', sheetId: 'sheet-1', index: 1, size: 100 },
    ],
  };

  let state = createInitialDesignerState(initialDoc);

  // 2. Dispatch INSERT_COLUMNS at column 1 (1 column)
  state = designerReducer(state, {
    type: 'INSERT_COLUMNS',
    sheetId: 'sheet-1',
    startIndex: 1,
    count: 1,
  });

  // Verify shifting
  const workshopCell = state.document.cells.find((c) => c.id === 'c-workshop');
  const dateCell = state.document.cells.find((c) => c.id === 'c-date');
  const deliveredCell = state.document.cells.find((c) => c.id === 'c-delivered');

  assert.equal(workshopCell.position.column, 0);
  assert.equal(dateCell.position.column, 2);
  assert.equal(deliveredCell.position.column, 2);
  const shiftedWidthRule = state.document.layoutRules.find((r) => r.id === 'w1');
  assert.equal(shiftedWidthRule.index, 2);
  assert.equal(shiftedWidthRule.size, 100);

  // 3. User selects newly inserted column B (row 2, col 1) and sets it to part_name
  state = designerReducer(state, {
    type: 'SELECT_CELL',
    sheetId: 'sheet-1',
    position: { row: 2, column: 1 },
  });
  state = designerReducer(state, {
    type: 'UPDATE_DRAFT_CONTENT',
    content: {
      kind: 'field',
      fieldId: 'f-part_name',
      fieldKey: 'part_name',
      displayName: '加工工件名称',
      role: 'row-dimension',
      operation: 'group',
      expand: 'down',
    },
  });
  state = designerReducer(state, { type: 'APPLY_DRAFT' });

  const partCell = state.document.cells.find((c) => c.content.kind === 'field' && c.content.fieldKey === 'part_name');
  assert.ok(partCell);
  assert.equal(partCell.position.column, 1);
  assert.equal(partCell.parents.row, 'default');

  // 4. Test snapshot sync: placeholder like "{计划投产时间 →}" in workbook snapshot must NOT be saved as literal
  const mockSnapshot = {
    sheets: {
      'sheet-1': {
        cellData: {
          '1': {
            '2': { v: '{计划投产时间 →}' },
            '3': { v: '{计划投产时间 →}' },
          },
        },
      },
    },
  };
  const syncedDoc = syncDocumentFromWorkbookSnapshot(state.document, mockSnapshot);
  // Ensure no cell with literal "{计划投产时间 →}" was created
  const leakedPlaceholder = syncedDoc.cells.find((c) => c.content.kind === 'literal' && c.content.value === '{计划投产时间 →}');
  assert.equal(leakedPlaceholder, undefined, '占位符字符串绝不应被固化为静态单元格');

  // 5. Expand with multi-level data
  const testData = [
    { workshop: '一车间', part_name: '齿轮', plan_date: '2026-08', delivered: 50 },
    { workshop: '一车间', part_name: '轴承', plan_date: '2026-08', delivered: 30 },
    { workshop: '一车间', part_name: '齿轮', plan_date: '2026-09', delivered: 70 },
    { workshop: '二车间', part_name: '法兰', plan_date: '2026-08', delivered: 100 },
  ];

  const compiled = compileCellReport(state.document, testData);
  assert.equal(compiled.valid, true);
  const outSheet = compiled.publication.sheets[0];

  // 验证日期列在横向展开，无未编译模板占位符
  const placeholderCell = outSheet.cells.find((c) => String(c.displayText || c.raw).includes('{计划投产时间'));
  assert.equal(placeholderCell, undefined, '展开后不应存在未编译的 {计划投产时间}');

  // 验证车间与工件层级展开正确
  const workshop1Cells = outSheet.cells.filter((c) => c.displayText === '一车间');
  assert.ok(workshop1Cells.length > 0);
  const gearCells = outSheet.cells.filter((c) => c.displayText === '齿轮');
  assert.ok(gearCells.length > 0);
  const bearingCells = outSheet.cells.filter((c) => c.displayText === '轴承');
  assert.ok(bearingCells.length > 0);
});

test('cell designer: SET_DYNAMIC_MERGE_POLICY normalizes mismatched regionId and passes validator', () => {
  const doc = {
    id: 'test-wizard-doc',
    title: '向导报表',
    documentType: 'cell-template',
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'region-1', sheetId: 'sheet-1', datasetId: 'ds-1' }],
    cells: [
      {
        id: 'c-order',
        sheetId: 'sheet-1',
        regionId: 'region-1',
        position: { row: 3, column: 0 },
        content: { kind: 'field', role: 'row-dimension', fieldKey: 'order_code', expand: 'down', operation: 'group' },
      },
    ],
  };

  const state = createInitialDesignerState(doc);

  // 模拟用户在新增列上绑定承制车间，但传入了未对齐的 regionId 'r1'
  const nextState = designerReducer(state, {
    type: 'SET_DYNAMIC_MERGE_POLICY',
    policy: {
      id: 'merge-c-mvhqyyos-c',
      sheetId: 'sheet-1',
      regionId: 'r1', // 模拟旧 Inspector 传入的 r1
      target: {
        kind: 'template-cell',
        templateCellId: 'c-workshop',
        subject: 'row-member-label',
      },
      kind: 'group-span',
      direction: 'vertical',
      enabled: true,
      boundary: 'parent-group',
      source: 'user',
      sequence: 10,
    },
  });

  const updatedPolicy = nextState.document.mergeConfig.policies.find((p) => p.id === 'merge-c-mvhqyyos-c');
  assert.ok(updatedPolicy, '策略应当存在');
  assert.equal(updatedPolicy.regionId, 'region-1', '应当自动归一化为当前文档的活动区域 region-1，而不是残留 r1');

  // 验证 compileCellReport 编译通过，无 ERR_POLICY_INVALID_REGION
  const compiled = compileCellReport(nextState.document, [
    { order_code: 'WO01', workshop: '车间A' },
  ]);
  const regionErr = compiled.diagnostics.find((d) => d.code === 'ERR_POLICY_INVALID_REGION');
  assert.equal(regionErr, undefined, '不应报 ERR_POLICY_INVALID_REGION 错误');
});

test('Pivot table: adding 3rd custom metric row repeats label and formula across all row instances', () => {
  const dataset = [
    { id: 1, wo_code: 'WO-1', month: '2026-08', duration_hours: 50, output_qty: 100 },
    { id: 2, wo_code: 'WO-2', month: '2026-08', duration_hours: 80, output_qty: 200 },
  ];

  const sheetId = 'sheet-1';
  const regionId = 'reg-1';

  const doc = {
    documentType: 'cell-template',
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'test-pivot-3rd-metric',
    title: '工单 × 月份 透视表',
    templateRevision: 1,
    sheets: [{ id: sheetId, name: 'Sheet1' }],
    regions: [{ id: regionId, datasetId: 'ds-1', sheetId, anchor: { row: 2, column: 0 }, filters: [] }],
    cells: [
      { id: 'hdr-wo', sheetId, position: { row: 2, column: 0 }, content: { kind: 'literal', value: '工单号' }, parents: { row: null, column: null } },
      { id: 'hdr-metric', sheetId, position: { row: 2, column: 1 }, content: { kind: 'literal', value: '指标名称' }, parents: { row: null, column: null } },
      { id: 'col-dim', sheetId, regionId, position: { row: 2, column: 2 }, content: { kind: 'field', fieldKey: 'month', role: 'column-dimension', operation: 'group', expand: 'right' }, parents: { row: null, column: null } },
      { id: 'row-dim', sheetId, regionId, position: { row: 3, column: 0 }, content: { kind: 'field', fieldKey: 'wo_code', role: 'row-dimension', operation: 'group', expand: 'down' }, parents: { row: null, column: null } },
      // Metric 1: duration_hours
      { id: 'lbl-1', sheetId, regionId, position: { row: 3, column: 1 }, content: { kind: 'literal', value: '耗时' }, parents: { row: 'default', column: null } },
      { id: 'val-1', sheetId, regionId, position: { row: 3, column: 2 }, content: { kind: 'field', fieldKey: 'duration_hours', role: 'measure', operation: 'sum', expand: 'inherit' }, parents: { row: 'default', column: 'default' } },
      // Metric 2: output_qty
      { id: 'lbl-2', sheetId, regionId, position: { row: 4, column: 1 }, content: { kind: 'literal', value: '件数' }, parents: { row: 'default', column: null } },
      { id: 'val-2', sheetId, regionId, position: { row: 4, column: 2 }, content: { kind: 'field', fieldKey: 'output_qty', role: 'measure', operation: 'sum', expand: 'inherit' }, parents: { row: 'default', column: 'default' } },
      // Metric 3: User added "单件工时" with formula
      { id: 'lbl-3', sheetId, regionId, position: { row: 5, column: 1 }, content: { kind: 'literal', value: '单件工时' }, parents: { row: 'default', column: null } },
      { id: 'val-3', sheetId, regionId, position: { row: 5, column: 2 }, content: { kind: 'business-formula', metricId: 'unit_time', expression: '[SUM(duration_hours)] / [SUM(output_qty)]', scope: 'summary' }, parents: { row: 'default', column: 'default' } },
    ],
    layoutRules: [],
    mergeConfig: {
      capability: 'template-merge-v1',
      identityVersion: 1,
      legacyFallback: 'explicit-only',
      policies: [
        {
          id: 'merge-policy-row-dim',
          sheetId,
          regionId,
          target: { kind: 'template-cell', templateCellId: 'row-dim', subject: 'row-member-label' },
          kind: 'group-span',
          direction: 'vertical',
          enabled: true,
          boundary: 'parent-group',
          source: 'preset',
          sequence: 1,
        },
      ],
      suppressions: [],
    },
  };

  const compiled = compileCellReport(doc, dataset);
  assert.equal(compiled.valid, true);
  const sheet = compiled.publication.sheets[0];

  // 验证 Col 1 上的每个指标标签，WO-1 和 WO-2 都必须拥有 3 个指标标签！
  const col1Labels = sheet.cells.filter((c) => c.c === 1 && c.r >= 3).sort((a, b) => a.r - b.r);
  assert.equal(col1Labels.length, 6, '两个工单应各自拥有完整的 3 个指标标签行');
  assert.equal(col1Labels[0].displayText, '耗时');
  assert.equal(col1Labels[1].displayText, '件数');
  assert.equal(col1Labels[2].displayText, '单件工时'); // WO-1 单件工时
  assert.equal(col1Labels[3].displayText, '耗时');
  assert.equal(col1Labels[4].displayText, '件数');
  assert.equal(col1Labels[5].displayText, '单件工时'); // WO-2 单件工时！

  // 验证公式计算结果在两个工单中均已求值：WO-1 = 50 / 100 = 0.5; WO-2 = 80 / 200 = 0.4
  const formulaCells = sheet.cells.filter((c) => c.c === 2 && (c.r === 5 || c.r === 8)).sort((a, b) => a.r - b.r);
  assert.equal(formulaCells.length, 2);
  assert.equal(formulaCells[0].v, 0.5);
  assert.equal(formulaCells[1].v, 0.4);

  // 验证垂直合并跨越 3 行
  const merges = sheet.merges.filter((m) => m.startCol === 0 && m.endCol === 0);
  assert.equal(merges.length, 2);
  assert.equal(merges[0].startRow, 3);
  assert.equal(merges[0].endRow, 5); // 跨 3 行 (3, 4, 5)
  assert.equal(merges[1].startRow, 6);
  assert.equal(merges[1].endRow, 8); // 跨 3 行 (6, 7, 8)
});

test('Pivot table: smart driver scope resolves literal label even if parents.row was omitted/null', () => {
  const dataset = [
    { id: 1, wo_code: 'WO-1', month: '2026-08', duration_hours: 50, output_qty: 100 },
    { id: 2, wo_code: 'WO-2', month: '2026-08', duration_hours: 80, output_qty: 200 },
  ];

  const sheetId = 'sheet-1';
  const regionId = 'reg-1';

  // lbl-3 has parents: { row: null, column: null }
  const doc = {
    documentType: 'cell-template',
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'test-pivot-smart-scope',
    title: '智能父格决议透视表',
    templateRevision: 1,
    sheets: [{ id: sheetId, name: 'Sheet1' }],
    regions: [{ id: regionId, datasetId: 'ds-1', sheetId, anchor: { row: 2, column: 0 }, filters: [] }],
    cells: [
      { id: 'hdr-wo', sheetId, position: { row: 2, column: 0 }, content: { kind: 'literal', value: '工单号' }, parents: { row: null, column: null } },
      { id: 'hdr-metric', sheetId, position: { row: 2, column: 1 }, content: { kind: 'literal', value: '指标名称' }, parents: { row: null, column: null } },
      { id: 'col-dim', sheetId, regionId, position: { row: 2, column: 2 }, content: { kind: 'field', fieldKey: 'month', role: 'column-dimension', operation: 'group', expand: 'right' }, parents: { row: null, column: null } },
      { id: 'row-dim', sheetId, regionId, position: { row: 3, column: 0 }, content: { kind: 'field', fieldKey: 'wo_code', role: 'row-dimension', operation: 'group', expand: 'down' }, parents: { row: null, column: null } },
      { id: 'lbl-1', sheetId, regionId, position: { row: 3, column: 1 }, content: { kind: 'literal', value: '耗时' }, parents: { row: 'default', column: null } },
      { id: 'val-1', sheetId, regionId, position: { row: 3, column: 2 }, content: { kind: 'field', fieldKey: 'duration_hours', role: 'measure', operation: 'sum', expand: 'inherit' }, parents: { row: 'default', column: 'default' } },
      { id: 'lbl-2', sheetId, regionId, position: { row: 4, column: 1 }, content: { kind: 'literal', value: '件数' }, parents: { row: 'default', column: null } },
      { id: 'val-2', sheetId, regionId, position: { row: 4, column: 2 }, content: { kind: 'field', fieldKey: 'output_qty', role: 'measure', operation: 'sum', expand: 'inherit' }, parents: { row: 'default', column: 'default' } },
      // lbl-3 has null parents, but sits alongside formula at (5, 2) and below lbl-1/2 at col 1
      { id: 'lbl-3', sheetId, regionId, position: { row: 5, column: 1 }, content: { kind: 'literal', value: '单件工时' }, parents: { row: null, column: null } },
      { id: 'val-3', sheetId, regionId, position: { row: 5, column: 2 }, content: { kind: 'business-formula', metricId: 'unit_time', expression: '[SUM(duration_hours)] / [SUM(output_qty)]', scope: 'summary' }, parents: { row: 'default', column: 'default' } },
    ],
    layoutRules: [],
    mergeConfig: {
      capability: 'template-merge-v1',
      identityVersion: 1,
      legacyFallback: 'explicit-only',
      policies: [
        {
          id: 'merge-policy-row-dim',
          sheetId,
          regionId,
          target: { kind: 'template-cell', templateCellId: 'row-dim', subject: 'row-member-label' },
          kind: 'group-span',
          direction: 'vertical',
          enabled: true,
          boundary: 'parent-group',
          source: 'preset',
          sequence: 1,
        },
      ],
      suppressions: [],
    },
  };

  const compiled = compileCellReport(doc, dataset);
  assert.equal(compiled.valid, true);
  const sheet = compiled.publication.sheets[0];

  const col1Labels = sheet.cells.filter((c) => c.c === 1 && c.r >= 3).sort((a, b) => a.r - b.r);
  assert.equal(col1Labels.length, 6, '即便 parents.row 为 null，位于度量标签列的单件工时也应被智能决议并在两个工单下重复展开');
  assert.equal(col1Labels[2].displayText, '单件工时');
  assert.equal(col1Labels[5].displayText, '单件工时');
});
