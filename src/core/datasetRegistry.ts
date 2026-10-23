import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import type { DataRecord, Identifiable } from '../types.js';
import type { HeaderMapping, DynamicTransformConfig } from '../engine/types.js';
import { createRegistry, type Registry } from './registry.js';

/**
 * 数据集加载器函数返回的数据记录集合或带表头映射的对象
 */
export type DatasetDataLoaderResult =
  | readonly DataRecord[]
  | {
      readonly data: readonly DataRecord[];
      readonly headers?: HeaderMapping | undefined;
    };

/**
 * 动态/异步获取数据集的方法签名 (支持 Promise 异步加载或同步动态运算)
 */
export type DatasetDataLoader = () => Promise<DatasetDataLoaderResult> | DatasetDataLoaderResult;

/**
 * 数据集底层数据载体：支持直接静态记录数组，或动态获取方法函数
 */
export type DatasetData = readonly DataRecord[] | DatasetDataLoader;

/**
 * 已注册的数据集契约定义 (RegisteredDataset)
 *
 * 规范化封装底层事实流水（支持静态记录或动态获取方法）、中英文字典映射、业务描述及推荐初始分析模板。
 * 支持通过代码层 register 机制统一注册，供配置面板与展示态自由选择切换。
 */
export interface RegisteredDataset extends Identifiable {
  /** 数据集唯一契约 ID（如 'industrial_lifecycle_orders'） */
  readonly id: string;
  /** 数据集可读名称（如 '智能制造工单生命周期流水'） */
  readonly name: string;
  /**
   * 底层原始事实数据记录集合：
   * 1. 静态数组：预先请求完成的 DataRecord[] 记录列表
   * 2. 动态获取方法：() => Promise<DataRecord[]> 或 () => Promise<{ data, headers }> 延迟按需拉取
   */
  readonly data: DatasetData;
  /** 表头字段中英文映射字典（可选，如 { output_qty: '交付总件数', workshop: '承制车间' }） */
  readonly headers?: HeaderMapping | undefined;
  /** 业务分类标签（可选，如 'MES工单', 'IoT设备'） */
  readonly tag?: string | undefined;
  /** 数据集业务描述或备注说明（可选，在配置面板展示） */
  readonly description?: string | undefined;
  /** 默认初始分析配置（可选，切换至该数据源时的推荐模板） */
  readonly defaultConfig?: DynamicTransformConfig | undefined;
  /**
   * 缓存策略：当 data 为获取方法时，是否在首次请求后自动缓存数据（默认 true）。
   * 设置为 false 时，每次切换或调用 resolve 时均重新发起请求。
   */
  readonly cache?: boolean | undefined;
}

/** 注册表变更事件类型 */
export interface DatasetRegistryEvent {
  readonly action: 'register' | 'unregister' | 'clear';
  readonly dataset?: RegisteredDataset | undefined;
  readonly datasets?: readonly RegisteredDataset[] | undefined;
}

/** 注册表变更监听器 */
export type DatasetRegistryListener = (event?: DatasetRegistryEvent) => void;

/**
 * 具备订阅发布通知、异步数据解析与请求去重缓存能力的数据集注册中心 (DatasetRegistry)
 */
export class DatasetRegistry {
  private readonly baseRegistry: Registry<RegisteredDataset>;
  private readonly listeners = new Set<DatasetRegistryListener>();
  private readonly dataCache = new Map<string, { data: readonly DataRecord[]; headers?: HeaderMapping | undefined }>();
  private readonly pendingLoads = new Map<string, Promise<{ data: readonly DataRecord[]; headers?: HeaderMapping | undefined }>>();
  private readonly loadTokens = new Map<string, object>();
  private revision = 0;
  private snapshot: readonly RegisteredDataset[] = Object.freeze([]);

  constructor(initial: readonly RegisteredDataset[] = []) {
    this.baseRegistry = createRegistry<RegisteredDataset>();
    if (initial.length > 0) {
      this.registerMany(initial);
    } else {
      this.updateSnapshot();
    }
  }

