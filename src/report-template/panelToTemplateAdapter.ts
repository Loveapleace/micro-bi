/**
 * 意图转译编译器 (panelToTemplateAdapter.ts)
 * 职责：纯函数式将 DynamicTransformConfig（高层语义配置）转译为标准的 CellTemplateDocumentV1（正交双父格网格）。
 * 满足单向数据流与无状态即时求值。
 */
import type { DynamicTransformConfig, ColumnConfig } from '../engine/types.js';
import { normalizeHybridAxes, readHybridAxes } from './hybridAxes.js';
import { compileHybridHierarchy } from './compileHybridHierarchy.js';
import type {
  CellTemplateDocumentV1,
  CellDefinition,
  DynamicMergePolicy,
  LayoutRule,
  HybridAxisDefinition,
} from './types.js';

export interface PanelToTemplateOptions {
  sheetId?: string | undefined;
  sheetName?: string | undefined;
  datasetName?: string | undefined;
  archetype?: 'auto' | 'pivot' | 'grouped' | 'detail' | undefined;
  defaultRowDim?: string | undefined;
  defaultColDim?: string | undefined;
  showRowTotals?: boolean | undefined;
  showColTotals?: boolean | undefined;
  enableGroupMerge?: boolean | undefined;
  formats?: Record<string, string> | undefined;
  anchorRow?: number | undefined;
  anchorCol?: number | undefined;
  includeTitle?: boolean | undefined;
  titlePosition?: { row: number; column: number } | undefined;
  rowAxes?: HybridAxisDefinition[] | undefined;
  columnAxes?: HybridAxisDefinition[] | undefined;
}

