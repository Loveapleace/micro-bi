/** Deliberately framework-free: consumable by React 17 / TypeScript 4 platform hosts. */
export interface DatasetDescriptor {
  id: string;
  name: string;
  headers?: Record<string, string> | undefined;
}
export interface DatasetSnapshot {
  datasetId: string;
  records: Record<string, any>[];
  headers?: Record<string, string> | undefined;
  loading?: boolean | undefined;
  error?: string | undefined;
}
export interface ReportDefinition {
  kind: 'micro-bi-report';
  version: 1;
  renderer: 'table' | 'chart';
  datasetId: string;
  template?: any;
  chartConfig?: any;
}
export interface ReportFilter {
  id: string;
  field: string;
  operator: 'eq' | 'ne' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'empty' | 'notEmpty' | 'between';
  value?: string | number | undefined;
  upper?: string | number | undefined;
}
export interface ReportQuery {
  sortRules?: ReportSortRule[] | undefined;
  timeRange?: { field: string; from: string; to: string } | undefined;
  filters: ReportFilter[];
  match: 'and' | 'or';
  sort?: { field: string; order: 'asc' | 'desc' } | undefined;
  hiddenColumns: string[];
  page: number;
  pageSize: number;
  activeSheetId?: string | undefined;
}
export interface ReportSortMember {
  targetId: string;
  memberKey: string;
}
export interface ReportSortRule {
  targetId: string;
  order: 'asc' | 'desc';
  by: 'value' | 'metric';
  metricId?: string | undefined;
  slice?: ReportSortMember[] | undefined;
}
export interface DesignerOptions {
  definition?: ReportDefinition | undefined;
  renderer: 'table' | 'chart';
  datasets: DatasetDescriptor[];
  snapshot: DatasetSnapshot;
  onDatasetChange: (datasetId: string) => void;
  onRefresh?: (() => void) | undefined;
  variables?: VariableDefinition[] | undefined;
  variableValues?: Record<string, any> | undefined;
  onVariableReferencesChange?: ((ids: string[]) => void) | undefined;
}
export interface DetailReportOptions {
  datasetId: string;
  title: string;
  fields: { key: string; label?: string | undefined }[];
  timeField?: string | undefined;
}
export interface VariableDefinition {
  id: string;
  name: string;
  path?: string[] | undefined;
}
export interface ViewerOptions {
  definition: ReportDefinition;
  snapshot: DatasetSnapshot;
  query: ReportQuery;
  onQueryChange: (query: ReportQuery) => void;
  onRefresh?: (() => void) | undefined;
  variableValues?: Record<string, any> | undefined;
  showToolbar?: boolean | undefined;
}
export interface DesignerHandle {
  update: (options: DesignerOptions) => void;
  save: () => Promise<ReportDefinition>;
  unmount: () => void;
}
export interface ViewerHandle {
  update: (options: ViewerOptions) => void;
  unmount: () => void;
}
export function mountDesigner(element: HTMLElement, options: DesignerOptions): Promise<DesignerHandle>;
export function mountViewer(element: HTMLElement, options: ViewerOptions): Promise<ViewerHandle>;
export function createDetailReport(options: DetailReportOptions): Promise<ReportDefinition>;