  private updateSnapshot(): void {
    this.revision += 1;
    this.snapshot = Object.freeze(this.baseRegistry.list());
  }

  /**
   * 获取当前数据集注册表的只读不可变快照 (并发一致性保障，无变更时引用恒定)
   */
  public getSnapshot = (): readonly RegisteredDataset[] => {
    return this.snapshot;
  };

  /**
   * 获取当前注册表的版本号修订计数值
   */
  public getRevision = (): number => {
    return this.revision;
  };

  /**
   * 注册单个数据集，若同 ID 已存在则覆盖。返回自身以便链式调用。
   */
  public register(dataset: RegisteredDataset): this {
    this.validateDataset(dataset);
    this.baseRegistry.register(dataset);
    this.invalidateLoad(dataset.id);
    if (Array.isArray(dataset.data)) {
      this.dataCache.set(dataset.id, { data: dataset.data, headers: dataset.headers });
    } else {
      this.dataCache.delete(dataset.id);
    }
    this.updateSnapshot();
    this.notify({ action: 'register', dataset });
    return this;
  }

  /**
   * 批量注册数据集。
   */
  public registerMany(datasets: readonly RegisteredDataset[]): this {
    for (const dataset of datasets) this.validateDataset(dataset);
    for (const ds of datasets) {
      this.baseRegistry.register(ds);
      this.invalidateLoad(ds.id);
      if (Array.isArray(ds.data)) {
        this.dataCache.set(ds.id, { data: ds.data, headers: ds.headers });
      } else {
        this.dataCache.delete(ds.id);
      }
    }
    this.updateSnapshot();
    this.notify({ action: 'register', datasets });
    return this;
  }

  /**
   * 按 ID 注销指定数据集。
   */
  public unregister(id: string): boolean {
    const existing = this.baseRegistry.get(id);
    const success = this.baseRegistry.unregister(id);
    this.invalidateLoad(id);
    if (success) {
      this.updateSnapshot();
      this.notify({ action: 'unregister', dataset: existing });
    }
    return success;
  }

  /**
   * 按 ID 获取数据集，不存在时返回 undefined。
   */
  public get(id: string): RegisteredDataset | undefined {
    return this.baseRegistry.get(id);
  }

  /**
   * 按 ID 必选获取数据集，不存在时抛出异常。
   */
  public require(id: string): RegisteredDataset {
    try {
      return this.baseRegistry.require(id);
    } catch {
      throw new Error(`[DatasetRegistry] 未注册的数据源: ${id}`);
    }
  }

  /**
   * 判断某个数据集 ID 是否已注册。
   */
  public has(id: string): boolean {
    return this.baseRegistry.has(id);
  }

  /**
   * 获取所有已注册数据集列表（按注册顺序，返回副本以兼容外部数组修改）。
   */
  public list(): RegisteredDataset[] {
    return [...this.snapshot];
  }

  /**
   * 获取所有已注册数据集的 ID 列表。
   */
  public ids(): string[] {
    return this.baseRegistry.ids();
  }

  /**
   * 获取已注册数据集总数。
   */
  public get size(): number {
    return this.baseRegistry.size;
  }

  /**
   * 清空所有注册项。
   */
  public clear(): void {
    this.baseRegistry.clear();
    this.dataCache.clear();
    this.pendingLoads.clear();
    this.loadTokens.clear();
    this.updateSnapshot();
    this.notify({ action: 'clear' });
  }

