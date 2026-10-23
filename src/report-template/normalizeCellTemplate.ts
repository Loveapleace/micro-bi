import type {
  CellTemplateDocumentV1,
  NormalizedRegionPlan,
  CellRegionConfig,
  FieldCellContent,
  BusinessFormulaCellContent,
} from './types.js';
import { resolveMetricId } from './identity.js';

export function normalizeCellTemplate(
  doc: CellTemplateDocumentV1,
  regionId?: string
): NormalizedRegionPlan | null {
  if (!doc.regions || doc.regions.length === 0) {
    return null;
  }

  const defaultRegion = doc.regions[0];
  if (!defaultRegion) return null;
  const region: CellRegionConfig = (regionId
    ? doc.regions.find((r) => r.id === regionId)
    : defaultRegion) ?? defaultRegion;

  const regionCells = (doc.cells || []).filter((c) => c.regionId === region.id);

  const rowDimensions: NormalizedRegionPlan['rowDimensions'] = [];
  const columnDimensions: NormalizedRegionPlan['columnDimensions'] = [];
  const measures: NormalizedRegionPlan['measures'] = [];
  const detailColumns: NormalizedRegionPlan['detailColumns'] = [];

  for (const cell of regionCells) {
    if (cell.content.kind === 'field') {
      const fc = cell.content as FieldCellContent;
      if (fc.role === 'row-dimension') {
        rowDimensions.push({
          templateCellId: cell.id,
          fieldId: fc.fieldId,
          fieldKey: fc.fieldKey,
          timeBucket: fc.timeBucket,
          displayName: fc.displayName || fc.fieldKey,
          position: cell.position,
        });
      } else if (fc.role === 'column-dimension') {
        columnDimensions.push({
          templateCellId: cell.id,
          fieldId: fc.fieldId,
          fieldKey: fc.fieldKey,
          timeBucket: fc.timeBucket,
          displayName: fc.displayName || fc.fieldKey,
          position: cell.position,
        });
      } else if (fc.role === 'measure') {
        const mId = fc.metricId || resolveMetricId(fc.fieldKey, fc.operation);
        measures.push({
          templateCellId: cell.id,
          metricId: mId,
          fieldId: fc.fieldId,
          fieldKey: fc.fieldKey,
          operation: fc.operation,
          displayName: fc.displayName || `${fc.operation.toUpperCase()}(${fc.fieldKey})`,
          format: fc.format,
          parents: cell.parents,
          position: cell.position,
        });
      } else if (fc.role === 'detail-column') {
        detailColumns.push({
          templateCellId: cell.id,
          fieldId: fc.fieldId,
          fieldKey: fc.fieldKey,
          displayName: fc.displayName || fc.fieldKey,
          format: fc.format,
          position: cell.position,
        });
      }
    } else if (cell.content.kind === 'business-formula') {
      const bc = cell.content as BusinessFormulaCellContent;
      measures.push({
        templateCellId: cell.id,
        metricId: bc.metricId,
        operation: 'list',
        expression: bc.expression,
        scope: bc.scope || 'summary',
        precision: bc.precision,
        displayName: bc.displayName || bc.metricId,
        format: bc.format,
        parents: cell.parents,
        position: cell.position,
      });
    }
  }

  // 保证 metricId 唯一，避免同一字段/聚合重复绑定导致实例身份碰撞
  const seenMetricIds = new Set<string>();
  for (const m of measures) {
    let id = m.metricId;
    let n = 1;
    while (seenMetricIds.has(id)) {
      n += 1;
      id = `${m.metricId}_${n}`;
    }
    m.metricId = id;
    seenMetricIds.add(id);
  }

  rowDimensions.sort((a, b) => a.position.row - b.position.row || a.position.column - b.position.column);
  columnDimensions.sort((a, b) => a.position.column - b.position.column || a.position.row - b.position.row);
  detailColumns.sort((a, b) => a.position.column - b.position.column);
  measures.sort((a, b) => {
    if (region.metricDirection === 'rows') {
      return a.position.row - b.position.row || a.position.column - b.position.column;
    }
    return a.position.column - b.position.column || a.position.row - b.position.row;
  });

  const policies = (doc.mergeConfig?.policies || []).filter(
    (p) => p.regionId === region.id && p.sheetId === region.sheetId
  );
  const suppressions = (doc.mergeConfig?.suppressions || []).filter(
    (s) => policies.some((p) => p.id === s.policyId)
  );

  return {
    regionId: region.id,
    datasetId: region.datasetId,
    layoutKind: region.layoutKind,
    sheetId: region.sheetId,
    anchor: region.anchor || { row: 0, column: 0 },
    metricDirection: region.metricDirection || 'columns',
    filters: region.filters || [],
    rowDimensions,
    columnDimensions,
    measures,
    detailColumns,
    rowTotals: region.rowTotals,
    columnTotals: region.columnTotals,
    policies,
    suppressions,
  };
}
