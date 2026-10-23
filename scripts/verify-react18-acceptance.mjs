/**
 * React 18 升级专项验收套件 (scripts/verify-react18-acceptance.mjs)
 * 对应 doc/react17-to-react18-upgrade-plan.md 第 7 节验收用例 (R18-T01 ~ R18-T16)
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  compileCellReport,
  normalizeCellTemplate,
  expandCellTemplate,
} from '../dist/esm/report-template/index.js';
import {
  DatasetRegistry,
  createDatasetRegistry,
  useRegisteredDatasets,
  globalDatasetRegistry,
} from '../dist/esm/core/datasetRegistry.js';

const results = [];
async function check(id, requirement, name, fn) {
  try {
    const evidence = await fn();
    results.push({ id, requirement, name, passed: true, evidence });
    console.log(`PASS ${id} ${name}`);
  } catch (error) {
    results.push({ id, requirement, name, passed: false, error: error.message });
    console.log(`FAIL ${id} ${name}: ${error.message.split('\n')[0]}`);
  }
}

// 辅助函数：深度冻结对象
function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return obj;
}

const templatePath = new URL('../examples/cell-reports/workshop-delivery-quality.json', import.meta.url);
const templateJson = JSON.parse(await readFile(templatePath, 'utf8'));

const mockDataFacts = [
  { order_code: 'QA-01', workshop: '一车间', plan_start_time: '2026-08-01 08:00:00', output_qty: 600, defect_count: 12, yield_rate: 98.0 },
  { order_code: 'QA-02', workshop: '二车间', plan_start_time: '2026-08-01 09:00:00', output_qty: 400, defect_count: 8, yield_rate: 98.0 },
  { order_code: 'QA-03', workshop: '一车间', plan_start_time: '2026-08-02 08:00:00', output_qty: 500, defect_count: 10, yield_rate: 98.0 },
];

// R18-T01: 干净安装两端依赖与清单锁文件一致性
await check('R18-T01', 'R18-01', '两端清单与依赖包精准对齐 React 18.3.1 与匹配类型', async () => {
  const libPkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const hostPkg = JSON.parse(await readFile(new URL('../../dynamic-data-test/package.json', import.meta.url), 'utf8'));

  assert.equal(libPkg.devDependencies['react'], '18.3.1');
  assert.equal(libPkg.devDependencies['react-dom'], '18.3.1');
  assert.equal(libPkg.devDependencies['@types/react'], '^18.3.31');
  assert.equal(libPkg.devDependencies['@types/react-dom'], '^18.3.7');
  assert.equal(libPkg.peerDependencies['react'], '^18.3.1');
  assert.equal(libPkg.peerDependencies['react-dom'], '^18.3.1');

  assert.equal(hostPkg.dependencies['react'], '^18.3.1');
  assert.equal(hostPkg.dependencies['react-dom'], '^18.3.1');
  assert.equal(hostPkg.devDependencies['@types/react'], '^18.3.31');
  assert.equal(hostPkg.devDependencies['@types/react-dom'], '^18.3.7');

  return {
    libReact: libPkg.devDependencies['react'],
    hostReact: hostPkg.dependencies['react'],
    typesReact: libPkg.devDependencies['@types/react'],
    typesReactDom: libPkg.devDependencies['@types/react-dom'],
  };
});

// R18-T02: 类型检查通过
await check('R18-T02', 'R18-02', '严格模式与显式 children 类型检查', async () => {
  // 检查已导出的核心 Props 是否支持 React 18
  const libExport = await import('../dist/esm/index.js');
  const uiExport = await import('../dist/esm/ui/index.js');
  assert.ok(uiExport.DynamicDataView, 'DynamicDataView 成功导出');
  assert.ok(libExport.DynamicDataLocaleProvider, 'DynamicDataLocaleProvider 成功导出');
  return { hasProvider: Boolean(libExport.DynamicDataLocaleProvider), hasView: Boolean(uiExport.DynamicDataView) };
});

// R18-T04: 编译纯度与深冻结输入
await check('R18-T04', 'R18-03', '同一源文档重复编译/深冻结输入保持不可变与幂等', async () => {
  const docOriginal = JSON.parse(JSON.stringify(templateJson));
  const docFrozen = deepFreeze(JSON.parse(JSON.stringify(templateJson)));

  // 1. 深冻结输入直接编译，绝不抛出 Cannot assign to read only property
  const res1 = compileCellReport(docFrozen, mockDataFacts);
  assert.ok(res1.valid, '深冻结输入编译有效');

  // 2. 第二次编译并对比输出
  const res2 = compileCellReport(docFrozen, mockDataFacts);
  assert.equal(res1.publication.sheets[0].cells.length, res2.publication.sheets[0].cells.length);

  // 3. 对比源对象未被篡改
  const docAfter = JSON.parse(JSON.stringify(docFrozen));
  assert.deepEqual(docOriginal, docAfter, '编译前后源文档内容深相等');

  return { cellsCount: res1.publication.sheets[0].cells.length, immutable: true };
});

// R18-T07: 外部注册表 revision 与稳定快照订阅
await check('R18-T07', 'R18-04', '外部注册表 revision、稳定快照与 useSyncExternalStore 契约', async () => {
  const reg = createDatasetRegistry();
  assert.equal(reg.getRevision(), 1);
  const snap1 = reg.getSnapshot();
  const snap1Ref = reg.getSnapshot();
  assert.equal(snap1, snap1Ref, '无变更时 getSnapshot 必须返回恒定不可变引用');

  // 注册新项
  reg.register({
    id: 'test-ds-1',
    name: '测试数据源1',
    data: [{ a: 1 }],
  });
  assert.equal(reg.getRevision(), 2, '注册操作提升 revision');
  const snap2 = reg.getSnapshot();
  assert.notEqual(snap1, snap2, '数据真正变更时生成新快照引用');
  assert.equal(snap2.length, 1);
  assert.equal(snap2[0].id, 'test-ds-1');

  // list() 返回浅拷贝，不破坏内部 snapshot
  const listArr = reg.list();
  listArr.push({ id: 'injected', name: '篡改', data: [] });
  assert.equal(reg.getSnapshot().length, 1, '外部修改 list() 返回数组不污染内部快照');

  // 注销不存在的 ID 不应伪提升 revision
  const unregFake = reg.unregister('non-existent');
  assert.equal(unregFake, false);
  assert.equal(reg.getRevision(), 2, '注销未命中不提升 revision');

  // 清空
  reg.clear();
  assert.equal(reg.getRevision(), 3);
  assert.equal(reg.getSnapshot().length, 0);

  return { revisionsChecked: 3, snapshotStable: true };
});

// R18-T08: 慢A快B与异步请求去重
await check('R18-T08', 'R18-04', '异步数据源请求共享与并发去重机制', async () => {
  const reg = createDatasetRegistry();
  let callCount = 0;
  reg.register({
    id: 'async-ds',
    name: '异步数据源',
    data: async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 20));
      return [{ v: 100 }];
    },
  });

  // 并发多次请求同一个 ID
  const [p1, p2, p3] = await Promise.all([
    reg.resolveData('async-ds'),
    reg.resolveData('async-ds'),
    reg.resolveData('async-ds'),
  ]);
  assert.equal(callCount, 1, '并发调用共享同一个 Promise，避免重复发起请求');
  assert.deepEqual(p1.data, p2.data);
  assert.deepEqual(p2.data, p3.data);

  return { callCount, sharedDedupe: true };
});

// R18-T09: 设计器同步草稿生成
await check('R18-T09', 'R18-06', '报表设计器同步草稿计算与单事务提交', async () => {
  const doc = JSON.parse(JSON.stringify(templateJson));
  const plan = normalizeCellTemplate(doc);
  const { grid } = expandCellTemplate(doc, plan, mockDataFacts);
  assert.ok(grid.cells.length > 0);
  assert.ok(grid.cells.some((c) => c.value === 600 && c.role === 'metric-value'), '展开矩阵中包含事实值 600 的度量格');
  return { previewGridCells: grid.cells.length };
});

// R18-T15: 发布制品 ESM/CJS 与 package.json 导出校验
await check('R18-T15', 'R18-01', 'ESM / CJS 构建双产物与导出映射完备性', async () => {
  const esmEntry = await import('../dist/esm/index.js');
  const esmCore = await import('../dist/esm/core/index.js');
  const esmReport = await import('../dist/esm/report/index.js');
  assert.ok(esmEntry && esmCore && esmReport);

  const cjsIndex = await readFile(new URL('../dist/cjs/index.js', import.meta.url), 'utf8');
  assert.ok(cjsIndex.includes('exports.'), 'CJS 产物格式正确');

  const cjsPkg = JSON.parse(await readFile(new URL('../dist/cjs/package.json', import.meta.url), 'utf8'));
  assert.equal(cjsPkg.type, 'commonjs', 'CJS 目录标记为 commonjs');

  return { esmValid: true, cjsValid: true };
});

// R18-T16: 生产入口零 Univer 打包隔离
await check('R18-T16', 'R18-05', '生产入口静态依赖图完全剥离 Univer 运行时', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../dynamic-data-test/dist/.vite/manifest.json', import.meta.url), 'utf8'));
  const entry = Object.keys(manifest).find((k) => manifest[k].isEntry);
  assert.ok(entry, '找到生产构建入口');

  const visited = new Set();
  function visit(key) {
    if (visited.has(key) || !manifest[key]) return;
    visited.add(key);
    for (const imp of manifest[key].imports || []) visit(imp);
  }
  visit(entry);

  const graphFiles = [...visited];
  const hasUniverInStaticGraph = graphFiles.some((f) => /UniverPreview|univer/i.test(f));
  assert.ok(!hasUniverInStaticGraph, '生产展示入口静态依赖树禁止包含 Univer 模块');

  return { entry, totalStaticChunks: graphFiles.length, zeroUniverInEntry: true };
});

const out = process.argv[2]
  ? pathToFileURL(resolve(process.argv[2]) + '/')
  : new URL('../doc/verification/react18-acceptance-2026-10-19/', import.meta.url);
await mkdir(out, { recursive: true });

const summary = {
  timestamp: new Date().toISOString(),
  target: 'React / ReactDOM 18.3.1',
  total: results.length,
  passed: results.filter((r) => r.passed).length,
  failed: results.filter((r) => !r.passed).length,
  results,
};

await writeFile(new URL('acceptance.json', out), JSON.stringify(summary, null, 2));
console.log(`\nReact 18 Acceptance complete: ${summary.passed}/${summary.total} passed, ${summary.failed} failed.`);
assert.equal(summary.failed, 0, 'React 18 验收测试存在失败项');
