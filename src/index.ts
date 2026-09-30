/**
 * `@hw/dynamic-data` 公共入口。
 *
 * 运行时导出与类型导出统一从这里暴露，子路径 `@hw/dynamic-data/core`
 * 提供核心原语的独立入口。
 */

export { VERSION } from './version.js';

export type {
  DataRecord,
  DataSourceAdapter,
  DataSourceId,
  Identifiable,
  Maybe,
  ValidationIssue,
  ValidationResult,
} from './types.js';

export { createRegistry } from './core/index.js';
export type { Registry } from './core/index.js';

export * from './engine/index.js';
export * from './locale/index.js';
