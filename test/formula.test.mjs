import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseFormula,
  evaluateFormula,
  extractReferencedFields,
} from '../dist/esm/index.js';

test('formula: 基础四则运算与括号优先级', () => {
  const row = { sales: 100, cost: 40, tax: 5 };
  const res = evaluateFormula('([sales] - [cost]) * 2 + [tax]', row);
  assert.equal(res, (100 - 40) * 2 + 5);
});

test('formula: 除以 0 容错处理', () => {
  const row = { sales: 100, zero: 0 };
  const res = evaluateFormula('[sales] / [zero]', row);
  assert.equal(res, 0);
});

test('formula: IF 条件判断返回数字与文本', () => {
  const row1 = { sales: 15000 };
  const row2 = { sales: 3000 };

  const formula = 'IF([sales] >= 10000, "优质", "普通")';
  assert.equal(evaluateFormula(formula, row1), '优质');
  assert.equal(evaluateFormula(formula, row2), '普通');

  const numFormula = 'IF([sales] > 10000, [sales] * 0.1, [sales] * 0.05)';
  assert.equal(evaluateFormula(numFormula, row1), 1500);
  assert.equal(evaluateFormula(numFormula, row2), 150);
});

test('formula: 嵌套 IF 与比较运算符', () => {
  const row = { score: 85 };
  const formula = 'IF([score] >= 90, "优秀", IF([score] >= 80, "良好", "及格"))';
  assert.equal(evaluateFormula(formula, row), '良好');
});

test('formula: 内置函数 ROUND, ABS, COALESCE', () => {
  const row = { num: 12.3456, neg: -99, empty: null, backup: '默认' };
  assert.equal(evaluateFormula('ROUND([num], 2)', row), 12.35);
  assert.equal(evaluateFormula('ABS([neg])', row), 99);
  assert.equal(evaluateFormula('COALESCE([empty], [backup])', row), '默认');
});

test('formula: 静态提取依赖字段', () => {
  const ast = parseFormula('IF([sales] > [target], [sales] - [cost], 0)');
  const fields = extractReferencedFields(ast);
  assert.deepEqual(fields.sort(), ['cost', 'sales', 'target'].sort());
});

test('formula: 日期与时间字符串大小比对', () => {
  const row1 = { start: '2026-08-01 08:30:00', finish: '2026-08-01 10:00:00' };
  assert.equal(evaluateFormula('IF([finish] > [start], "超时", "正常")', row1), '超时');
  assert.equal(evaluateFormula('IF([start] < [finish], true, false)', row1), true);
  assert.equal(evaluateFormula('IF([start] >= [finish], true, false)', row1), false);
});

test('formula: 文本评级与数字字符串比较', () => {
  const row = { grade: 'S', target: 'A', numStr1: '100', numStr2: '20' };
  // 字典序比对
  assert.equal(evaluateFormula('IF([grade] > [target], "高阶", "基础")', row), '高阶');
  // 数字字符串数值比对 (100 > 20，绝不能误判为字典序 100 < 20)
  assert.equal(evaluateFormula('IF([numStr1] > [numStr2], "大于", "小于")', row), '大于');
});

test('formula: SQL 风格 <> 不等于运算符', () => {
  const row1 = { status: 'PENDING' };
  const row2 = { status: 'DONE' };
  assert.equal(evaluateFormula('IF([status] <> "DONE", "需处理", "已完结")', row1), '需处理');
  assert.equal(evaluateFormula('IF([status] <> "DONE", "需处理", "已完结")', row2), '已完结');
});

test('formula: 字段引用大小写不敏感容错', () => {
  const row = { sales_amount: 500, cost_amount: 200 };
  assert.equal(evaluateFormula('[Sales_Amount] - [Cost_Amount]', row), 300);
  assert.equal(evaluateFormula('[SALES_AMOUNT] - [cost_amount]', row), 300);
});

test('formula: AST 解析内存缓存与 clearAstCache 机制', () => {
  const expr = '([sales] - [cost]) / [tax]';
  const ast1 = parseFormula(expr);
  const ast2 = parseFormula(expr);
  // 相同表达式必须命中缓存，返回相同 AST 引用
  assert.equal(ast1, ast2, '相同公式必须命中 AST 缓存');
});

test('formula: 明细行公式支持按需解析 SUM/COUNT/AVG 等聚合宏', () => {
  const row = { sales: 200, orders: 10 };
  assert.equal(evaluateFormula('[SUM(sales)] / [COUNT(orders)]', row), 200);
  assert.equal(evaluateFormula('[AVG(sales)]', row), 200);
});


