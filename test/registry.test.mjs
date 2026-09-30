import assert from 'node:assert/strict';
import test from 'node:test';

import { createRegistry } from '../dist/esm/index.js';

/** 构造一个最小的可注册项。 */
const item = (id, name = id) => ({ id, name });

test('createRegistry: 初始实现会被立即注册', () => {
  const registry = createRegistry([item('a'), item('b')]);

  assert.equal(registry.size, 2);
  assert.deepEqual(registry.ids(), ['a', 'b']);
});

test('createRegistry: register 支持链式调用并保持注册顺序', () => {
  const registry = createRegistry();

  registry.register(item('a')).register(item('b'));

  assert.deepEqual(registry.ids(), ['a', 'b']);
  assert.equal(registry.list()[0].id, 'a');
});

test('createRegistry: 同 id 重复注册会覆盖旧值且不改变顺序', () => {
  const registry = createRegistry([item('a', '旧')]);

  registry.register(item('a', '新'));

  assert.equal(registry.size, 1);
  assert.equal(registry.get('a').name, '新');
});

test('createRegistry: has / get 对未注册 id 的表现', () => {
  const registry = createRegistry();

  assert.equal(registry.has('missing'), false);
  assert.equal(registry.get('missing'), undefined);
});

test('createRegistry: require 命中时返回实现，未命中时抛出', () => {
  const registry = createRegistry([item('a')]);

  assert.equal(registry.require('a').id, 'a');
  assert.throws(() => registry.require('missing'), /未注册的实现: missing/);
});

test('createRegistry: unregister / clear 正确反映数量', () => {
  const registry = createRegistry([item('a'), item('b')]);

  assert.equal(registry.unregister('a'), true);
  assert.equal(registry.unregister('a'), false);
  assert.equal(registry.size, 1);

  registry.clear();
  assert.equal(registry.size, 0);
});

test('createRegistry: 空 id 会被拒绝', () => {
  const registry = createRegistry();

  assert.throws(() => registry.register({ id: '' }), TypeError);
});

test('createRegistry: list() 返回快照，不影响内部状态', () => {
  const registry = createRegistry([item('a')]);
  const snapshot = registry.list();

  snapshot.push(item('injected'));

  assert.equal(registry.size, 1);
  assert.equal(registry.has('injected'), false);
});