  /**
   * 订阅注册表变更（当有数据集被注册、批量注册、注销或清空时触发通知）。
   */
  public subscribe(listener: DatasetRegistryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 异步解析并获取指定数据集的事实记录与表头字典。
   * - 若 `data` 为静态数组，直接返回。
   * - 若 `data` 为方法函数，自动调用并缓存结果（除非 forceRefresh: true 或 cache: false）。
   * - 普通并发读取共享同一个 Promise；forceRefresh 启动新请求，旧响应不会覆盖当前缓存。
   */
  public async resolveData(
    id: string,
    options?: { forceRefresh?: boolean }
  ): Promise<{ data: readonly DataRecord[]; headers?: HeaderMapping | undefined }> {
    const dataset = this.require(id);
    if (Array.isArray(dataset.data)) {
      const resolved = { data: dataset.data, headers: dataset.headers };
      this.dataCache.set(id, resolved);
      return resolved;
    }

    if (!options?.forceRefresh && dataset.cache !== false && this.dataCache.has(id)) {
      return this.dataCache.get(id)!;
    }

    if (!options?.forceRefresh && this.pendingLoads.has(id)) {
      return this.pendingLoads.get(id)!;
    }

    if (options?.forceRefresh) this.dataCache.delete(id);
    const token = {};
    this.loadTokens.set(id, token);

    const loader = dataset.data as DatasetDataLoader;
    const promise = (async () => {
      try {
        // Defer synchronous loaders as well, so pending state exists before failure cleanup.
        const result = await Promise.resolve().then(loader);
        let resolved: { data: readonly DataRecord[]; headers?: HeaderMapping | undefined };
        if (Array.isArray(result)) {
          resolved = { data: result, headers: dataset.headers };
        } else if (result && typeof result === 'object' && Array.isArray((result as any).data)) {
          resolved = {
            data: (result as any).data,
            headers: (result as any).headers || dataset.headers,
          };
        } else {
          throw new Error(`[DatasetRegistry] 数据集 "${id}" 的获取方法必须返回数据记录数组`);
        }
        if (dataset.cache !== false && this.loadTokens.get(id) === token && this.get(id) === dataset) {
          this.dataCache.set(id, resolved);
        }
        return resolved;
      } finally {
        if (this.loadTokens.get(id) === token) {
          this.pendingLoads.delete(id);
          this.loadTokens.delete(id);
        }
      }
    })();

    this.pendingLoads.set(id, promise);
    return promise;
  }

  /**
   * 获取已缓存的数据集解析结果，若未解析或未缓存返回 undefined。
   */
  public getCachedData(id: string): { data: readonly DataRecord[]; headers?: HeaderMapping | undefined } | undefined {
    if (this.dataCache.has(id)) {
      return this.dataCache.get(id);
    }
    const ds = this.get(id);
    if (ds && Array.isArray(ds.data)) {
      return { data: ds.data, headers: ds.headers };
    }
    return undefined;
  }

  /**
   * 判断某数据集数据是否已就绪（静态数组或已完成异步加载）。
   */
  public isDataLoaded(id: string): boolean {
    return this.getCachedData(id) !== undefined;
  }

  /**
   * 清除指定或全部数据集的缓存。
   */
  public clearCache(id?: string): void {
    if (id) {
      this.invalidateLoad(id);
    } else {
      this.dataCache.clear();
      this.pendingLoads.clear();
      this.loadTokens.clear();
    }
  }

  private validateDataset(dataset: RegisteredDataset): void {
    if (!dataset.id || !dataset.id.trim()) throw new TypeError('注册项必须包含非空的 id');
    if (!Array.isArray(dataset.data) && typeof dataset.data !== 'function') {
      throw new TypeError(`[DatasetRegistry] 数据集 "${dataset.id}" 的 data 必须为数组或获取数据的方法函数`);
    }
  }

  private invalidateLoad(id: string): void {
    this.dataCache.delete(id);
    this.pendingLoads.delete(id);
    this.loadTokens.delete(id);
  }

  private notify(event?: DatasetRegistryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[DatasetRegistry] Error in listener callback:', err);
      }
    }
  }
}

/**
 * 创建独立的数据集注册中心实例。
 */
export function createDatasetRegistry(initial?: readonly RegisteredDataset[]): DatasetRegistry {
  return new DatasetRegistry(initial);
}

/** 全局单例数据集注册中心 */
export const globalDatasetRegistry = new DatasetRegistry();

