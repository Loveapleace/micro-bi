import type { AggregatedColumnConfig, ComputedColumnConfig, FieldDataType, TimeBucketConfig, TransformResult } from '../engine/types.js';

export type ChartType = 'bar' | 'line' | 'pie';
export type ChartMetric = (AggregatedColumnConfig | ComputedColumnConfig) & { axis?: 'left' | 'right' | undefined; unit?: string | undefined };
export interface ChartDimension { field: string; timeBucket?: Omit<TimeBucketConfig,'field'> | undefined }
export interface ChartFilter {
  id: string;
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'empty' | 'notEmpty';
  value?: string | number | boolean | null | undefined;
}
/** 模式一唯一源协议；不读取原表格DSL、ReportDocument或工作簿。 */
export interface ChartConfigV1 {
  kind: 'chart-config';
  version: 1;
  datasetId: string;
  chartType: ChartType;
  dimension: ChartDimension;
  seriesField?: string | undefined;
  metrics: ChartMetric[];
  fieldTypes?: Record<string,FieldDataType> | undefined;
  filters: ChartFilter[];
  sort: { field: 'dimension' | string; order: 'asc' | 'desc' };
  topN?: number | undefined;
  appearance: { legend: boolean; labels: boolean; stacked: boolean; smooth: boolean; palette: string[] };
}
export interface ChartIssue { path: string; message: string }
export interface CompiledChart {
  valid: boolean;
  issues: ChartIssue[];
  result: TransformResult;
  dimensionField: string;
  metricKeys: string[];
  inputRows: number;
  filteredRows: number;
}
export function chartMetricKey(metric: ChartMetric): string { return metric.type==='computed'?metric.name:metric.field; }
export function createChartConfig(datasetId: string): ChartConfigV1 {
  return {kind:'chart-config',version:1,datasetId,chartType:'bar',dimension:{field:''},metrics:[],filters:[],sort:{field:'dimension',order:'asc'},
    appearance:{legend:true,labels:false,stacked:false,smooth:false,palette:[]}};
}
