import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSheetFormula } from '../dist/esm/report-template/sheetFormulaEvaluator.js';
import { compileCellReport } from '../dist/esm/report-template/compileCellReport.js';

test('sheetFormulaEvaluator: 评估多参数与范围函数 (MAX, MIN, SUM, AVG, COUNT)', () => {
  const grid = {
    '1:1': 2, // B2
    '1:2': 3, // C2
    '1:3': 10, // D2
  };
  const cellAccessor = (r, c) => grid[`${r}:${c}`] ?? null;

  // 1. 用户真实截图场景实测：逗号分隔多参数 =MAX(B2,C2)
  const res1 = evaluateSheetFormula('=MAX(B2,C2)', cellAccessor, 1, 0);
  assert.equal(res1.error, undefined);
  assert.equal(res1.value, 3);

  // 2. 带空格的逗号多参数
  const res2 = evaluateSheetFormula('=MAX(B2, C2, 10)', cellAccessor, 1, 0);
  assert.equal(res2.error, undefined);
  assert.equal(res2.value, 10);

  // 3. 连续区域冒号引用 =MAX(B2:C2)
  const res3 = evaluateSheetFormula('=MAX(B2:C2)', cellAccessor, 1, 0);
  assert.equal(res3.error, undefined);
  assert.equal(res3.value, 3);

  // 4. MIN 函数
  const resMin = evaluateSheetFormula('=MIN(B2, C2)', cellAccessor, 1, 0);
  assert.equal(resMin.error, undefined);
  assert.equal(resMin.value, 2);

  // 5. SUM 函数 (多参数与区域)
  const resSumArgs = evaluateSheetFormula('=SUM(B2, C2, D2)', cellAccessor, 1, 0);
  assert.equal(resSumArgs.error, undefined);
  assert.equal(resSumArgs.value, 15);

  const resSumRange = evaluateSheetFormula('=SUM(B2:D2)', cellAccessor, 1, 0);
  assert.equal(resSumRange.error, undefined);
  assert.equal(resSumRange.value, 15);

  // 6. AVERAGE 函数
  const resAvg = evaluateSheetFormula('=AVERAGE(B2, C2)', cellAccessor, 1, 0);
  assert.equal(resAvg.error, undefined);
  assert.equal(resAvg.value, 2.5);

  // 7. COUNT 与 COUNTA
  const resCount = evaluateSheetFormula('=COUNT(B2, C2, D2)', cellAccessor, 1, 0);
  assert.equal(resCount.error, undefined);
  assert.equal(resCount.value, 3);
});

test('sheetFormulaEvaluator: 绝对引用、运算符、字符串拼接与逻辑判断', () => {
  const grid = {
    '1:1': 2, // B2
    '1:2': 3, // C2
  };
  const cellAccessor = (r, c) => grid[`${r}:${c}`] ?? null;

  // 1. 绝对引用 $B$2
  const resAbs = evaluateSheetFormula('=$B$2', cellAccessor, 0, 0);
  assert.equal(resAbs.error, undefined);
  assert.equal(resAbs.value, 2);

  // 2. 算术运算符
  const resArith = evaluateSheetFormula('=B2 + C2 * 2', cellAccessor, 0, 0);
  assert.equal(resArith.error, undefined);
  assert.equal(resArith.value, 8);

  // 3. 字符串拼接 (&)
  const resConcat = evaluateSheetFormula('="最大值是: " & MAX(B2,C2)', cellAccessor, 0, 0);
  assert.equal(resConcat.error, undefined);
  assert.equal(resConcat.value, '最大值是: 3');

  // 4. 逻辑条件 IF
  const resIf = evaluateSheetFormula('=IF(B2 < C2, "C2更大", "B2更大")', cellAccessor, 0, 0);
  assert.equal(resIf.error, undefined);
  assert.equal(resIf.value, 'C2更大');

  // 5. ROUND 与嵌套
  const resRound = evaluateSheetFormula('=ROUND(MAX(B2, C2) / 2, 1)', cellAccessor, 0, 0);
  assert.equal(resRound.error, undefined);
  assert.equal(resRound.value, 1.5);
});

test('compileCellReport: 完整编译包含 =MAX(B2,C2) 的报表模板，无报错且有效', () => {
  const doc = {
    documentType: 'cell-template',
    schemaVersion: '2.0',
    capabilitiesVersion: '2.0',
    id: 'test-doc-max',
    title: '用户截图还原报表',
    templateRevision: 1,
    sheets: [{ id: 'sheet-1', name: '分析工作表' }],
    regions: [
      {
        id: 'r1',
        sheetId: 'sheet-1',
        datasetId: 'ds-test',
        archetype: 'pivot',
        anchor: { row: 3, column: 0 },
      },
    ],
    cells: [
      // A1: 标题
      {
        id: 'c-title',
        sheetId: 'sheet-1',
        position: { row: 0, column: 0 },
        content: { kind: 'literal', value: '工单流水号 × 计划投产时间 双向交叉报表' },
      },
      // A2: 用户输入的公式 =MAX(B2,C2)
      {
        id: 'c-formula-max',
        sheetId: 'sheet-1',
        position: { row: 1, column: 0 },
        content: { kind: 'sheet-formula', formula: '=MAX(B2,C2)' },
      },
      // B2: 用户输入的 2
      {
        id: 'c-lit-b2',
        sheetId: 'sheet-1',
        position: { row: 1, column: 1 },
        content: { kind: 'literal', value: 2 },
      },
      // C2: 用户输入的 3
      {
        id: 'c-lit-c2',
        sheetId: 'sheet-1',
        position: { row: 1, column: 2 },
        content: { kind: 'literal', value: 3 },
      },
    ],
    layoutRules: [],
  };

  const dataset = [{ id: 1, val: 100 }];
  const result = compileCellReport(doc, dataset);

  // 核心断言：校验必须通过，绝不抛出 ERR_UNSUPPORTED_SHEET_FORMULA
  assert.equal(result.valid, true, 'compileCellReport should be valid');
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  assert.equal(errors.length, 0, 'No errors in diagnostics');

  // 检查编译产物中的 A2 单元格结果
  const sheet = result.publication.sheets[0];
  const a2Cell = sheet.cells.find((c) => c.r === 1 && c.c === 0);
  assert.ok(a2Cell, 'A2 cell should exist in published sheet');
  assert.equal(a2Cell.v, 3, 'A2 cell value should be evaluated to 3');
  assert.equal(a2Cell.displayText, '3', 'A2 displayText should be 3');
});
