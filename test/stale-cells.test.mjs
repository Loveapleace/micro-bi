import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBiGrid } from '../dist/esm/report/index.js';
import { collectStaleCells } from '../dist/esm/univer/gridSync.js';

const raw = [
  { id: 'a1', order_no: 'WO-1', part: '夹具', workshop: '一车间', qty: 10 },
  { id: 'a2', order_no: 'WO-2', part: '夹具', workshop: '二车间', qty: 20 },
];
const headers = { order_no: '工单流水号', part: '加工工件名称', workshop: '车间', qty: '交付数' };

function buildGrid(columns) {
  return buildBiGrid({ columns, headers }, raw, {
    analysisId: 'analysis-1',
    sheetId: 'sheet-1',
    rawHeaders: headers,
  });
}

test('stale cells: 删除全部列后，旧网格的所有业务单元格均被识别为残留', () => {
  const oldGrid = buildGrid([
    { type: 'fixed', field: 'order_no', label: '工单流水号' },
    { type: 'fixed', field: 'part', label: '加工工件名称' },
  ]);
  const newGrid = buildGrid([]);
  assert.equal(newGrid.cells.length, 0);
  // 空配置网格边界仍 ≥1（Math.max 钳制），这是边界清理失效的根因
  assert.ok(newGrid.colCount >= 1);

  const stale = collectStaleCells(oldGrid, newGrid);
  const oldCoords = oldGrid.cells.map((c) => `${c.row},${c.col}`).sort();
  const staleCoords = stale.map((c) => `${c.row},${c.col}`).sort();
  assert.deepEqual(staleCoords, oldCoords);
  assert.ok(staleCoords.includes('0,0'), '旧表头 A1 必须被识别为残留');
});

test('stale cells: 部分删除列时仅被删列的坐标为残留', () => {
  const oldGrid = buildGrid([
    { type: 'fixed', field: 'order_no', label: '工单流水号' },
    { type: 'fixed', field: 'part', label: '加工工件名称' },
  ]);
  const newGrid = buildGrid([{ type: 'fixed', field: 'order_no', label: '工单流水号' }]);
  const stale = collectStaleCells(oldGrid, newGrid);
  const staleKeys = new Set(stale.map((c) => `${c.row},${c.col}`));

  // 新网格的所有坐标必须被保留
  for (const cell of newGrid.cells) {
    assert.ok(!staleKeys.has(`${cell.row},${cell.col}`));
  }
  // 旧网格中不在新网格里的坐标必须全部识别
  const newKeys = new Set(newGrid.cells.map((c) => `${c.row},${c.col}`));
  for (const cell of oldGrid.cells) {
    const key = `${cell.row},${cell.col}`;
    assert.equal(staleKeys.has(key), !newKeys.has(key));
  }
});

test('stale cells: 网格未变化时无残留', () => {
  const grid = buildGrid([{ type: 'fixed', field: 'qty', label: '交付数' }]);
  assert.deepEqual(collectStaleCells(grid, grid), []);
});

test('stale cells: 重复坐标只报告一次', () => {
  const grid = buildGrid([{ type: 'fixed', field: 'qty', label: '交付数' }]);
  const grid2 = buildGrid([]);
  const stale = collectStaleCells(grid, grid2);
  const keys = stale.map((c) => `${c.row},${c.col}`);
  assert.equal(new Set(keys).size, keys.length);
});
