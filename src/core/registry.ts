import type { Identifiable } from '../types.js';

/**
 * 通用注册表：按 `id` 管理一组实现。
 *
 * 数据源、适配器、转换器等可扩展模块都可以复用它，
 * 从而把"有哪些实现"与"如何使用实现"解耦。
 *
 * @typeParam T 被管理的实现类型，必须带有 `id` 字段
 */
export interface Registry<T extends Identifiable> {
  /** 注册单个实现；同 id 重复注册会覆盖旧值。返回自身以便链式调用。 */
  register(item: T): this;
  /** 批量注册。返回自身以便链式调用。 */
  registerMany(items: readonly T[]): this;
  /** 按 id 注销，返回该 id 此前是否存在。 */
  unregister(id: string): boolean;
  /** 按 id 查询，未注册时返回 `undefined`。 */
  get(id: string): T | undefined;
  /** 按 id 查询，未注册时抛出错误。 */
  require(id: string): T;
  /** 判断某个 id 是否已注册。 */
  has(id: string): boolean;
  /** 已注册实现列表（按注册顺序）。 */
  list(): T[];
  /** 已注册 id 列表（按注册顺序）。 */
  ids(): string[];
  /** 已注册数量。 */
  readonly size: number;
  /** 清空注册表。 */
  clear(): void;
}

/**
 * 创建一个注册表，可选传入初始实现集合。
 *
 * @example
 * ```ts
 * const sources = createRegistry<DataSourceAdapter>([
 *   { id: 'rest', name: 'REST', fetch: async () => [], normalize: (r) => r as DataRecord },
 * ]);
 * sources.ids(); // ['rest']
 * ```
 */
export function createRegistry<T extends Identifiable>(initial: readonly T[] = []): Registry<T> {
  const items = new Map<string, T>();

  const registry: Registry<T> = {
    register(item: T): Registry<T> {
      if (!item.id) {
        throw new TypeError('注册项必须包含非空的 id');
      }
      items.set(item.id, item);
      return registry;
    },
    registerMany(list: readonly T[]): Registry<T> {
      for (const item of list) {
        registry.register(item);
      }
      return registry;
    },
    unregister(id: string): boolean {
      return items.delete(id);
    },
    get(id: string): T | undefined {
      return items.get(id);
    },
    require(id: string): T {
      const found = items.get(id);
      if (found === undefined) {
        throw new Error(`未注册的实现: ${id}`);
      }
      return found;
    },
    has(id: string): boolean {
      return items.has(id);
    },
    list(): T[] {
      return [...items.values()];
    },
    ids(): string[] {
      return [...items.keys()];
    },
    get size(): number {
      return items.size;
    },
    clear(): void {
      items.clear();
    },
  };

  registry.registerMany(initial);
  return registry;
}