/**
 * 注册单个数据集到全局注册中心。
 *
 * @example
 * ```ts
 * // 1. 注册静态数据
 * registerDataset({
 *   id: 'device_inventory',
 *   name: '设备台账',
 *   data: staticList,
 * });
 *
 * // 2. 注册异步数据获取方法
 * registerDataset({
 *   id: 'async_telemetry',
 *   name: '实时遥测流',
 *   data: async () => {
 *     const res = await fetch('/api/telemetry');
 *     return res.json();
 *   },
 * });
 * ```
 */
export function registerDataset(dataset: RegisteredDataset): void {
  globalDatasetRegistry.register(dataset);
}

/**
 * 批量注册数据集到全局注册中心。
 */
export function registerDatasets(datasets: readonly RegisteredDataset[]): void {
  globalDatasetRegistry.registerMany(datasets);
}

/**
 * 按 ID 获取全局注册的数据集。
 */
export function getRegisteredDataset(id: string): RegisteredDataset | undefined {
  return globalDatasetRegistry.get(id);
}

/**
 * 获取全局注册的所有数据集列表。
 */
export function getRegisteredDatasets(): RegisteredDataset[] {
  return globalDatasetRegistry.list();
}

/**
 * 注销全局注册的数据集。
 */
export function unregisterDataset(id: string): boolean {
  return globalDatasetRegistry.unregister(id);
}

/**
 * 清空全局注册的数据集。
 */
export function clearRegisteredDatasets(): void {
  globalDatasetRegistry.clear();
}

/**
 * 异步解析并获取数据集的数据记录与表头字典（支持 ID、已注册对象或直接传入的 Loader 函数）。
 */
export async function resolveDatasetData(
  datasetOrIdOrLoader: string | RegisteredDataset | DatasetDataLoader,
  options?: { forceRefresh?: boolean; registry?: DatasetRegistry; headers?: HeaderMapping }
): Promise<{ data: readonly DataRecord[]; headers?: HeaderMapping | undefined }> {
  const registry = options?.registry || globalDatasetRegistry;
  if (typeof datasetOrIdOrLoader === 'function') {
    const res = await datasetOrIdOrLoader();
    if (Array.isArray(res)) {
      return { data: res, headers: options?.headers };
    } else if (res && typeof res === 'object' && Array.isArray((res as any).data)) {
      return {
        data: (res as any).data,
        headers: (res as any).headers || options?.headers,
      };
    } else {
      throw new Error(`[DatasetRegistry] 数据获取方法必须返回数据记录数组`);
    }
  }
  if (typeof datasetOrIdOrLoader === 'string') {
    return registry.resolveData(datasetOrIdOrLoader, options);
  }
  if (Array.isArray(datasetOrIdOrLoader.data)) {
    return { data: datasetOrIdOrLoader.data, headers: datasetOrIdOrLoader.headers };
  }
  if (typeof datasetOrIdOrLoader.data === 'function') {
    if (registry.get(datasetOrIdOrLoader.id) === datasetOrIdOrLoader) {
      return registry.resolveData(datasetOrIdOrLoader.id, options);
    }
    const res = await datasetOrIdOrLoader.data();
    if (Array.isArray(res)) {
      return { data: res, headers: datasetOrIdOrLoader.headers };
    } else if (res && typeof res === 'object' && Array.isArray((res as any).data)) {
      return {
        data: (res as any).data,
        headers: (res as any).headers || datasetOrIdOrLoader.headers,
      };
    } else {
      throw new Error(`[DatasetRegistry] 数据集 "${datasetOrIdOrLoader.id}" 的获取方法必须返回数据记录数组`);
    }
  }
  return { data: [], headers: datasetOrIdOrLoader.headers };
}

/**
 * 获取已缓存的数据集解析数据。
 */
export function getCachedDatasetData(
  id: string,
  registry: DatasetRegistry = globalDatasetRegistry
): { data: readonly DataRecord[]; headers?: HeaderMapping | undefined } | undefined {
  return registry.getCachedData(id);
}

