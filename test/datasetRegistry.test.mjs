import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDatasetRegistry,
  globalDatasetRegistry,
  registerDataset,
  registerDatasets,
  getRegisteredDataset,
  getRegisteredDatasets,
  unregisterDataset,
  clearRegisteredDatasets,
  resolveDatasetData,
  getCachedDatasetData,
  clearDatasetCache,
} from '../dist/esm/index.js';

const mockDs = (id, name = id, data = [{ val: 1 }]) => ({
  id,
  name,
  data,
  headers: { val: '数值' },
});

test('createDatasetRegistry: 独立实例支持 register/get/has/list/ids', () => {
  const registry = createDatasetRegistry([mockDs('ds1', '数据源1'), mockDs('ds2', '数据源2')]);

  assert.equal(registry.size, 2);
  assert.deepEqual(registry.ids(), ['ds1', 'ds2']);
  assert.equal(registry.has('ds1'), true);
  assert.equal(registry.has('ds99'), false);
  assert.equal(registry.get('ds1')?.name, '数据源1');
  assert.equal(registry.get('ds99'), undefined);
  assert.equal(registry.require('ds1').id, 'ds1');
  assert.throws(() => registry.require('ds99'), /未注册的数据源: ds99/);
});

test('createDatasetRegistry: 监听器订阅与取消订阅', () => {
  const registry = createDatasetRegistry();
  const events = [];

  const unsubscribe = registry.subscribe((event) => {
    if (!event) return;
    if (event.action === 'register') {
      if (event.dataset) {
        events.push({ action: 'register', id: event.dataset.id });
      } else if (event.datasets) {
        for (const ds of event.datasets) {
          events.push({ action: 'register', id: ds.id });
        }
      }
    } else if (event.action === 'unregister') {
      events.push({ action: 'unregister', id: event.dataset?.id });
    } else if (event.action === 'clear') {
      events.push({ action: 'clear', id: undefined });
    }
  });

  registry.register(mockDs('ds1', '源1'));
  registry.registerMany([mockDs('ds2', '源2'), mockDs('ds3', '源3')]);
  registry.unregister('ds1');
  registry.clear();

  unsubscribe();
  registry.register(mockDs('ds4', '源4')); // 取消订阅后不应触发

  assert.deepEqual(events, [
    { action: 'register', id: 'ds1' },
    { action: 'register', id: 'ds2' },
    { action: 'register', id: 'ds3' },
    { action: 'unregister', id: 'ds1' },
    { action: 'clear', id: undefined },
  ]);
});

test('globalDatasetRegistry & 快捷函数', () => {
  clearRegisteredDatasets();
  assert.equal(globalDatasetRegistry.size, 0);

  registerDataset(mockDs('global1', '全局源1'));
  registerDatasets([
    mockDs('global2', '全局源2'),
    mockDs('global3', '全局源3', [{ val: 100 }]),
  ]);

  assert.equal(globalDatasetRegistry.size, 3);
  assert.equal(getRegisteredDataset('global2')?.name, '全局源2');
  assert.equal(getRegisteredDatasets().length, 3);

  const removed = unregisterDataset('global1');
  assert.equal(removed, true);
  assert.equal(globalDatasetRegistry.size, 2);
  assert.equal(getRegisteredDataset('global1'), undefined);

  clearRegisteredDatasets();
  assert.equal(globalDatasetRegistry.size, 0);
  assert.deepEqual(getRegisteredDatasets(), []);
});

test('createDatasetRegistry: 校验空或非法 id 与非法 data', () => {
  const registry = createDatasetRegistry();
  assert.throws(() => registry.register({ id: '', name: 'test', data: [] }), /必须包含非空的 id/);
  assert.throws(() => registry.register({ id: '   ', name: 'test', data: [] }), /必须包含非空的 id/);
  assert.throws(() => registry.register({ id: 'valid', name: 'test' }), /data 必须为数组或获取数据的方法函数/);
});

