import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePanelToCellTemplate } from '../dist/esm/report-template/panelToTemplateAdapter.js';
import { expandCellDrivenTemplate } from '../dist/esm/report-template/cellExpansionEngine.js';

test('Hybrid mode: compilePanelToCellTemplate respects anchorRow, anchorCol, and includeTitle', () => {
  const config = {
    datasetId: 'ds-test',
    dimensions: {
      categories: ['dept'],
      columnCategories: ['quarter'],
    },
    columns: [
      { type: 'aggregated', field: 'cost', agg: 'sum', label: '成本' },
    ],
  };

  // 1. 默认 anchorRow=2, anchorCol=0, includeTitle=true
  const defaultTmpl = compilePanelToCellTemplate(config, 'ds-test');
  assert.equal(defaultTmpl.regions[0].anchor.row, 2);
  assert.equal(defaultTmpl.regions[0].anchor.column, 0);
  const titleCell = defaultTmpl.cells.find((c) => c.id === 'title');
  assert.ok(titleCell);
  assert.equal(titleCell.position.row, 0);
  assert.equal(titleCell.position.column, 0);

  const rowDimCell = defaultTmpl.cells.find((c) => c.content.kind === 'field' && c.content.role === 'row-dimension');
  assert.equal(rowDimCell.position.row, 3);
  assert.equal(rowDimCell.position.column, 0);

  // 2. 用户删除前两行 (title与空白行) -> anchorRow=0, anchorCol=0, includeTitle=false
  const shiftedTmpl = compilePanelToCellTemplate(config, 'ds-test', {
    anchorRow: 0,
    anchorCol: 0,
    includeTitle: false,
  });
  assert.equal(shiftedTmpl.regions[0].anchor.row, 0);
  assert.equal(shiftedTmpl.regions[0].anchor.column, 0);
  const shiftedTitle = shiftedTmpl.cells.find((c) => c.id === 'title');
  assert.equal(shiftedTitle, undefined, 'anchorRow=0 且 includeTitle=false 时不应存在标题单元格');

  const shiftedRowDim = shiftedTmpl.cells.find((c) => c.content.kind === 'field' && c.content.role === 'row-dimension');
  assert.equal(shiftedRowDim.position.row, 1);
  assert.equal(shiftedRowDim.position.column, 0);

  const shiftedHdr = shiftedTmpl.cells.find((c) => c.id === 'hdr-row-name');
  assert.equal(shiftedHdr.position.row, 0);
  assert.equal(shiftedHdr.position.column, 0);

  // 3. 动态展开预览验证：数据自第 0 行紧凑展开，无任何错位或未展开占位符重叠
  const mockData = [
    { dept: '研发部', quarter: 'Q1', cost: 100 },
    { dept: '研发部', quarter: 'Q2', cost: 120 },
    { dept: '市场部', quarter: 'Q1', cost: 80 },
  ];
  const { grid } = expandCellDrivenTemplate(shiftedTmpl, mockData);
  assert.ok(grid);
  // 表头行在 Row 0
  const headerRowCells = grid.cells.filter((c) => c.row === 0);
  assert.ok(headerRowCells.some((c) => c.value === 'dept' || c.displayText === 'dept'));
  // 数据行在 Row 1 及以后展开
  const dataCells = grid.cells.filter((c) => c.row >= 1);
  assert.ok(dataCells.length > 0);
  // 不存在任何包含 "{" 的未展开占位符文本
  const unexpandedPlaceholders = grid.cells.filter((c) => typeof c.displayText === 'string' && /^\{.*\}$/.test(c.displayText));
  assert.equal(unexpandedPlaceholders.length, 0, '展开预览中不应残留任何未展开的模板占位符');
});

test('Hybrid mode: Grouped and Detail templates also adjust cleanly to anchorRow/anchorCol', () => {
  // 分组模板
  const groupedConfig = {
    datasetId: 'ds-grp',
    dimensions: { categories: ['dept', 'team'] },
    columns: [{ type: 'aggregated', field: 'revenue', agg: 'sum', label: '营收' }],
  };
  const shiftedGrouped = compilePanelToCellTemplate(groupedConfig, 'ds-grp', {
    anchorRow: 0,
    anchorCol: 1,
    includeTitle: false,
  });
  assert.equal(shiftedGrouped.regions[0].anchor.row, 0);
  assert.equal(shiftedGrouped.regions[0].anchor.column, 1);
  const priHdr = shiftedGrouped.cells.find((c) => c.id === 'hdr-pri');
  assert.equal(priHdr.position.row, 0);
  assert.equal(priHdr.position.column, 1);
  const priCell = shiftedGrouped.cells.find((c) => c.id === 'cell-pri-dept');
  assert.equal(priCell.position.row, 1);
  assert.equal(priCell.position.column, 1);

  // 明细模板
  const detailConfig = {
    datasetId: 'ds-dtl',
    dimensions: {},
    columns: [
      { type: 'fixed', field: 'order_id', label: '订单号' },
      { type: 'aggregated', field: 'amount', label: '金额' },
    ],
  };
  const shiftedDetail = compilePanelToCellTemplate(detailConfig, 'ds-dtl', {
    anchorRow: 0,
    anchorCol: 0,
    includeTitle: false,
  });
  assert.equal(shiftedDetail.regions[0].anchor.row, 0);
  assert.equal(shiftedDetail.regions[0].anchor.column, 0);
  const dtlHdr = shiftedDetail.cells.find((c) => c.id === 'hdr-order_id');
  assert.equal(dtlHdr.position.row, 0);
  assert.equal(dtlHdr.position.column, 0);
  const dtlCell = shiftedDetail.cells.find((c) => c.id === 'cell-detail-order_id');
  assert.equal(dtlCell.position.row, 1);
  assert.equal(dtlCell.position.column, 0);
});