export function compilePanelToCellTemplate(
  config: DynamicTransformConfig,
  datasetId: string,
  options: PanelToTemplateOptions = {}
): CellTemplateDocumentV1 {
  const sheetId = options.sheetId || 'sheet-1';
  const regionId = 'region-1';
  const headers = config.headers || {};
  const datasetName = options.datasetName || config.datasetId || datasetId;

  // 1. 判断报表原型形态
  let archetype = options.archetype || 'auto';
  if (archetype === 'auto') {
    const hasColCategories = Boolean(
      config.dimensions?.columnCategories && config.dimensions.columnCategories.length > 0
    );
    const hasColTime = Boolean(config.dimensions?.columnTimeBucket?.field);
    const hasRowCategories = Boolean(
      config.dimensions?.categories && config.dimensions.categories.length > 0
    );
    const hasRowTime = Boolean(config.dimensions?.timeBucket?.field);

    if (hasColCategories || hasColTime) {
      archetype = 'pivot';
    } else if (hasRowCategories || hasRowTime) {
      archetype = 'grouped';
    } else {
      archetype = 'detail';
    }
  }

  // 2. 根据原型形态生成 CellTemplateDocumentV1，并声明系统生成格的归属。
  const normalized = normalizeHybridAxes(config);
  if (!normalized.rowAxes.length && options.defaultRowDim) normalized.rowAxes.push({ id: `row:category:${options.defaultRowDim}`, fieldKey: options.defaultRowDim, kind: 'category' });
  if (!normalized.columnAxes.length && options.defaultColDim) normalized.columnAxes.push({ id: `column:category:${options.defaultColDim}`, fieldKey: options.defaultColDim, kind: 'category' });
  const rowAxes = options.rowAxes || normalized.rowAxes;
  const columnAxes = options.columnAxes || normalized.columnAxes;
  for (const [selected, explicit, label] of [[normalized.rowAxes, rowAxes, '行'], [normalized.columnAxes, columnAxes, '列']] as const) {
    if (selected.length !== explicit.length || selected.some((s) => !explicit.some((e) => e.fieldKey === s.fieldKey && e.kind === s.kind))) normalized.errors.push(`${label}轴定义与面板所选维度不一致`);
  }
  let doc: CellTemplateDocumentV1;
  if (archetype === 'pivot') {
    doc = compileHybridHierarchy(config, datasetId, options, rowAxes, columnAxes);
  } else if (archetype === 'grouped') {
    doc = rowAxes.length > 2 || Boolean(config.dimensions?.timeBucket?.field) || options.rowAxes
      ? compileHybridHierarchy(config, datasetId, options, rowAxes, [])
      : compileGroupedTemplate(config, datasetId, regionId, sheetId, datasetName, headers, options);
  } else {
    doc = compileDetailTemplate(config, datasetId, regionId, sheetId, datasetName, headers, options);
  }
  const title = doc.cells.find((c) => c.id === 'title');
  if (title && options.titlePosition) {
    const delta = options.titlePosition.column - title.position.column;
    title.position = { ...options.titlePosition };
    doc.layoutRules = doc.layoutRules.map((r) => r.id === 'merge-title' && r.range ? { ...r,
      range: { ...r.range, startRow: title.position.row, endRow: title.position.row,
        startColumn: r.range.startColumn + delta, endColumn: r.range.endColumn + delta } } : r);
  }
  const signature = JSON.stringify(doc.cells.map((c) => [c.id, c.position.row, c.position.column]));
  let generationHash = 2166136261;
  for (let i = 0; i < signature.length; i++) generationHash = Math.imul(generationHash ^ signature.charCodeAt(i), 16777619);
  const generation = `panel-${(generationHash >>> 0).toString(16)}`;
  const semanticKey = (cell: CellDefinition): string | undefined => {
    if (cell.content.kind !== 'literal') return undefined;
    if (cell.id.startsWith('hdr-m-')) return `label:metric:${cell.id.slice('hdr-m-'.length)}`;
    if (cell.id.startsWith('lbl-metric-')) return `label:metric:${cell.id.slice('lbl-metric-'.length)}`;
    const driver = doc.cells.find((d) => d.content.kind === 'field' && d.content.role === 'row-dimension' && d.position.column === cell.position.column && d.content.displayName === (cell.content as any).value);
    return driver?.content.kind === 'field' ? `label:row:${driver.content.fieldKey}:${driver.content.timeBucket ? 'time' : 'category'}` : undefined;
  };
  return {
    ...doc,
    hybridConfig: { version: 2, ...((archetype === 'grouped' && rowAxes.length <= 2 && !config.dimensions?.timeBucket?.field && !options.rowAxes)
      ? readHybridAxes(doc) : { rowAxes, columnAxes }), showRowTotals: options.showRowTotals === true,
      enableGroupMerge: options.enableGroupMerge !== false, configurationErrors: normalized.errors },
    cells: doc.cells.map((c) => ({
      ...c,
      panelOwner: { generator: 'hybrid-panel', cellId: c.id, generation, semanticKey: semanticKey(c) },
      ...(c.id === 'title' && c.content.kind === 'literal' ? { staticSpan: { id: `span-${c.id}`, enabled: true, regionId,
        scope: 'report' as const, placement: 'template' as const, repeat: 'once' as const, rowOffset: 0, height: 1,
        includeTotals: true, merge: true, suppressions: [] } } : {}),
    })),
  };
}

