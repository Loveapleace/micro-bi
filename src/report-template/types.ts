import type { DataRecord } from '../types.js';
import type { PublishedReport } from '../report/types.js';

export type CellDocumentType = 'cell-template';
export type CellSchemaVersion = '1.0' | '1.1' | '2.0';
export type AuthoringMode = 'panel' | 'cell' | 'hybrid';

export type RegionLayoutKind = 'detail' | 'grouped' | 'pivot';
export type MetricDirection = 'columns' | 'rows';

export interface CellPosition {
  row: number;
  column: number;
}

export interface RegionFilter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin';
  value: any;
}

export interface RegionTotalsConfig {
  showGrandTotals?: boolean | undefined;
  showSubTotals?: boolean | undefined;
  label?: string | undefined;
}

export interface CellRegionConfig {
  id: string;
  datasetId: string;
  layoutKind?: RegionLayoutKind | undefined;
  sheetId: string;
  anchor: CellPosition;
  metricDirection?: MetricDirection | undefined;
  filters: RegionFilter[];
  rowTotals?: RegionTotalsConfig | undefined;
  columnTotals?: RegionTotalsConfig | undefined;
}

export type CellContentKind = 'literal' | 'field' | 'business-formula' | 'sheet-formula';
export type CellBusinessRole = 'detail-column' | 'row-dimension' | 'column-dimension' | 'measure' | 'total';
export type CellDataOperation = 'list' | 'group' | 'sum' | 'avg' | 'count' | 'min' | 'max';
export type CellExpandDirection = 'down' | 'right' | 'none' | 'inherit';
export type CellTimeGranularity = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

export type CellCapabilitiesVersion = 'cell-v1' | 'cell-v2' | 'cell-expansion-v2';

export interface CellTimeBucketConfig {
  granularity: CellTimeGranularity;
  customIntervalDays?: number | undefined;
  timezone?: string | undefined;
  weekStartsOn?: 0 | 1 | undefined;
  format?: string | undefined;
}

export type CellMergePolicyKind = 'default' | 'none' | 'group-span' | 'adjacent-equal';

export interface CellFormatOptions {
  format?: string | undefined;
  precision?: number | undefined;
  useGrouping?: boolean | undefined;
  scale?: number | undefined;
  prefix?: string | undefined;
  suffix?: string | undefined;
  negativeFormat?: 'minus' | 'bracket' | 'red_minus' | 'red_bracket' | undefined;
  emptyDisplay?: string | undefined;
  zeroDisplay?: 'zero' | 'blank' | 'dash' | undefined;
  dateFormat?: string | undefined;
  tooltip?: string | undefined;
  mergePolicy?: CellMergePolicyKind | undefined;
}

export interface LiteralCellContent {
  kind: 'literal';
  value: any;
  format?: string | undefined;
  formatOptions?: CellFormatOptions | undefined;
  tooltip?: string | undefined;
}

export interface FieldCellContent {
  kind: 'field';
  fieldId: string;
  fieldKey: string;
  role: CellBusinessRole;
  operation: CellDataOperation;
  expand: CellExpandDirection;
  metricId?: string | undefined;
  timeBucket?: CellTimeBucketConfig | undefined;
  displayName?: string | undefined;
  format?: string | undefined;
  formatOptions?: CellFormatOptions | undefined;
  tooltip?: string | undefined;
  mergePolicy?: CellMergePolicyKind | undefined;
}

export interface BusinessFormulaCellContent {
  kind: 'business-formula';
  metricId: string;
  expression: string;
  scope: 'row' | 'summary';
  precision?: number | undefined;
  displayName?: string | undefined;
  format?: string | undefined;
  formatOptions?: CellFormatOptions | undefined;
  tooltip?: string | undefined;
  mergePolicy?: CellMergePolicyKind | undefined;
}

export interface SheetFormulaCellContent {
  kind: 'sheet-formula';
  formula: string;
  displayName?: string | undefined;
  format?: string | undefined;
  formatOptions?: CellFormatOptions | undefined;
  tooltip?: string | undefined;
  mergePolicy?: CellMergePolicyKind | undefined;
}

export type CellContent =
  | LiteralCellContent
  | FieldCellContent
  | BusinessFormulaCellContent
  | SheetFormulaCellContent;

