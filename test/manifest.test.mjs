import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);

/** 把 exports 字段里所有字符串目标摊平。 */
function collectTargets(value, out = []) {
  if (typeof value === 'string') {
    out.push(value);
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) {
      collectTargets(child, out);
    }
  }
  return out;
}

const toLocalUrl = (rel) => new URL(`../${rel.replace(/^\.\//, '')}`, import.meta.url);

test('package.json: 关键字段符合预期', () => {
  assert.equal(pkg.name, '@hw/dynamic-data');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.ok(typeof pkg.description === 'string' && pkg.description.length > 0, '描述不能为空');
  assert.equal(pkg.license, 'MIT');
  assert.ok(pkg.main, '缺少 main');
  assert.ok(pkg.module, '缺少 module');
  assert.ok(pkg.types, '缺少 types');
  assert.equal(pkg.sideEffects, false);
});

test('package.json: 已声明发布白名单与发布配置', () => {
  assert.ok(Array.isArray(pkg.files) && pkg.files.includes('dist'));
  assert.equal(pkg.publishConfig?.access, 'public');
  assert.ok(pkg.engines?.node);
});

test('package.json: main / module / types 指向真实文件', () => {
  for (const key of ['main', 'module', 'types']) {
    assert.ok(existsSync(toLocalUrl(pkg[key])), `${key} 指向的文件不存在: ${pkg[key]}`);
  }
});

test('package.json: exports 中每个目标都真实存在', () => {
  const targets = collectTargets(pkg.exports);
  assert.ok(targets.length >= 6, 'exports 目标数量偏少，可能存在遗漏');

  for (const target of targets) {
    assert.ok(existsSync(toLocalUrl(target)), `exports 目标不存在: ${target}`);
  }
});

test('包可被自引用解析：ESM 入口', async () => {
  const mod = await import('@hw/dynamic-data');

  assert.equal(typeof mod.createRegistry, 'function');
  assert.equal(typeof mod.VERSION, 'string');
});

test('包可被自引用解析：CJS 入口', () => {
  const mod = require('@hw/dynamic-data');

  assert.equal(typeof mod.createRegistry, 'function');
  assert.equal(typeof mod.VERSION, 'string');
});

test('包可被自引用解析：/core 子路径', async () => {
  const mod = await import('@hw/dynamic-data/core');

  assert.equal(typeof mod.createRegistry, 'function');
});

test('ESM 与 CJS 两套产物版本一致', async () => {
  const esm = await import('@hw/dynamic-data');

  assert.equal(esm.VERSION, pkg.version);
  assert.equal(require('@hw/dynamic-data').VERSION, pkg.version);
});
