import type { ColumnConfig, DynamicTransformConfig } from '../engine/types.js';
import type { CellDefinition, CellTemplateDocumentV1, DynamicMergePolicy, HybridAxisDefinition, LayoutRule } from './types.js';
import type { PanelToTemplateOptions } from './panelToTemplateAdapter.js';

/** 多级轴的局部原型。列轴逐行向下，行轴逐列向右；度量绑定两个叶轴。 */
export function compileHybridHierarchy(config: DynamicTransformConfig, datasetId: string, options: PanelToTemplateOptions,
  rowAxes: HybridAxisDefinition[], columnAxes: HybridAxisDefinition[]): CellTemplateDocumentV1 {
  const sheetId = options.sheetId || 'sheet-1';
  const regionId = 'region-1';
  const r0 = Math.max(0, options.anchorRow ?? 2), c0 = Math.max(0, options.anchorCol ?? 0);
  const pivot = columnAxes.length > 0;
  const headerDepth = Math.max(1, columnAxes.length);
  const bodyRow = r0 + headerDepth;
  const labelCol = c0 + rowAxes.length;
  const dataCol = labelCol + (pivot ? 1 : 0);
  const headers = config.headers || {};
  let measures: readonly ColumnConfig[] = config.columns.filter((c) => c.type === 'aggregated' || c.type === 'computed');
  if (measures.length === 0) measures = config.columns;
  const cells: CellDefinition[] = [];
  const layoutRules: LayoutRule[] = [];
  const policies: DynamicMergePolicy[] = [];
  const axisCellId = (axis: 'row' | 'column', spec: HybridAxisDefinition, index: number) => {
    const all = axis === 'row' ? rowAxes : columnAxes;
    const rawSuffix = spec.kind === 'category' && all.some((s) => s.kind === 'time' && s.fieldKey === spec.fieldKey) ? '-raw' : '';
    const prefix = !pivot && axis === 'row' && index === 0 ? 'pri' : axis === 'column' ? 'col' : 'row';
    return `cell-${prefix}-${spec.fieldKey}${rawSuffix}`;
  };
  const rowIds = rowAxes.map((s, i) => axisCellId('row', s, i));
  const colIds = columnAxes.map((s, i) => axisCellId('column', s, i));
  const rowParent = rowIds.at(-1) || 'none';
  const colParent = colIds.at(-1) || 'none';
  const rowLabels = rowAxes.map((s) => headers[s.fieldKey] || s.fieldKey);
  const colLabels = columnAxes.map((s) => headers[s.fieldKey] || s.fieldKey);
  const title = pivot ? `${rowLabels.join(' / ') || '汇总'} × ${colLabels.join(' / ')} 双向交叉报表` : `${rowLabels.join(' / ')} 层级分组统计表`;
  const literal = (id: string, row: number, column: number, value: string) => cells.push({ id, sheetId, regionId,
    position: { row, column }, content: { kind: 'literal', value }, parents: { row: 'none', column: 'none' },
    style: { bold: true, backgroundColor: '#fafafa' } });

  if ((options.includeTitle ?? r0 >= 2) && (r0 > 0 || options.titlePosition !== undefined)) {
    const row = r0 >= 2 ? r0 - 2 : r0 - 1;
    literal('title', row, c0, title);
    cells[0]!.style = { bold: true, fontSize: 14, color: '#1677ff' };
    layoutRules.push({ id: 'merge-title', sheetId, kind: 'merge', source: 'user', sequence: 1,
      range: { startRow: row, endRow: row, startColumn: c0, endColumn: Math.max(c0 + 1, dataCol + (options.showRowTotals && pivot ? 1 : 0), pivot ? c0 + 4 : dataCol + measures.length - 1) } });
  }

  rowAxes.forEach((spec, i) => {
    const id = rowIds[i]!;
    const headerId = pivot ? i === 0 ? 'hdr-row-name' : `hdr-row-${spec.fieldKey}` : i === 0 ? 'hdr-pri' : `hdr-row-${spec.fieldKey}`;
    literal(headerId, r0 + headerDepth - 1, c0 + i, rowLabels[i]!);
    cells.push({ id, sheetId, regionId, position: { row: bodyRow, column: c0 + i },
      content: { kind: 'field', fieldId: spec.fieldKey, fieldKey: spec.fieldKey, role: 'row-dimension',
        operation: 'group', expand: 'down', displayName: rowLabels[i], timeBucket: spec.timeBucket },
      parents: { row: rowIds[i - 1] || 'none', column: 'none' },
      style: { bold: true, color: '#0958d9', backgroundColor: '#e6f7ff', verticalAlign: 'top' } });
    if (options.enableGroupMerge !== false) policies.push({ id: `merge-policy-${id}`, sheetId, regionId,
      target: { kind: 'template-cell', templateCellId: id, subject: 'row-member-label' }, kind: 'group-span', direction: 'vertical',
      enabled: true, boundary: 'parent-group', source: 'preset', sequence: i + 1 });
  });
  columnAxes.forEach((spec, i) => {
    const id = colIds[i]!;
    cells.push({ id, sheetId, regionId, position: { row: r0 + i, column: dataCol },
      content: { kind: 'field', fieldId: spec.fieldKey, fieldKey: spec.fieldKey, role: 'column-dimension',
        operation: 'group', expand: 'right', displayName: colLabels[i], timeBucket: spec.timeBucket },
      parents: { row: 'none', column: colIds[i - 1] || 'none' },
      style: { bold: true, color: '#531dab', backgroundColor: '#f9f0ff', textAlign: 'center', verticalAlign: 'middle' } });
    if (options.enableGroupMerge !== false) policies.push({ id: `merge-policy-${id}`, sheetId, regionId,
      target: { kind: 'template-cell', templateCellId: id, subject: 'column-member-label' }, kind: 'group-span', direction: 'horizontal',
      enabled: true, boundary: 'parent-group', source: 'preset', sequence: rowAxes.length + i + 1 });
  });
  if (pivot) literal('hdr-metric-name', bodyRow - 1, labelCol, '指标名称');
  measures.forEach((col, i) => {
    const key = (col as any).field || (col as any).name || `m_${i}`;
    const label = col.label || headers[key] || key;
    const row = pivot ? bodyRow + i : bodyRow;
    const column = pivot ? dataCol : dataCol + i;
    if (pivot) cells.push({ id: `lbl-metric-${key}`, sheetId, regionId, position: { row, column: labelCol },
      content: { kind: 'literal', value: label }, parents: { row: rowParent, column: 'none' },
      style: { color: '#595959', backgroundColor: '#fafafa' } });
    else literal(`hdr-m-${key}`, r0, column, label);
    cells.push({ id: `meas-${key}`, sheetId, regionId, position: { row, column },
      content: { kind: 'field', fieldId: key, fieldKey: key, metricId: `metric-${key}`, role: 'measure',
        operation: (col as any).agg || 'sum', expand: 'inherit', displayName: label, format: options.formats?.[key] || 'number' },
      parents: { row: rowParent, column: colParent }, style: { textAlign: 'general', color: '#d46b08', backgroundColor: '#fff7e6' } });
    if (pivot && options.showRowTotals) cells.push({ id: `meas-rowtotal-${key}`, sheetId, regionId, position: { row, column: dataCol + 1 },
      content: { kind: 'field', fieldId: key, fieldKey: key, metricId: `metric-rowtotal-${key}`, role: 'measure',
        operation: (col as any).agg || 'sum', expand: 'inherit', displayName: `行总计-${label}`, format: options.formats?.[key] || 'number' },
      parents: { row: rowParent === rowIds[0] ? 'default' : rowParent, column: 'none' },
      style: { bold: true, textAlign: 'general', color: '#0958d9', backgroundColor: '#f0f5ff' } });
  });
  if (pivot && options.showRowTotals) literal('hdr-row-total', bodyRow - 1, dataCol + 1, '行总计');
  for (let column = c0; column <= (pivot ? dataCol + (options.showRowTotals ? 1 : 0) : dataCol + measures.length - 1); column++) {
    layoutRules.push({ id: `col-w-${column - c0}`, sheetId, kind: 'column-width', index: column,
      size: column < labelCol ? 200 : pivot && column === labelCol ? 140 : 130, source: 'preset', sequence: column - c0 + 2 });
  }
  return { documentType: 'cell-template', schemaVersion: '2.0', capabilitiesVersion: 'cell-expansion-v2',
    id: `template-${pivot ? 'pivot' : 'grouped'}-${Date.now()}`, title, templateRevision: 1,
    sheets: [{ id: sheetId, name: options.sheetName || (pivot ? '交叉分析' : '分组统计') }],
    regions: [{ id: regionId, datasetId, sheetId, anchor: { row: r0, column: c0 }, filters: [] }],
    cells, layoutRules, styleRules: [], presentationRules: { version: 1, revision: 0, ruleSets: [] }, instanceOverrides: [], orphanedEdits: [],
    mergeConfig: { capability: 'template-merge-v1', identityVersion: 1, legacyFallback: 'explicit-only', policies, suppressions: [] } };
}