export interface CellParents {
  row: string | null;
  column: string | null;
}

export interface CellStyleDefinition {
  fontFamily?: string | undefined;
  fontSize?: number | undefined;
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  color?: string | undefined;
  backgroundColor?: string | undefined;
  textAlign?: 'left' | 'center' | 'right' | undefined;
  verticalAlign?: 'top' | 'middle' | 'bottom' | undefined;
  wrapText?: boolean | undefined;
  border?: {
    top?: boolean | undefined;
    bottom?: boolean | undefined;
    left?: boolean | undefined;
    right?: boolean | undefined;
    color?: string | undefined;
  } | undefined;
}

export interface CellDefinition {
  id: string; // templateCellId
  sheetId: string;
  regionId?: string | undefined;
  position: CellPosition;
  content: CellContent;
  parents: CellParents;
  style?: CellStyleDefinition | undefined;
  formatOptions?: CellFormatOptions | undefined;
  conditionRules?: ConditionalRule[] | undefined;
  mergePolicy?: CellMergePolicyKind | undefined;
  /** 混合设计器生成格的身份；画布投影不得将其降为自由单元格。 */
  panelOwner?: { generator: 'hybrid-panel'; cellId: string; generation: string } | undefined;
}

export interface TemplateSheet {
  id: string;
  name: string;
  visible?: boolean | undefined;
  rowCount?: number | undefined;
  columnCount?: number | undefined;
}

export interface CellMergeRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export interface LayoutRule {
  id: string;
  kind: 'merge' | 'column-width' | 'row-height' | 'frozen';
  sheetId: string;
  range?: CellMergeRange | undefined;
  index?: number | undefined;
  size?: number | undefined;
  frozenRows?: number | undefined;
  frozenColumns?: number | undefined;
  source?: 'preset' | 'user' | undefined;
  sequence?: number | undefined;
  semanticSelector?: {
    regionId?: string | undefined;
    masterSignature?: string | undefined;
    coveredSignatures?: string[] | undefined;
    metricDirection?: 'columns' | 'rows' | undefined;
  } | undefined;
}

export interface StyleRule {
  id: string;
  sheetId: string;
  scope: 'template-cell' | 'region' | 'sheet';
  targetId?: string | undefined;
  style: CellStyleDefinition;
  priority: number;
}

export interface ConditionalRule {
  id: string;
  sheetId: string;
  regionId?: string | undefined;
  targetMetricId?: string | undefined;
  condition: {
    operator: 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'eq';
    values: number[];
  };
  style: CellStyleDefinition;
  priority: number;
}

export interface InstanceOverride {
  instanceKey: string;
  templateCellId: string;
  originalBaseValue: any;
  overrideValue: any;
  formula?: string | undefined;
  dataRevision: string | number;
  status: 'active' | 'conflict' | 'orphaned';
}

export interface OrphanedEdit {
  instanceKey: string;
  templateCellId: string;
  lastKnownValue: any;
  reason: string;
}

// ---------------------------------------------------------------------------
// 动态合并协议与模型 (template-dynamic-merge-design.md)
// ---------------------------------------------------------------------------

export type MergeTarget =
  | {
      kind: 'template-cell';
      templateCellId: string;
      subject: 'row-member-label' | 'column-member-label' | 'detail-value' | 'metric-value';
    }
  | {
      kind: 'region-label';
      subject: 'row-total-label' | 'column-total-label' | 'row-subtotal-label' | 'column-subtotal-label';
    };

export interface MergePolicyBase {
  id: string;
  sheetId: string;
  regionId: string;
  target: MergeTarget;
  expectedAxisSchema?: string | undefined;
  enabled: boolean;
  boundary: 'parent-group' | 'region';
  source: 'user' | 'preset';
  sequence: number;
}

export type DynamicMergePolicy = MergePolicyBase & (
  | {
      kind: 'group-span';
      direction: 'auto' | 'horizontal' | 'vertical';
    }
  | {
      kind: 'adjacent-equal';
      direction: 'horizontal' | 'vertical';
      compareBy: 'typed-value';
      mergeNulls: boolean;
      mergeUndefined: boolean;
      mergeEmptyStrings: boolean;
      allowMeasures: boolean;
    }
);