test('createDatasetRegistry: 注册 async 函数数据源与 resolveData 异步解析', async () => {
  const registry = createDatasetRegistry();
  let fetchCount = 0;

  registry.register({
    id: 'async_sensor',
    name: '异步遥测流',
    data: async () => {
      fetchCount += 1;
      return [{ time: '2026-10-10', temp: 25.5 }];
    },
    headers: { temp: '温度' },
  });

  assert.equal(registry.isDataLoaded('async_sensor'), false);
  assert.equal(registry.getCachedData('async_sensor'), undefined);

  // 1. 首次解析：执行 loader 并存入缓存
  const result1 = await registry.resolveData('async_sensor');
  assert.equal(fetchCount, 1);
  assert.deepEqual(result1.data, [{ time: '2026-10-10', temp: 25.5 }]);
  assert.deepEqual(result1.headers, { temp: '温度' });
  assert.equal(registry.isDataLoaded('async_sensor'), true);

  // 2. 二次解析：命中缓存，fetchCount 不应增加
  const result2 = await registry.resolveData('async_sensor');
  assert.equal(fetchCount, 1);
  assert.deepEqual(result2.data, [{ time: '2026-10-10', temp: 25.5 }]);

  // 3. 强制刷新 (forceRefresh)：绕过缓存重新拉取
  const result3 = await registry.resolveData('async_sensor', { forceRefresh: true });
  assert.equal(fetchCount, 2);
  assert.deepEqual(result3.data, [{ time: '2026-10-10', temp: 25.5 }]);

  // 4. 清除缓存
  registry.clearCache('async_sensor');
  assert.equal(registry.isDataLoaded('async_sensor'), false);
});

test('createDatasetRegistry: 并发请求去重防重 (In-Flight Deduplication)', async () => {
  const registry = createDatasetRegistry();
  let networkCalls = 0;

  registry.register({
    id: 'dedup_ds',
    name: '并发防重测试源',
    data: async () => {
      networkCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return [{ id: 1, val: 999 }];
    },
  });

  // 同时发起 3 个并发请求
  const [res1, res2, res3] = await Promise.all([
    registry.resolveData('dedup_ds'),
    registry.resolveData('dedup_ds'),
    registry.resolveData('dedup_ds'),
  ]);

  // loader 仅执行了 1 次
  assert.equal(networkCalls, 1);
  assert.deepEqual(res1.data, [{ id: 1, val: 999 }]);
  assert.deepEqual(res2.data, [{ id: 1, val: 999 }]);
  assert.deepEqual(res3.data, [{ id: 1, val: 999 }]);
});

test('createDatasetRegistry: 兼容返回复合对象 { data, headers }', async () => {
  const registry = createDatasetRegistry();
  registry.register({
    id: 'composite_ds',
    name: '复合格式源',
    data: async () => ({
      data: [{ workshop: '车间A', count: 10 }],
      headers: { workshop: '生产车间', count: '产量' },
    }),
  });

  const res = await registry.resolveData('composite_ds');
  assert.deepEqual(res.data, [{ workshop: '车间A', count: 10 }]);
  assert.deepEqual(res.headers, { workshop: '生产车间', count: '产量' });
});

test('resolveDatasetData: 支持直接传入 Loader 函数作为数据源 (Direct Code Async Loader)', async () => {
  const directLoader = async () => [{ code: 'alpha', amount: 500 }];
  const res = await resolveDatasetData(directLoader, { headers: { code: '代号', amount: '金额' } });

  assert.deepEqual(res.data, [{ code: 'alpha', amount: 500 }]);
  assert.deepEqual(res.headers, { code: '代号', amount: '金额' });
});

test('createDatasetRegistry: 加载异常时抛出错误且清理 pending 状态可重新尝试', async () => {
  const registry = createDatasetRegistry();
  let failFirst = true;

  registry.register({
    id: 'retry_ds',
    name: '可重试源',
    data: async () => {
      if (failFirst) {
        failFirst = false;
        throw new Error('Network timeout');
      }
      return [{ success: true }];
    },
  });

  // 第一次请求失败
  await assert.rejects(
    async () => {
      await registry.resolveData('retry_ds');
    },
    /Network timeout/
  );

  // 第二次请求应能正常重新尝试并成功
  const res = await registry.resolveData('retry_ds');
  assert.deepEqual(res.data, [{ success: true }]);
});

