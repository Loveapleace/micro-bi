import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { transformData, validateTransformConfig } from '../dist/esm/engine/index.js';
import { buildBiGrid, biGridToUniverWorksheetData } from '../dist/esm/report/index.js';
import { LivePreviewTable, DynamicDataConfigPanel, DynamicDataLocaleProvider, zh_CN } from '../dist/esm/ui/index.js';

const raw = [
  { id: 'a1', order_no: 'WO-1', part: '夹具', workshop: '一车间', plan: '2026-08-01 10:00:00', qty: 10 },
  { id: 'a2', order_no: 'WO-2', part: '夹具', workshop: '二车间', plan: '2026-08-02 10:00:00', qty: 20 },
  { id: 'a3', order_no: 'WO-3', part: '支座', workshop: '一车间', plan: '2026-08-03 10:00:00', qty: 30 },
];
const headers = { order_no: '工单流水号', part: '加工工件名称', workshop: '车间', plan: '计划投产时间', qty: '交付数' };
const EMPTY_COLUMNS = { columns: [] };

test('empty columns: transformData 降级为 detail 全量明细且不抛错', () => {
  const result = transformData(raw, { ...EMPTY_COLUMNS, headers });
  assert.equal(result.columns.length, 0);
  assert.equal(result.data.length, raw.length);
  assert.equal(result.meta.form, 'detail');
});

test('empty columns: 空数据集 + 空列配置不抛错', () => {
  const result = transformData([], { ...EMPTY_COLUMNS, headers });
  assert.deepEqual(result.data, []);
  assert.equal(result.columns.length, 0);
});

test('empty columns: buildBiGrid 输出 0 单元格空网格且可转换为 Univer 工作表', () => {
  const grid = buildBiGrid({ ...EMPTY_COLUMNS, headers }, raw, {
    analysisId: 'analysis-1',
    sheetId: 'sheet-1',
    rawHeaders: headers,
  });
  assert.equal(grid.cells.length, 0);
  assert.equal(grid.merges.length, 0);
  assert.ok(grid.rowCount > 0);
  assert.ok(grid.colCount > 0);
  const ws = biGridToUniverWorksheetData(grid, { sheetId: 'sheet-1' });
  assert.equal(Object.keys(ws.cellData).length, 0);
});

test('empty columns: LivePreviewTable 与完整面板 SSR 渲染不抛错', () => {
  const result = transformData(raw, { ...EMPTY_COLUMNS, headers });
  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(LivePreviewTable, { config: { ...EMPTY_COLUMNS, headers }, result })
  );
  assert.ok(typeof html === 'string' && html.length > 0);

  const panelHtml = ReactDOMServer.renderToStaticMarkup(
    React.createElement(
      DynamicDataLocaleProvider,
      { locale: zh_CN },
      React.createElement(DynamicDataConfigPanel, {
        datasets: [{ id: 'ds', name: '测试数据', data: raw, headers }],
        value: { ...EMPTY_COLUMNS, headers },
        showQuickPresets: true,
      })
    )
  );
  assert.ok(typeof panelHtml === 'string' && panelHtml.length > 0);
});

test('empty columns: 配置校验为 warning 而非 error（允许空表格存在，不阻断保存）', () => {
  const res = validateTransformConfig({ ...EMPTY_COLUMNS, headers }, [
    { key: 'order_no', label: '工单流水号', type: 'text', sampleValues: [] },
  ]);
  assert.equal(res.valid, true);
  assert.ok(res.issues.some((i) => i.severity === 'warning'));
  assert.ok(!res.issues.some((i) => i.severity === 'error'));
});