export type MergeSuppression = {
  id: string;
  policyId: string;
  policyKind: 'group-span' | 'adjacent-equal';
  expectedAxisSchema?: string | undefined;
  sequence: number;
  source: 'user';
} & (
  | { scope: 'group-context'; groupContextKey: string }
  | { scope: 'instance-cells'; cellKeys: string[] }
);

export interface MergeConfigV1 {
  capability: 'template-merge-v1';
  identityVersion: 1;
  legacyFallback?: 'explicit-only' | undefined;
  policies: DynamicMergePolicy[];
  suppressions: MergeSuppression[];
}

export interface CellTemplateDocumentV1 {
  documentType: CellDocumentType;
  schemaVersion: CellSchemaVersion;
  id: string;
  title: string;
  templateRevision: number;
  sheets: TemplateSheet[];
  regions: CellRegionConfig[];
  cells: CellDefinition[];
  layoutRules: LayoutRule[];
  styleRules: StyleRule[];
  conditionalRules: ConditionalRule[];
  instanceOverrides: InstanceOverride[];
  orphanedEdits: OrphanedEdit[];
  capabilitiesVersion: 'cell-v1' | 'cell-v2' | 'cell-expansion-v2';
  mergeConfig?: MergeConfigV1 | undefined;
  hybridConfig?: HybridConfig | undefined;
}

export interface HybridAxisDefinition {
  id: string;
  fieldKey: string;
  kind: 'time' | 'category';
  timeBucket?: CellTimeBucketConfig | undefined;
}

export type HybridConfig = { version: 1; showRowTotals: boolean } | {
  version: 2;
  rowAxes: HybridAxisDefinition[];
  columnAxes: HybridAxisDefinition[];
  showRowTotals: boolean;
  enableGroupMerge: boolean;
  configurationErrors?: string[] | undefined;
  retainedMergeConfig?: MergeConfigV1 | undefined;
  disabledLayoutRuleIds?: string[] | undefined;
};

/** 编译与渲染版本戳 */
export interface RenderStamp {
  templateRevision: number;
  dataRevisions: Record<string, string | number>;
  compilerVersion: string;
  renderedAt: number;
}

/** 完整保存的单元格报表包 */
export interface CellSavedReportBundleV1 {
  kind: 'cell-saved-bundle';
  schemaVersion: '1.0' | '1.1' | '2.0';
  capabilitiesVersion?: CellCapabilitiesVersion;
  template: CellTemplateDocumentV1;
  editorSnapshot?: any;
  publication: PublishedReport;
  stamp: RenderStamp;
}

/** 规范化区域执行计划模型 (内部派生，单区域) */
export interface NormalizedRegionPlan {
  regionId: string;
  datasetId: string;
  layoutKind?: RegionLayoutKind | undefined;
  sheetId: string;
  anchor: CellPosition;
  metricDirection?: MetricDirection | undefined;
  filters: RegionFilter[];
  rowDimensions: Array<{
    templateCellId: string;
    fieldId: string;
    fieldKey: string;
    timeBucket?: CellTimeBucketConfig | undefined;
    displayName: string;
    position: CellPosition;
  }>;
  columnDimensions: Array<{
    templateCellId: string;
    fieldId: string;
    fieldKey: string;
    timeBucket?: CellTimeBucketConfig | undefined;
    displayName: string;
    position: CellPosition;
  }>;
  measures: Array<{
    templateCellId: string;
    metricId: string;
    fieldId?: string | undefined;
    fieldKey?: string | undefined;
    operation: CellDataOperation;
    expression?: string | undefined;
    scope?: 'row' | 'summary' | undefined;
    precision?: number | undefined;
    displayName: string;
    format?: string | undefined;
    parents: CellParents;
    position: CellPosition;
  }>;
  detailColumns: Array<{
    templateCellId: string;
    fieldId: string;
    fieldKey: string;
    displayName: string;
    format?: string | undefined;
    position: CellPosition;
  }>;
  rowTotals?: RegionTotalsConfig | undefined;
  columnTotals?: RegionTotalsConfig | undefined;
  policies?: DynamicMergePolicy[] | undefined;
  suppressions?: MergeSuppression[] | undefined;
}

/** 校验诊断 */
export interface TemplateDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  targetId?: string | undefined;
  sheetId?: string | undefined;
}
