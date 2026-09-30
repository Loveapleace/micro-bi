import assert from 'node:assert/strict';
import test from 'node:test';
import {
  zh_CN,
  en_US,
  formatMessage,
} from '../dist/esm/locale/index.js';
import {
  zh_CN as rootZhCN,
  en_US as rootEnUS,
  formatMessage as rootFormatMessage,
} from '../dist/esm/index.js';

test('locale: zh_CN 零维护成本（空字典，代码直接使用中文为 Key）', () => {
  assert.ok(typeof zh_CN === 'object');
  assert.equal(Object.keys(zh_CN).length, 0);
});

test('locale: en_US 扁平字典，以中文为 Key，英文为 Value', () => {
  assert.ok(typeof en_US === 'object');
  assert.ok(Object.keys(en_US).length > 50);

  // 关键英文文案断言
  assert.equal(en_US['列设置'], 'Column Settings');
  assert.equal(en_US['总计 (共 {count} 项)'], 'Total ({count} items)');
  assert.equal(en_US['复制'], 'Copy');
  assert.equal(en_US['导出 CSV'], 'Export CSV');
  assert.equal(en_US['占比 (份额)'], 'Share Ratio');
  assert.equal(en_US['视图渲染异常'], 'View Render Error');
  assert.equal(en_US['表格'], 'Table');
  assert.equal(en_US['求和'], 'Sum');
  assert.equal(en_US['数据转换与计算设计器'], 'Data Transform & Calculation Designer');
});

test('locale: 根模块统一导出一致性', () => {
  assert.strictEqual(rootZhCN, zh_CN);
  assert.strictEqual(rootEnUS, en_US);
  assert.strictEqual(rootFormatMessage, formatMessage);
});

test('locale: 翻译与优雅回退机制 (Fallback)', () => {
  const translate = (locale, text, params) => {
    const template = locale[text] ?? text;
    return params ? formatMessage(template, params) : template;
  };

  // 1. zh_CN 下任何词条直接输出中文
  assert.equal(translate(zh_CN, '添加固定列'), '添加固定列');
  assert.equal(translate(zh_CN, '总计 (共 {count} 项)', { count: 88 }), '总计 (共 88 项)');

  // 2. en_US 命中字典时输出英文
  assert.equal(translate(en_US, '添加固定列'), 'Add Fixed Column');
  assert.equal(translate(en_US, '总计 (共 {count} 项)', { count: 88 }), 'Total (88 items)');

  // 3. en_US 缺失某词条时，自动回退原中文，绝不空白或报错
  assert.equal(translate(en_US, '未收录的新业务词条'), '未收录的新业务词条');
  assert.equal(translate(en_US, '未收录的模版 {name} 详情', { name: '工单' }), '未收录的模版 工单 详情');
});

test('locale: formatMessage 插值模版替换', () => {
  // 单参数替换
  assert.equal(
    formatMessage('总计 (共 {count} 项)', { count: 128 }),
    '总计 (共 128 项)'
  );

  // 多参数替换
  assert.equal(
    formatMessage('{visible} / {total} 列显示', { visible: 5, total: 10 }),
    '5 / 10 列显示'
  );

  // 包含 0 或负数
  assert.equal(
    formatMessage('共 {count} 项', { count: 0 }),
    '共 0 项'
  );

  // 无占位符字符串原样返回
  assert.equal(
    formatMessage('无需替换的文本', { count: 10 }),
    '无需替换的文本'
  );

  // 参数缺省时保留占位符或不崩溃
  assert.equal(
    formatMessage('未提供参数 {missing}'),
    '未提供参数 {missing}'
  );
  assert.equal(
    formatMessage('未提供参数 {missing}', {}),
    '未提供参数 {missing}'
  );

  // null 或 undefined 不替换
  assert.equal(
    formatMessage('结果: {val}', { val: undefined }),
    '结果: {val}'
  );
});