function compileGroupedTemplate(
  config: DynamicTransformConfig,
  datasetId: string,
  regionId: string,
  sheetId: string,
  _datasetName: string,
  headers: Record<string, string>,
  options: PanelToTemplateOptions
): CellTemplateDocumentV1 {
  const categories = config.dimensions?.categories || [];
  const timeField = config.dimensions?.timeBucket?.field;
  const priDimKey = categories[0] || timeField || options.defaultRowDim || 'pri_dim';
  const secDimKey = categories[1] || (categories[0] ? timeField : undefined);

  const priLabel = headers[priDimKey] || priDimKey;
  const secLabel = secDimKey ? headers[secDimKey] || secDimKey : undefined;

  const timeBucket = config.dimensions?.timeBucket;
  const isPriDate = Boolean(timeBucket?.field && timeBucket.field === priDimKey);
  const isSecDate = Boolean(timeBucket?.field && timeBucket.field === secDimKey);

  let measureCols: ColumnConfig[] = config.columns.filter(
    (c) => c.type === 'aggregated' || c.type === 'computed'
  );
  if (measureCols.length === 0) {
    measureCols = config.columns.filter((c) => c.type === 'fixed');
  }
  if (measureCols.length === 0) {
    measureCols = [{ type: 'aggregated', field: 'value', agg: 'sum', label: '汇总值' }];
  }

  const priCellId = `cell-pri-${priDimKey}`;
  const secCellId = secDimKey ? `cell-sec-${secDimKey}` : null;

  const anchorR = options.anchorRow !== undefined ? Math.max(0, options.anchorRow) : 2;
  const anchorC = options.anchorCol !== undefined ? Math.max(0, options.anchorCol) : 0;
  const withTitle = options.includeTitle !== undefined ? options.includeTitle : (anchorR >= 2);
  const shouldIncludeTitle = withTitle && (anchorR > 0 || options.titlePosition !== undefined);
  const titleRow = anchorR >= 2 ? anchorR - 2 : (anchorR >= 1 ? anchorR - 1 : 0);

  const cells: CellDefinition[] = [];

  if (shouldIncludeTitle) {
    cells.push({
      id: 'title',
      sheetId,
      position: { row: titleRow, column: anchorC },
      content: { kind: 'literal', value: `${priLabel} 层级分组统计表` },
      parents: { row: null, column: null },
      style: { bold: true, fontSize: 14, color: '#1677ff' },
    });
  }

  cells.push({
    id: 'hdr-pri',
    sheetId,
    position: { row: anchorR, column: anchorC },
    content: { kind: 'literal', value: priLabel },
    parents: { row: null, column: null },
    style: { bold: true, backgroundColor: '#fafafa' },
  });

  let colIdx = 1;
  if (secDimKey && secLabel) {
    cells.push({
      id: 'hdr-sec',
      sheetId,
      position: { row: anchorR, column: anchorC + colIdx },
      content: { kind: 'literal', value: secLabel },
      parents: { row: null, column: null },
      style: { bold: true, backgroundColor: '#fafafa' },
    });
    colIdx++;
  }

  measureCols.forEach((col) => {
    const mKey = (col as any).field || (col as any).name || `m_${colIdx}`;
    const mLabel = col.label || headers[mKey] || mKey;
    cells.push({
      id: `hdr-m-${mKey}`,
      sheetId,
      position: { row: anchorR, column: anchorC + colIdx },
      content: { kind: 'literal', value: mLabel },
      parents: { row: null, column: null },
      style: { bold: true, backgroundColor: '#fafafa', textAlign: 'right' },
    });
    colIdx++;
  });

  // 数据展开行 (Row anchorR + 1)
  cells.push({
    id: priCellId,
    sheetId,
    regionId,
    position: { row: anchorR + 1, column: anchorC },
    content: {
      kind: 'field',
      fieldId: priDimKey,
      fieldKey: priDimKey,
      role: 'row-dimension',
      operation: 'group',
      expand: 'down',
      timeBucket:
        isPriDate && timeBucket?.granularity && timeBucket.granularity !== 'custom'
          ? { granularity: timeBucket.granularity as any }
          : undefined,
      displayName: priLabel,
    },
    parents: { row: null, column: null },
    style: { bold: true, color: '#0958d9', backgroundColor: '#e6f7ff' },
  });

  let dColIdx = 1;
  if (secDimKey && secCellId && secLabel) {
    cells.push({
      id: secCellId,
      sheetId,
      regionId,
      position: { row: anchorR + 1, column: anchorC + dColIdx },
      content: {
        kind: 'field',
        fieldId: secDimKey,
        fieldKey: secDimKey,
        role: 'row-dimension',
        operation: 'group',
        expand: 'down',
        timeBucket:
          isSecDate && timeBucket?.granularity && timeBucket.granularity !== 'custom'
            ? { granularity: timeBucket.granularity as any }
            : undefined,
        displayName: secLabel,
      },
      parents: { row: priCellId, column: null },
      style: { color: '#0958d9', backgroundColor: '#f0f5ff' },
    });
    dColIdx++;
  }

  measureCols.forEach((col) => {
    const mKey = (col as any).field || (col as any).name || `m_${dColIdx}`;
    const mLabel = col.label || headers[mKey] || mKey;
    const op = (col as any).agg || 'sum';

    const cellFormat = options.formats?.[mKey] || 'number';

    cells.push({
      id: `meas-${mKey}`,
      sheetId,
      regionId,
      position: { row: anchorR + 1, column: anchorC + dColIdx },
      content: {
        kind: 'field',
        fieldId: mKey,
        fieldKey: mKey,
        metricId: `metric-${mKey}`,
        role: 'measure',
        operation: op,
        expand: 'inherit',
        displayName: mLabel,
        format: cellFormat,
      },
      parents: {
        row: secCellId || priCellId,
        column: null,
      },
      style: { textAlign: 'right', color: '#d46b08', backgroundColor: '#fff7e6' },
    });
    dColIdx++;
  });

  const groupedPolicies: DynamicMergePolicy[] = [];
  if (options.enableGroupMerge !== false) {
    groupedPolicies.push({
      id: `merge-policy-${priCellId}`,
      sheetId,
      regionId,
      target: {
        kind: 'template-cell',
        templateCellId: priCellId,
        subject: 'row-member-label',
      },
      kind: 'group-span',
      direction: 'vertical',
      enabled: true,
      boundary: 'parent-group',
      source: 'preset',
      sequence: 1,
    });

    if (secCellId) {
      groupedPolicies.push({
        id: `merge-policy-${secCellId}`,
        sheetId,
        regionId,
        target: {
          kind: 'template-cell',
          templateCellId: secCellId,
          subject: 'row-member-label',
        },
        kind: 'group-span',
        direction: 'vertical',
        enabled: true,
        boundary: 'parent-group',
        source: 'preset',
        sequence: 2,
      });
    }
  }

  return {
    documentType: 'cell-template',
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: `template-grouped-${Date.now()}`,
    title: `${priLabel} 层级分组统计表`,
    templateRevision: 1,
    sheets: [{ id: sheetId, name: options.sheetName || '分组统计' }],
    regions: [
      {
        id: regionId,
        datasetId,
        sheetId,
        anchor: { row: anchorR, column: anchorC },
        filters: [],
      },
    ],
    cells,
    layoutRules: [
      ...(shouldIncludeTitle
        ? [
            {
              id: 'merge-title',
              kind: 'merge' as const,
              sheetId,
              range: {
                startRow: titleRow,
                endRow: titleRow,
                startColumn: anchorC,
                endColumn: anchorC + colIdx - 1,
              },
              source: 'user' as const,
              sequence: 1,
            },
          ]
        : []),
      {
        id: 'col-w-0',
        kind: 'column-width',
        sheetId,
        index: anchorC,
        size: 200,
        source: 'preset',
        sequence: 2,
      },
    ],
    mergeConfig: {
      capability: 'template-merge-v1',
      identityVersion: 1,
      legacyFallback: 'explicit-only',
      policies: groupedPolicies,
      suppressions: [],
    },
    styleRules: [],
    presentationRules: { version: 1, revision: 0, ruleSets: [] },
    instanceOverrides: [],
    orphanedEdits: [],
  };
}

