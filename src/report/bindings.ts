/**
 * 业务身份与语义绑定管理 (bindings.ts)
 * 纯数据层，负责构建与检索 ReportBinding。
 * 绑定用于数据刷新、分析区域定位和样式目标识别。它与工作表坐标分开维护。
 * 聚合单元格身份规则：analysisId + 完整行路径 + 完整列路径 + metricId + role
 */
import type {
  ReportBinding,
  AxisMemberRef,
  BindingRole,
  SheetId,
  AnalysisId,
} from './types.js';

export function serializeAxisPath(path: readonly AxisMemberRef[]): string {
  if (!path || path.length === 0) return 'ROOT';
  return JSON.stringify(path.map((m) => [m.axisId || m.field, m.field, m.memberKey]));
}

export function createSemanticKey(
  analysisId: AnalysisId,
  rowPath: readonly AxisMemberRef[],
  colPath: readonly AxisMemberRef[],
  metricId: string | undefined,
  role: BindingRole,
  field?: string | undefined
): string {
  const r = serializeAxisPath(rowPath);
  const c = serializeAxisPath(colPath);
  const m = metricId || 'NONE';
  const f = field && role === 'dimension-header' ? `::F[${field}]` : '';
  return `${analysisId}::R[${r}]::C[${c}]::M[${m}]${f}::ROLE[${role}]`;
}

export function createReportBinding(params: {
  analysisId: AnalysisId;
  datasetId?: string | undefined;
  sheetId: SheetId;
  row: number;
  column: number;
  role: BindingRole;
  rowPath?: readonly AxisMemberRef[] | undefined;
  columnPath?: readonly AxisMemberRef[] | undefined;
  metricId?: string | undefined;
  field?: string | undefined;
  agg?: string | undefined;
  state?: 'bound' | 'manual-override' | undefined;
}): ReportBinding {
  const rowPath = params.rowPath || [];
  const colPath = params.columnPath || [];
  const id = createSemanticKey(
    params.analysisId,
    rowPath,
    colPath,
    params.metricId,
    params.role,
    params.field
  );

  return {
    id,
    analysisId: params.analysisId,
    datasetId: params.datasetId,
    target: {
      sheetId: params.sheetId,
      row: params.row,
      column: params.column,
    },
    semantic: {
      role: params.role,
      rowPath,
      columnPath: colPath,
      metricId: params.metricId,
      field: params.field,
      agg: params.agg,
    },
    state: params.state || 'bound',
  };
}

export function buildBindingIndex(
  bindings: readonly ReportBinding[]
): {
  bySemantic: Map<string, ReportBinding>;
  byCoordinate: Map<string, ReportBinding>;
} {
  const bySemantic = new Map<string, ReportBinding>();
  const byCoordinate = new Map<string, ReportBinding>();

  for (const b of bindings) {
    bySemantic.set(b.id, b);
    const coordKey = `${b.target.sheetId}:${b.target.row},${b.target.column}`;
    byCoordinate.set(coordKey, b);
  }

  return { bySemantic, byCoordinate };
}
