/** Framework-free semantic sorting contract. Coordinates and captions are never persisted as identities. */
export type ReportSortAxis = 'record' | 'row' | 'column';
export interface ReportSortMember {
  targetId: string;
  memberKey: string;
}
export interface ReportSortRule {
  targetId: string;
  order: 'asc' | 'desc';
  by: 'value' | 'metric';
  metricId?: string | undefined;
  /** Complete prefix on the opposite axis. Omitted/empty means aggregate across that axis. */
  slice?: ReportSortMember[] | undefined;
}
export interface ReportSortTarget {
  id: string;
  sourceCellId: string;
  sheetId: string;
  regionId?: string | undefined;
  axis: ReportSortAxis;
  field: string;
  label: string;
  valueType: 'text' | 'number' | 'date' | 'boolean' | 'unknown';
  parentId?: string | undefined;
  level: number;
}
export interface ReportSortMetric {
  id: string;
  sourceCellId: string;
  sheetId: string;
  regionId?: string | undefined;
  label: string;
  operation: string;
}
export interface ReportSortSlice {
  id: string;
  axis: 'row' | 'column';
  sheetId: string;
  regionId?: string | undefined;
  label: string;
  members: ReportSortMember[];
}
export interface ReportSortCatalog {
  targets: ReportSortTarget[];
  metrics: ReportSortMetric[];
  slices: ReportSortSlice[];
}
export interface ReportSortHeader {
  activeOrder?: 'asc' | 'desc' | undefined;
  priority?: number | undefined;
  row: number;
  column: number;
  preset: ReportSortRule;
  /** A column member can also sort rows using the values in that column (and vice versa). */
  related?: ReportSortRule | undefined;
}
export interface ReportSortIssue {
  rule: ReportSortRule;
  code: 'WARN_SORT_TARGET' | 'WARN_SORT_METRIC' | 'WARN_SORT_SLICE' | 'WARN_SORT_SLICE_MISSING' | 'WARN_SORT_DUPLICATE';
  message: string;
}
