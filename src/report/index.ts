/**
 * 报表纯数据层入口 (index.ts)
 * 无 Univer / DOM / UI 依赖，可由任意 Node.js 服务端或前端环境安全导入。
 */
export * from './types.js';
export * from './normalizeAxes.js';
export * from './calculateMetrics.js';
export * from './groupedProjector.js';
export * from './pivotProjector.js';
export * from './buildBiGrid.js';
export * from './bindings.js';
export * from './refresh.js';
export * from './validator.js';
export * from '../report-template/index.js';
