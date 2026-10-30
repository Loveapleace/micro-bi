import type { DataRecord, HeaderMapping } from '../engine/types.js';
import type { CellTimeBucketConfig, RegionFilter } from '../report-template/types.js';
import type { PublishedSheet, ReportCellMerge } from './types.js';

export interface DrillRule {
  cellId: string;
  sheetId: string;
  field?: string | undefined;
  semanticKey?: string | undefined;
  datasetId?: string | undefined;
  enabled: boolean;
  columns: string[];
  pageSize: number;
}
export interface DrillMember {
  field: string;
  memberKey: string;
  bucket?: CellTimeBucketConfig | undefined;
  recordKey?: string | undefined;
}
export interface DrillScope {
  datasetId: string;
  regionId: string;
  filters: RegionFilter[];
  members: DrillMember[];
}
export interface DrillCellContext {
  scope: DrillScope;
  sourceCellId: string;
  baseValue: unknown;
  reason?: string | undefined;
}
export interface DrillTarget {
  id: string;
  sheetId: string;
  row: number;
  column: number;
  sourceCellId: string;
  scopeId: string;
  value: unknown;
  baseValue: unknown;
  label: string;
  publicationRevision: string;
  rule: DrillRule;
  reason?: string | undefined;
}
export interface PublishedDrillIndex {
  revision: string;
  dataRevision: string | number;
  fingerprint: string;
  scopes: Record<string, DrillScope>;
  cells: Record<string, DrillTarget>;
  merges: (ReportCellMerge & { sheetId: string; target: DrillTarget })[];
}
export interface DrillRequest {
  target: DrillTarget;
  scope: DrillScope;
  dataRevision: string | number;
  fingerprint: string;
  page: number;
  pageSize: number;
}
export interface DrillPage {
  records: readonly DataRecord[];
  total: number;
  headers?: HeaderMapping | undefined;
  fingerprint: string;
}
export type DrillQuery = (request: DrillRequest, signal: AbortSignal) => Promise<DrillPage>;
export interface DrillTab {
  id: string;
  key: string;
  origin: { sheetId: string; row: number; column: number };
  request: DrillRequest;
  status: 'loading' | 'ready' | 'error';
  sheet: PublishedSheet;
  total: number;
  error?: string | undefined;
}