function compileDetailTemplate(
  config: DynamicTransformConfig,
  datasetId: string,
  regionId: string,
  sheetId: string,
  datasetName: string,
  headers: Record<string, string>,
  options: PanelToTemplateOptions
): CellTemplateDocumentV1 {
  const anchorR = options.anchorRow !== undefined ? Math.max(0, options.anchorRow) : 2;
  const anchorC = options.anchorCol !== undefined ? Math.max(0, options.anchorCol) : 0;
  const withTitle = options.includeTitle !== undefined ? options.includeTitle : (anchorR >= 2);
  const shouldIncludeTitle = withTitle && (anchorR > 0 || options.titlePosition !== undefined);
  const titleRow = anchorR >= 2 ? anchorR - 2 : (anchorR >= 1 ? anchorR - 1 : 0);

  const cols = config.columns.length > 0 ? config.columns : [{ type: 'fixed' as const, field: 'id', label: 'ID' }];
  const cells: CellDefinition[] = [];

  // 标题
  if (shouldIncludeTitle) {
    cells.push({
      id: 'title',
      sheetId,
      position: { row: titleRow, column: anchorC },
      content: {
        kind: 'literal',
        value: `${datasetName} 业务明细流水清单`,
      },
      parents: { row: null, column: null },
      style: { bold: true, fontSize: 14, color: '#1d39c4' },
    });
  }

  const masterCol = cols[0];
  const masterKey = (masterCol as any).field || (masterCol as any).name || 'col_0';
  const masterDriverId = `cell-detail-${masterKey}`;

  cols.forEach((col, idx) => {
    const key = (col as any).field || (col as any).name || `col_${idx}`;
    const label = col.label || headers[key] || key;
    const isNum = col.type === 'aggregated';
    const cellFormat = options.formats?.[key] || (isNum ? 'number' : undefined);

    // 表头 (Row anchorR)
    cells.push({
      id: `hdr-${key}`,
      sheetId,
      position: { row: anchorR, column: anchorC + idx },
      content: { kind: 'literal', value: label },
      parents: { row: null, column: null },
      style: { bold: true, backgroundColor: '#fafafa', textAlign: isNum ? 'right' : 'center' },
    });

    // 明细行 (Row anchorR + 1)
    cells.push({
      id: idx === 0 ? masterDriverId : `cell-detail-${key}`,
      sheetId,
      regionId,
      position: { row: anchorR + 1, column: anchorC + idx },
      content: {
        kind: 'field',
        fieldId: key,
        fieldKey: key,
        displayName: label,
        role: 'detail-column',
        operation: 'list',
        expand: 'down',
        format: cellFormat,
      },
      parents: {
        row: idx === 0 ? 'none' : masterDriverId,
        column: 'none',
      },
      style: { textAlign: isNum ? 'right' : 'left', verticalAlign: 'middle' },
    });
  });

  return {
    documentType: 'cell-template',
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: `template-detail-${Date.now()}`,
    title: `${datasetName} 业务明细清单`,
    templateRevision: 1,
    sheets: [{ id: sheetId, name: options.sheetName || '明细清单' }],
    regions: [
      {
        id: regionId,
        datasetId,
        sheetId,
        anchor: { row: anchorR, column: anchorC },
        filters: [],
      },
    ],
    cells,
    layoutRules: [
      ...(shouldIncludeTitle
        ? [
            {
              id: 'merge-title',
              kind: 'merge' as const,
              sheetId,
              range: {
                startRow: titleRow,
                endRow: titleRow,
                startColumn: anchorC,
                endColumn: anchorC + cols.length - 1,
              },
              source: 'user' as const,
              sequence: 1,
            },
          ]
        : []),
    ],
    mergeConfig: {
      capability: 'template-merge-v1',
      identityVersion: 1,
      legacyFallback: 'explicit-only',
      policies: [],
      suppressions: [],
    },
    styleRules: [],
    presentationRules: { version: 1, revision: 0, ruleSets: [] },
    instanceOverrides: [],
    orphanedEdits: [],
  };
}
