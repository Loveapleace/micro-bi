/**
 * 报表模型与契约定义 (types.ts)
 * 纯数据层，无 Univer / DOM / UI 依赖。
 */
import type { DynamicTransformConfig } from '../engine/types.js';

export type SheetId = string;
export type AnalysisId = string;
export type BindingId = string;
export type ReportId = string;

export interface ReportRange {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  sheetId?: SheetId | undefined;
}

export interface AxisMemberRef {
  axisId: string;
  field: string;
  memberKey: string;
  label?: string | undefined;
}

export type BindingRole =
  | 'dimension-header'
  | 'dimension-member'
  | 'metric-header'
  | 'metric-value'
  | 'subtotal'
  | 'grand-total'
  | 'custom';

export interface ReportBinding {
  id: BindingId;
  analysisId: AnalysisId;
  datasetId?: string | undefined;
  target: {
    sheetId: SheetId;
    row: number;
    column: number;
  };
  semantic: {
    role: BindingRole;
    rowPath: readonly AxisMemberRef[];
    columnPath: readonly AxisMemberRef[];
    metricId?: string | undefined;
    field?: string | undefined;
    agg?: string | undefined;
  };
  state: 'bound' | 'manual-override';
}

export interface ReportCellMerge {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

export interface BorderStyle {
  style?: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double' | 'none' | undefined;
  color?: string | undefined;
}

export interface CellBorderConfig {
  top?: BorderStyle | undefined;
  bottom?: BorderStyle | undefined;
  left?: BorderStyle | undefined;
  right?: BorderStyle | undefined;
}

export interface PublishedCellStyle {
  fontFamily?: string | undefined;
  fontSize?: number | undefined;
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  underline?: boolean | undefined;
  strikethrough?: boolean | undefined;
  color?: string | undefined;
  bgColor?: string | undefined;
  align?: 'left' | 'center' | 'right' | undefined;
  verticalAlign?: 'top' | 'middle' | 'bottom' | undefined;
  wrapText?: boolean | undefined;
  border?: CellBorderConfig | undefined;
  format?: string | undefined;
}

export interface PublishedCell {
  r: number;
  c: number;
  v: string | number | boolean | null;
  displayText?: string | undefined;
  formula?: string | undefined;
  styleId?: string | undefined;
  bindingId?: BindingId | undefined;
  role?: BindingRole | undefined;
  tooltip?: string | undefined;
}

export interface PublishedSheet {
  id: SheetId;
  name: string;
  hidden?: boolean | undefined;
  rowCount: number;
  colCount: number;
  cells: PublishedCell[];
  merges: ReportCellMerge[];
  rowHeights?: Record<number, number> | undefined;
  colWidths?: Record<number, number> | undefined;
  defaultRowHeight?: number | undefined;
  defaultColWidth?: number | undefined;
  hiddenRows?: number[] | undefined;
  hiddenCols?: number[] | undefined;
  frozenRowCount?: number | undefined;
  frozenColCount?: number | undefined;
}

export interface ReportDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  analysisId?: AnalysisId | undefined;
  sheetId?: SheetId | undefined;
  range?: ReportRange | undefined;
}

export interface PublishedReport {
  version: '1.0';
  id: ReportId;
  title?: string | undefined;
  createdAt: string;
  datasetVersion?: string | undefined;
  sheets: PublishedSheet[];
  styles: Record<string, PublishedCellStyle>;
  diagnostics?: ReportDiagnostic[] | undefined;
}

export interface ReportAnalysisRegion {
  id: AnalysisId;
  datasetId?: string | undefined;
  sheetId: SheetId;
  anchor: { row: number; column: number };
  config: DynamicTransformConfig;
  range?: ReportRange | undefined;
  bindings?: ReportBinding[] | undefined;
  manualOverrides?: Record<BindingId, { v?: unknown; f?: string; displayText?: string; baseValue?: unknown }> | undefined;
  archivedOverrides?: Record<BindingId, { v?: unknown; f?: string; displayText?: string; baseValue?: unknown }> | undefined;
  baseValues?: Record<BindingId, unknown> | undefined;
}

export interface ReportDocument {
  version: '1.0';
  id: ReportId;
  revision: number;
  title?: string | undefined;
  activeSheetId?: SheetId | undefined;
  workbookSnapshot?: unknown | undefined;
  analyses: ReportAnalysisRegion[];
  published?: PublishedReport | undefined;
}

export type ReportSaveResult =
  | {
      valid: true;
      issues: readonly ReportDiagnostic[];
      document: ReportDocument;
      publication: PublishedReport;
    }
  | {
      valid: false;
      issues: readonly ReportDiagnostic[];
    };

export interface BiGridCell {
  row: number;
  col: number;
  value: string | number | boolean | null;
  displayText?: string | undefined;
  role: BindingRole;
  rowPath?: readonly AxisMemberRef[] | undefined;
  colPath?: readonly AxisMemberRef[] | undefined;
  columnPath?: readonly AxisMemberRef[] | undefined;
  metricId?: string | undefined;
  agg?: string | undefined;
  field?: string | undefined;
  style?: PublishedCellStyle | undefined;
  tooltip?: string | undefined;
}

export interface BiGridModel {
  type: 'grouped' | 'pivot' | 'detail';
  rowCount: number;
  colCount: number;
  cells: BiGridCell[];
  merges: ReportCellMerge[];
  bindings: ReportBinding[];
  colWidths?: Record<number, number> | undefined;
  rowHeights?: Record<number, number> | undefined;
  mergeOrigins?: {
    ruleId: string;
    origin: 'static-layout' | 'manual-instance' | 'group-span' | 'adjacent-equal';
    targetCellId?: string | undefined;
    groupContextKey?: string | undefined;
    range: ReportCellMerge;
  }[] | undefined;
}