test('Hybrid mode: extraCustomCells and extraLayoutRules safely translate on row removal without header leakage', () => {
  // 模拟用户在 Row 5 Col 0 录入了一个自由备注格，在 Row 1 Col 0 录入了一个将在删除中被销毁的临时格
  const extraCustomCells = [
    {
      id: 'custom-note-1',
      sheetId: 'sheet-1',
      position: { row: 1, column: 0 },
      content: { kind: 'literal', value: '待删除行中的备注' },
      parents: { row: null, column: null },
    },
    {
      id: 'custom-note-2',
      sheetId: 'sheet-1',
      position: { row: 5, column: 0 },
      content: { kind: 'literal', value: '底部报表批注' },
      parents: { row: null, column: null },
    },
  ];

  // 模拟删除 Row 0 到 Row 1（共计 2 行）
  const startIndex = 0;
  const count = 2;

  const translatedExtras = extraCustomCells
    .filter((c) => !(c.position.row >= startIndex && c.position.row < startIndex + count))
    .map((c) => {
      if (c.position.row >= startIndex + count) {
        return {
          ...c,
          position: {
            ...c.position,
            row: c.position.row - count,
          },
        };
      }
      return c;
    });

  assert.equal(translatedExtras.length, 1);
  assert.equal(translatedExtras[0].id, 'custom-note-2');
  // 原在 Row 5，删除 2 行后平移至 Row 3
  assert.equal(translatedExtras[0].position.row, 3);
  assert.equal(translatedExtras[0].position.column, 0);

  // 检验白名单机制：当画布平移后产生由受控向导生成的表头文本时，不能泄漏进 extraCustomCells
  const config = {
    datasetId: 'ds-test',
    dimensions: { categories: ['dept'], columnCategories: ['quarter'] },
    columns: [{ type: 'aggregated', field: 'cost', agg: 'sum', label: '成本' }],
  };
  const shiftedPanelTemplate = compilePanelToCellTemplate(config, 'ds-test', {
    anchorRow: 0,
    anchorCol: 0,
    includeTitle: false,
  });

  const panelCells = shiftedPanelTemplate.cells;
  const managedFieldKeys = new Set(
    panelCells.filter((c) => c.content.kind === 'field').map((c) => `${c.position.row},${c.position.column}`)
  );
  const defaultLiteralKeys = new Set(
    panelCells.filter((c) => c.content.kind === 'literal').map((c) => `${c.position.row},${c.position.column}`)
  );
  const panelLiteralTexts = new Set(
    panelCells
      .filter((c) => c.content.kind === 'literal' && typeof c.content.value === 'string')
      .map((c) => String(c.content.value).trim())
  );

  // 模拟 syncedDoc 中抓取到的平移后单元格
  const mockSyncedCells = [
    { position: { row: 0, column: 0 }, content: { kind: 'literal', value: 'dept' } },
    { position: { row: 0, column: 1 }, content: { kind: 'literal', value: '指标名称' } },
    { position: { row: 1, column: 0 }, content: { kind: 'literal', value: '{dept ↓}' } },
    { position: { row: 3, column: 0 }, content: { kind: 'literal', value: '底部报表批注' } },
  ];

  const newExtras = [];
  for (const c of mockSyncedCells) {
    const key = `${c.position.row},${c.position.column}`;
    if (!managedFieldKeys.has(key) && !defaultLiteralKeys.has(key)) {
      if (c.content.kind === 'field') continue;
      if (c.content.kind === 'literal' && typeof c.content.value === 'string') {
        const valStr = c.content.value.trim();
        if (/^\{.*\}$/.test(valStr) || /^=\[.*\]$/.test(valStr)) continue;
        if (panelLiteralTexts.has(valStr) && c.position.row >= 0) continue;
      }
      newExtras.push(c);
    }
  }

  // 只有“底部报表批注”作为自由单元格被采纳，受控的表头与占位符无一泄漏
  assert.equal(newExtras.length, 1);
  assert.equal(newExtras[0].content.value, '底部报表批注');
});
