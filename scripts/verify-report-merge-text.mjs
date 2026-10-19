/**
 * Focused contract diagnostic for blank merged report cells.
 * Run after the library build: node scripts/verify-report-merge-text.mjs
 * Uses production model/compiler/adapter. Browser A/B evidence is separate.
 * Does not pretend that reading records proves the Canvas renders their text.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { buildBiGrid, biGridToUniverWorksheetData } from '../dist/esm/report/index.js';
import { compileReport } from '../dist/esm/univer/compileReport.js';
import { adaptPublishedSheetToVTable } from '../dist/esm/ui/presentation/report/gridAdapter.js';

const data = [
  { workshop: '车间A', status: '运行中', date: '2026-10-01', qty: 1250 },
  { workshop: '车间A', status: '高负荷', date: '2026-11-01', qty: 1820 },
  { workshop: '车间B', status: '运行中', date: '2026-10-02', qty: 3050 },
];
function compile(config) {
  const grid = buildBiGrid(config, data);
  const worksheet = biGridToUniverWorksheetData(grid, { sheetId: 's1' });
  const publication = compileReport({ id: 'merge-diagnostic', sheetOrder: ['s1'], sheets: { s1: worksheet } }).publication;
  return { publication, sheet: publication.sheets[0], view: adaptPublishedSheetToVTable(publication.sheets[0], publication.styles) };
}
const grouped = compile({ dimensions: { categories: ['workshop', 'status'] }, columns: [{ type: 'aggregated', field: 'qty', agg: 'sum' }] });
const masterText = (view, merge) => {
  const { col, row } = merge.range.start;
  const value = view.records[row][`col_${col}`];
  return value === null || value === undefined ? '' : String(value);
};
const checks = [];
function check(id, name, run) {
  try { run(); checks.push({ id, name, status: 'passed' }); }
  catch (error) { checks.push({ id, name, status: 'failed', errorType: error.name, message: error.message,
    ...(error.actual !== undefined ? { actual: error.actual } : {}), ...(error.expected !== undefined ? { expected: error.expected } : {}) }); }
  console.log(`${checks.at(-1).status.toUpperCase()} ${id} ${name}`);
}
check('MC-01', '发布模型与records仍保留分组名称和总计', () => {
  assert.ok(grouped.sheet.cells.some(c => c.v === '车间A'));
  assert.ok(grouped.sheet.cells.some(c => c.v === '总计'));
  assert.ok(grouped.view.records.some(r => r.col_0 === '车间A'));
  assert.ok(grouped.view.records.some(r => r.col_0 === '总计'));
});
check('MC-02', '纵向分组合并必须传入主格文本', () => {
  const merge = grouped.view.customMergeCell.find(m => m.range.end.row > m.range.start.row);
  assert.ok(merge);
  assert.equal(merge.text, masterText(grouped.view, merge));
});
check('MC-03', '横向总计合并必须传入主格文本', () => {
  const merge = grouped.view.customMergeCell.find(m => m.range.end.col > m.range.start.col);
  assert.ok(merge);
  assert.equal(merge.text, '总计');
});
check('MC-04', '双轴透视表头合并必须传入对应文本', () => {
  const pivot = compile({ dimensions: { categories: ['workshop'], columnTimeBucket: { field: 'date', granularity: 'month' } }, columns: [{ type: 'aggregated', field: 'qty', agg: 'sum' }, { type: 'aggregated', field: 'qty', agg: 'avg' }] });
  assert.ok(pivot.view.customMergeCell.length > 0);
  for (const merge of pivot.view.customMergeCell) assert.equal(merge.text, masterText(pivot.view, merge));
});
function singleMerge(v, displayText) {
  return adaptPublishedSheetToVTable({ id: 's1', name: 'QA', rowCount: 1, colCount: 2,
    cells: [{ r: 0, c: 0, v, ...(displayText !== undefined ? { displayText } : {}) }],
    merges: [{ startRow: 0, endRow: 0, startCol: 0, endCol: 1 }] });
}
check('MC-05', '合并主格数字0不能变成空白', () => {
  assert.equal(singleMerge(0).customMergeCell[0].text, '0');
});
check('MC-06', '合并主格false应转换为文本而不是丢失', () => {
  assert.equal(singleMerge(false).customMergeCell[0].text, 'false');
});
check('MC-07', '有意格式化为空串时不回退到原始值', () => {
  const view = singleMerge(1234.5, '');
  assert.equal(view.records[0].col_0, '');
  assert.ok(view.customMergeCell[0].text === undefined || view.customMergeCell[0].text === '');
});
check('MC-08', '普通非合并数值仍在records中', () => {
  assert.equal(grouped.view.records[1].col_2, '1250');
  assert.equal(grouped.view.records.at(-1).col_2, '6120');
});

const evidence = { executedAt: new Date().toISOString(), vtableVersion: JSON.parse(await readFile(new URL('../node_modules/@visactor/vtable/package.json', import.meta.url), 'utf8')).version,
  scope: 'Production publication/adapter contract checks; actual Canvas causation verified separately by a main-card text-only A/B/A probe.',
  summary: { total: checks.length, passed: checks.filter(c => c.status === 'passed').length, failed: checks.filter(c => c.status === 'failed').length },
  groupedMerges: grouped.view.customMergeCell.map(m => ({ range: m.range, recordMasterText: masterText(grouped.view, m), hasTextProperty: Object.hasOwn(m, 'text'), ...(m.text !== undefined ? { mergeText: m.text } : {}) })), checks };
const output = new URL('../doc/verification/report-merge-text-2026-10-19.json', import.meta.url);
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(evidence.summary));
process.exitCode = evidence.summary.failed ? 1 : 0;
