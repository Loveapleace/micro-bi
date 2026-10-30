import type {
  CellTemplateDocumentV1,
  TemplateDiagnostic,
  CellDefinition,
  FieldCellContent,
} from './types.js';
import { parseFormula, extractReferencedFields } from '../engine/formula/parser.js';
import { validateHybridAxes } from './hybridAxes.js';
import { validateStaticSpans } from './staticSpans.js';
import { validatePresentationRules } from './presentationRules.js';
import { isValidNumberFormat } from '../report/numberFormat.js';
import { isValidTimeZone } from '../engine/bucketing.js';

export interface ValidationResult {
  valid: boolean;
  diagnostics: TemplateDiagnostic[];
}

const VALID_ROLES = new Set(['detail-column', 'row-dimension', 'column-dimension', 'measure', 'total']);
const VALID_OPERATIONS = new Set(['list', 'group', 'sum', 'avg', 'count', 'min', 'max']);
const VALID_EXPANDS = new Set(['down', 'right', 'none', 'inherit']);
const VALID_GRANULARITIES = new Set(['hour', 'day', 'week', 'month', 'quarter', 'year', 'custom']);

export function validateCellTemplateDocument(
  doc: CellTemplateDocumentV1,
  availableFields?: readonly string[] | undefined
): ValidationResult {
  const diagnostics: TemplateDiagnostic[] = [...validateHybridAxes(doc), ...validateStaticSpans(doc), ...validatePresentationRules(doc, availableFields)];
  const occupied = new Map<string, string>();
  const drillTargets = new Set<string>();
  for(const rule of doc.drillRules||[]){
    const key=JSON.stringify([rule.sheetId,rule.datasetId,rule.semanticKey||rule.cellId]);
    const source=doc.cells.find(c=>c.id===rule.cellId&&c.sheetId===rule.sheetId);
    const error=(message:string)=>diagnostics.push({severity:'error',code:'ERR_DRILL_RULE',targetId:rule.cellId,message});
    if(drillTargets.has(key))error('同一源格只能配置一条明细规则');drillTargets.add(key);
    if(!Number.isInteger(rule.pageSize)||rule.pageSize<1||rule.pageSize>100)error('明细每页条数需为1～100');
    if(!Array.isArray(rule.columns)||rule.columns.some(c=>typeof c!=='string'||!c))error('明细列配置无效');
    if(source&&rule.enabled){
      if(!['field','business-formula'].includes(source.content.kind))error('此单元格不支持自动事实明细');
      if(rule.field&&(source.content.kind!=='field'||source.content.fieldKey!==rule.field))error('明细规则与源字段身份不一致');
      if(availableFields?.length&&rule.columns.some(c=>!availableFields.includes(c)))error('明细列引用不存在的字段');
    }
  }
  for(const cell of doc.cells||[]){
    if(cell.content.kind==='field'&&cell.content.timeBucket?.timezone&&!isValidTimeZone(cell.content.timeBucket.timezone))diagnostics.push({severity:'error',code:'ERR_TIMEZONE',targetId:cell.id,message:'时间分桶的IANA时区无效'});
    const pattern=((cell.content as any)?.formatOptions||cell.formatOptions)?.numberFormat;
    if(pattern!==undefined&&!isValidNumberFormat(pattern))diagnostics.push({severity:'error',code:'ERR_NUMBER_FORMAT',targetId:cell.id,message:'Excel数字格式模式串无效'});
  }
  if (doc.hybridConfig?.version === 2) {
    for (const cell of doc.cells || []) {
      const key = `${cell.sheetId}:${cell.position.row}:${cell.position.column}`;
      const other = occupied.get(key);
      if (other) diagnostics.push({ severity: 'error', code: 'ERR_HYBRID_CELL_COLLISION', targetId: cell.id,
        message: `新增布局与已有内容冲突（R${cell.position.row + 1}C${cell.position.column + 1}）：${other} / ${cell.id}。请先移动备注或调整维度。` });
      occupied.set(key, cell.id);
    }
  }

  if (doc.documentType !== 'cell-template') {
    diagnostics.push({
      severity: 'error',
      code: 'ERR_INVALID_DOC_TYPE',
      message: `Invalid documentType "${doc.documentType}". Expected "cell-template".`,
    });
  }

  if (doc.schemaVersion !== '1.0' && doc.schemaVersion !== '1.1' && doc.schemaVersion !== '2.0') {
    diagnostics.push({
      severity: 'error',
      code: 'ERR_INVALID_SCHEMA_VERSION',
      message: `Unsupported schemaVersion "${doc.schemaVersion}". Expected "1.0", "1.1" or "2.0".`,
    });
  }

  if (!doc.sheets || doc.sheets.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'ERR_NO_SHEETS',
      message: 'Document must contain at least one sheet.',
    });
  }

  const sheetIdSet = new Set((doc.sheets || []).map((s) => s.id));

  // 首版规则：cell-v1 活动数据区域不得超过 1 个；cell-v2 / cell-expansion-v2 允许同页多区域
  if (doc.regions && doc.regions.length > 1 && doc.capabilitiesVersion === 'cell-v1') {
    diagnostics.push({
      severity: 'error',
      code: 'ERR_MULTIPLE_REGIONS_UNSUPPORTED',
      message: `First version supports at most 1 active data region. Found ${doc.regions.length}.`,
    });
  }

  const regionIdSet = new Set((doc.regions || []).map((r) => r.id));
  const cellMap = new Map<string, CellDefinition>();

  for (const cell of doc.cells || []) {
    if (!cell.id) {
      diagnostics.push({
        severity: 'error',
        code: 'ERR_CELL_MISSING_ID',
        message: 'Cell is missing required id.',
        sheetId: cell.sheetId,
      });
      continue;
    }

    if (cellMap.has(cell.id)) {
      diagnostics.push({
        severity: 'error',
        code: 'ERR_DUPLICATE_CELL_ID',
        message: `Duplicate cell id "${cell.id}".`,
        targetId: cell.id,
        sheetId: cell.sheetId,
      });
    }
    cellMap.set(cell.id, cell);

    if (!sheetIdSet.has(cell.sheetId)) {
      diagnostics.push({
        severity: 'error',
        code: 'ERR_INVALID_CELL_SHEET',
        message: `Cell "${cell.id}" references non-existent sheetId "${cell.sheetId}".`,
        targetId: cell.id,
      });
    }

    if (cell.regionId && !regionIdSet.has(cell.regionId)) {
      diagnostics.push({
        severity: 'error',
        code: 'ERR_INVALID_CELL_REGION',
        message: `Cell "${cell.id}" references non-existent regionId "${cell.regionId}".`,
        targetId: cell.id,
      });
    }

    // 字段单元格必须具备合法的 fieldKey，并校验角色/操作/扩展/时间粒度枚举
    if (cell.content.kind === 'field') {
      const fc = cell.content as FieldCellContent;
      if (!fc.fieldKey || fc.fieldKey.trim() === '') {
        diagnostics.push({
          severity: 'error',
          code: 'ERR_FIELD_EMPTY_KEY',
          message: `Field cell "${cell.id}" has empty fieldKey.`,
          targetId: cell.id,
        });
      }
      if (fc.role && !VALID_ROLES.has(fc.role)) {
        diagnostics.push({
          severity: 'error',
          code: 'ERR_INVALID_ROLE',
          message: `Field cell "${cell.id}" has invalid role "${fc.role}".`,
          targetId: cell.id,
        });
      }
      if (fc.operation && !VALID_OPERATIONS.has(fc.operation)) {
        diagnostics.push({
          severity: 'error',
          code: 'ERR_INVALID_OPERATION',
          message: `Field cell "${cell.id}" has invalid operation "${fc.operation}".`,
          targetId: cell.id,
        });
      }
      if (fc.expand && !VALID_EXPANDS.has(fc.expand)) {
        diagnostics.push({
          severity: 'error',
          code: 'ERR_INVALID_EXPAND',
          message: `Field cell "${cell.id}" has invalid expand "${fc.expand}".`,
          targetId: cell.id,
        });
      }
      if (fc.timeBucket?.granularity && !VALID_GRANULARITIES.has(fc.timeBucket.granularity)) {
        diagnostics.push({
          severity: 'error',
          code: 'ERR_INVALID_GRANULARITY',
          message: `Field cell "${cell.id}" has invalid time granularity "${(fc.timeBucket.granularity as string)}".`,
          targetId: cell.id,
        });
      }
      if (fc.timeBucket?.granularity === 'custom' && (!Number.isInteger(fc.timeBucket.customIntervalDays) || (fc.timeBucket.customIntervalDays ?? 0) <= 0)) {
        diagnostics.push({ severity: 'error', code: 'ERR_INVALID_GRANULARITY', targetId: cell.id, message: '自定义时间间隔必须是正整数天数' });
      }
      if (doc.hybridConfig?.version === 2 && fc.fieldKey && availableFields?.length && !availableFields.includes(fc.fieldKey)) {
        diagnostics.push({ severity: 'error', code: 'ERR_HYBRID_FIELD_NOT_FOUND', targetId: cell.id, message: `配置字段不存在：${fc.fieldKey}` });
      }
      if (
        fc.fieldKey &&
        availableFields &&
        availableFields.length > 0 &&
        !availableFields.includes(fc.fieldKey)
      ) {
        diagnostics.push({
          severity: 'warning',
          code: 'WARN_FIELD_NOT_IN_DATASET',
          message: `Field cell "${cell.id}" references field "${fc.fieldKey}" not present in the dataset.`,
          targetId: cell.id,
        });
      }
    }

    // 业务公式单元格：表达式语法校验与引用字段存在性检查
    if (cell.content.kind === 'business-formula') {
      const bc = cell.content as any;
      if (!bc.expression || !bc.expression.trim()) {
        diagnostics.push({
          severity: 'error',
          code: 'ERR_FORMULA_EMPTY',
          message: `Business formula cell "${cell.id}" has empty expression.`,
          targetId: cell.id,
        });
      } else {
        try {
          const ast = parseFormula(bc.expression);
          if (availableFields && availableFields.length > 0) {
            for (const ref of extractReferencedFields(ast)) {
              const cleanRef = ref.replace(/^(?:SUM|AVG|MIN|MAX|COUNT)\s*\((.+)\)$/i, '$1').trim();
              if (!availableFields.includes(cleanRef) && !availableFields.includes(ref)) {
                diagnostics.push({
                  severity: 'warning',
                  code: 'WARN_FORMULA_FIELD_NOT_IN_DATASET',
                  message: `Business formula cell "${cell.id}" references field "${ref}" not present in the dataset.`,
                  targetId: cell.id,
                });
              }
            }
          }
        } catch (err: any) {
          diagnostics.push({
            severity: 'error',
            code: 'ERR_FORMULA_SYNTAX',
            message: `Business formula cell "${cell.id}" has invalid expression: ${err?.message || ''}`,
            targetId: cell.id,
          });
        }
      }
    }
  }

  // 指标身份唯一性校验（度量字段格与业务公式格共用 metricId 命名空间）
  const metricIdSet = new Set<string>();
  for (const [, cell] of cellMap.entries()) {
    let metricId: string | undefined;
    if (cell.content.kind === 'business-formula') {
      metricId = (cell.content as any).metricId;
    } else if (cell.content.kind === 'field' && (cell.content as FieldCellContent).role === 'measure') {
      metricId = (cell.content as FieldCellContent).metricId;
    }
    if (!metricId) continue;
    if (metricIdSet.has(metricId)) {
      diagnostics.push({
        severity: 'error',
        code: 'ERR_DUPLICATE_METRIC_ID',
        message: `Duplicate metricId "${metricId}" detected across measure cells.`,
        targetId: cell.id,
      });
    }
    metricIdSet.add(metricId);
  }

  // 依赖图环路与有效性检测
  for (const [cellId, cell] of cellMap.entries()) {
    const rowParentId = cell.parents?.row;
    const colParentId = cell.parents?.column;

    if (rowParentId && rowParentId !== 'default' && rowParentId !== 'none') {
      const parent = cellMap.get(rowParentId);
      if (!parent) {
        diagnostics.push({
          severity: 'error',
          code: 'ERR_MISSING_ROW_PARENT',
          message: `Cell "${cellId}" references non-existent row parent "${rowParentId}".`,
          targetId: cellId,
        });
      } else if (parent.regionId !== cell.regionId) {
        diagnostics.push({
          severity: 'error',
          code: 'ERR_CROSS_REGION_PARENT',
          message: `Cell "${cellId}" and row parent "${rowParentId}" belong to different regions.`,
          targetId: cellId,
        });
      }
    }

    if (colParentId && colParentId !== 'default' && colParentId !== 'none') {
      const parent = cellMap.get(colParentId);
      if (!parent) {
        diagnostics.push({
          severity: 'error',
          code: 'ERR_MISSING_COL_PARENT',
          message: `Cell "${cellId}" references non-existent column parent "${colParentId}".`,
          targetId: cellId,
        });
      } else if (parent.regionId !== cell.regionId) {
        diagnostics.push({
          severity: 'error',
          code: 'ERR_CROSS_REGION_PARENT',
          message: `Cell "${cellId}" and column parent "${colParentId}" belong to different regions.`,
          targetId: cellId,
        });
      }
    }
  }

  // 环路检测 (统一有向依赖图环路检测，涵盖行父格、列父格及混合依赖)
  const color = new Map<string, number>(); // 0: unvisited, 1: visiting, 2: visited

  function dfs(u: string, path: string[]) {
    color.set(u, 1);
    const cell = cellMap.get(u);
    const neighbors: string[] = [];
    if (cell?.parents?.row && cell.parents.row !== 'default' && cell.parents.row !== 'none') neighbors.push(cell.parents.row);
    if (cell?.parents?.column && cell.parents.column !== 'default' && cell.parents.column !== 'none') neighbors.push(cell.parents.column);

    for (const v of neighbors) {
      if (!cellMap.has(v)) continue;
      const c = color.get(v) || 0;
      if (c === 1) {
        diagnostics.push({
          severity: 'error',
          code: 'ERR_CYCLIC_PARENT_DEPENDENCY',
          message: `Cyclic parent dependency detected: ${[...path, u, v].join(' -> ')}.`,
          targetId: u,
        });
      } else if (c === 0) {
        dfs(v, [...path, u]);
      }
    }
    color.set(u, 2);
  }

  for (const cellId of cellMap.keys()) {
    if ((color.get(cellId) || 0) === 0) {
      dfs(cellId, []);
    }
  }

  // 区域类型契约检查
  const isCellDriven =
    doc.schemaVersion === '2.0' || doc.capabilitiesVersion === 'cell-expansion-v2';
  for (const region of doc.regions || []) {
    const regionCells = Array.from(cellMap.values()).filter((c) => c.regionId === region.id);

    if (region.layoutKind === 'pivot') {
      const hasRowDim = regionCells.some((c) => c.content.kind === 'field' && c.content.role === 'row-dimension');
      const hasColDim = regionCells.some((c) => c.content.kind === 'field' && c.content.role === 'column-dimension');
      const hasMeasure = regionCells.some((c) => (c.content.kind === 'field' && c.content.role === 'measure') || c.content.kind === 'business-formula');

      if (!hasRowDim && !hasColDim) {
        diagnostics.push({
          severity: 'warning',
          code: 'WARN_PIVOT_NO_DIMENSIONS',
          message: `Pivot region "${region.id}" should have at least row or column dimensions.`,
          targetId: region.id,
        });
      }
      if (!hasMeasure) {
        diagnostics.push({
          severity: 'warning',
          code: 'WARN_PIVOT_NO_MEASURES',
          message: `Pivot region "${region.id}" should have at least one measure.`,
          targetId: region.id,
        });
      }
    } else if (region.layoutKind === 'detail') {
      const hasDetail = regionCells.some((c) => c.content.kind === 'field' && c.content.role === 'detail-column');
      if (!hasDetail) {
        diagnostics.push({
          severity: 'warning',
          code: 'WARN_DETAIL_NO_COLUMNS',
          message: `Detail region "${region.id}" should have at least one detail column.`,
          targetId: region.id,
        });
      }
    } else if (isCellDriven) {
      // cell-expansion-v2 取消全局表型，改为校验区域至少存在一个数据驱动格（维度/度量/明细/公式）
      const hasDriver = regionCells.some(
        (c) => c.content.kind === 'field' || c.content.kind === 'business-formula'
      );
      if (!hasDriver) {
        diagnostics.push({
          severity: 'warning',
          code: 'WARN_REGION_NO_DATA_CELLS',
          message: `Cell-driven region "${region.id}" should have at least one data cell.`,
          targetId: region.id,
        });
      }
    }
  }

  // 动态合并规则校验 (template-dynamic-merge-design.md)
  if (doc.mergeConfig) {
    if (doc.mergeConfig.capability !== 'template-merge-v1') {
      diagnostics.push({
        severity: 'error',
        code: 'ERR_UNSUPPORTED_MERGE_CAPABILITY',
        message: `Unsupported merge capability "${(doc.mergeConfig as any).capability}". Expected "template-merge-v1".`,
      });
    }

    const policyIdSet = new Set<string>();
    for (const policy of doc.mergeConfig.policies || []) {
      if (!policy.id) {
        diagnostics.push({
          severity: 'error',
          code: 'ERR_POLICY_MISSING_ID',
          message: 'Merge policy is missing required id.',
        });
        continue;
      }
      if (policyIdSet.has(policy.id)) {
        diagnostics.push({
          severity: 'error',
          code: 'ERR_DUPLICATE_POLICY_ID',
          message: `Duplicate merge policy id "${policy.id}".`,
          targetId: policy.id,
        });
      }
      policyIdSet.add(policy.id);

      if (!sheetIdSet.has(policy.sheetId)) {
        diagnostics.push({
          severity: 'error',
          code: 'ERR_POLICY_INVALID_SHEET',
          message: `Merge policy "${policy.id}" references non-existent sheetId "${policy.sheetId}".`,
          targetId: policy.id,
        });
      }

      if (!regionIdSet.has(policy.regionId)) {
        diagnostics.push({
          severity: 'error',
          code: 'ERR_POLICY_INVALID_REGION',
          message: `Merge policy "${policy.id}" references non-existent regionId "${policy.regionId}".`,
          targetId: policy.id,
        });
      }

      if (policy.target && policy.target.kind === 'template-cell') {
        const targetCell = cellMap.get(policy.target.templateCellId);
        if (!targetCell) {
          diagnostics.push({
            severity: 'error',
            code: 'ERR_POLICY_TARGET_CELL_NOT_FOUND',
            message: `Merge policy "${policy.id}" references non-existent templateCellId "${policy.target.templateCellId}".`,
            targetId: policy.id,
          });
        }
      }
    }

    for (const suppression of doc.mergeConfig.suppressions || []) {
      if (!policyIdSet.has(suppression.policyId)) {
        diagnostics.push({
          severity: 'warning',
          code: 'WARN_SUPPRESSION_ORPHANED_POLICY',
          message: `Suppression "${suppression.id}" references unknown policyId "${suppression.policyId}".`,
          targetId: suppression.id,
        });
      }
    }
  }

  const valid = diagnostics.every((d) => d.severity !== 'error');
  return { valid, diagnostics };
}