/**
 * 清除数据集解析缓存。
 */
export function clearDatasetCache(
  id?: string,
  registry: DatasetRegistry = globalDatasetRegistry
): void {
  registry.clearCache(id);
}

/**
 * React Hook：响应式获取当前注册的数据集列表。
 * 基于 React 18 useSyncExternalStore 确保并发一致性与稳定快照。
 * 当代码在运行时动态注册或更新数据集时，组件将自动重渲染。
 */
const EMPTY_DATASET_SNAPSHOT: readonly RegisteredDataset[] = Object.freeze([]);

export function useRegisteredDatasets(registry: DatasetRegistry = globalDatasetRegistry): RegisteredDataset[] {
  const subscribe = useCallback(
    (onStoreChange: () => void) => registry.subscribe(onStoreChange),
    [registry]
  );
  const getSnapshot = useCallback(
    () => registry.getSnapshot(),
    [registry]
  );
  // 服务端/初次渲染无数据集，提供稳定空快照，避免复用 getSnapshot 造成 hydration 不一致
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_DATASET_SNAPSHOT) as RegisteredDataset[];
}

/**
 * React Hook：按需加载并响应式获取数据集数据（无论是静态数组还是异步获取方法）。
 */
export interface UseDatasetDataOptions {
  readonly forceRefresh?: boolean | undefined;
  readonly registry?: DatasetRegistry | undefined;
  readonly enabled?: boolean | undefined;
}

export interface UseDatasetDataResult {
  readonly data: readonly DataRecord[];
  readonly headers: HeaderMapping | undefined;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly isAsync: boolean;
  readonly refresh: () => Promise<void>;
}

export function useDatasetData(
  datasetOrId: string | RegisteredDataset | undefined,
  options?: UseDatasetDataOptions
): UseDatasetDataResult {
  const registry = options?.registry || globalDatasetRegistry;
  const registeredDatasets = useRegisteredDatasets(registry);
  const target = typeof datasetOrId === 'string'
    ? registeredDatasets.find((dataset) => dataset.id === datasetOrId)
    : datasetOrId;
  const isAsync = typeof target?.data === 'function';

  const cached = target
    ? Array.isArray(target.data)
      ? { data: target.data, headers: target.headers }
      : registry.getCachedData(target.id)
    : undefined;

  const [data, setData] = useState<readonly DataRecord[]>(() => cached?.data || []);
  const [headers, setHeaders] = useState<HeaderMapping | undefined>(() => cached?.headers || target?.headers);
  const [loading, setLoading] = useState<boolean>(() => Boolean(isAsync && !cached && options?.enabled !== false));
  const [error, setError] = useState<Error | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(
    async (forceRefresh = false) => {
      const request = ++requestRef.current;
      if (!target || options?.enabled === false) {
        setData([]);
        setHeaders(undefined);
        setError(null);
        setLoading(false);
        return;
      }
      if (Array.isArray(target.data)) {
        setData(target.data);
        setHeaders(target.headers);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      // 刷新期间保留已展示数据，避免闪空：有缓存则继续展示缓存内容；
      // 仅在目标切换且无缓存时才重置，防止不同数据集间数据串显。
      const cachedNow = registry.getCachedData(target.id);
      if (cachedNow) {
        setData(cachedNow.data);
        setHeaders(cachedNow.headers);
      } else {
        setData([]);
        setHeaders(target.headers);
      }
      try {
        const res = await resolveDatasetData(target, { forceRefresh, registry });
        if (request !== requestRef.current) return;
        setData(res.data);
        setHeaders(res.headers);
      } catch (err) {
        if (request !== requestRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    },
    [target, registry, options?.enabled]
  );

  useEffect(() => {
    void load(options?.forceRefresh ?? false);
    return () => { requestRef.current += 1; };
  }, [load, options?.forceRefresh]);

  const refresh = useCallback(async () => {
    await load(true);
  }, [load]);

  return {
    data,
    headers,
    loading,
    error,
    isAsync,
    refresh,
  };
}
