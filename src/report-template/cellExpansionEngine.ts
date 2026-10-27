/**
 * 单元格驱动展开引擎 (cellExpansionEngine.ts)
 * 纯函数实现，无 Univer / DOM / UI 依赖。
 * 落实 micro-bi/doc/cell-driven-expansion-engine-design.md 规范：
 * 1. 取消全局 layoutKind 与 metricDirection，由模板格位置、数据行为、扩展方向、父格与局部块共同决定
 * 2. 数据上下文图求值：列表对齐、嵌套分组与正交交叉求值
 * 3. 几何布局测量：依据局部原型尺寸、跨度与车道对齐展开
 * 4. 真实 Footprint 驱动动态合并 (group-span & adjacent-equal)
 * 5. 纯函数、无副作用，输出中性 BiGridModel 与实例映射
 */
import type { DataRecord } from '../engine/types.js';
import type {
  BiGridModel,
  BiGridCell,
  ReportCellMerge,
  ReportBinding,
  PublishedCellStyle,
  AxisMemberRef,
} from '../report/types.js';
import { createReportBinding } from '../report/bindings.js';
import { evaluateFormula } from '../engine/formula/evaluator.js';
import { roundTo } from '../engine/summary.js';
import { formatTimeBucket } from '../engine/bucketing.js';
import type {
  CellTemplateDocumentV1,
  CellDefinition,
  FieldCellContent,
  BusinessFormulaCellContent,
  LiteralCellContent,
  TemplateDiagnostic,
  CellStyleDefinition,
  CellFormatOptions,
} from './types.js';
import {
  buildInstanceKey,
  parseInstanceKey,
  encodeMemberValue,
  decodeMemberValue,
  encodeMemberTuple,
  decodeMemberTuple,
  buildGroupContextKey,
} from './identity.js';
import { resolveTemplateMerges, isRangeOverlapping } from './mergeResolver.js';
import { applyRegionFilters } from './regionFilter.js';
import { evaluateArithmetic } from './arithmeticEval.js';
import { evaluateSheetFormula as evaluateSheetFormulaEngine } from './sheetFormulaEvaluator.js';
import { applyPresentationRules } from './presentationRules.js';
import { activeStaticSpans, applyStaticSpans, prepareStaticSpanTemplate, type SpanDriverInstance } from './staticSpans.js';

export interface CellExpansionResult {
  grid: BiGridModel;
  recordCount: number;
  filteredCount: number;
  diagnostics: TemplateDiagnostic[];
  footprints: Map<string, ReportCellMerge>;
}

// ---------------------------------------------------------------------------
// 辅助样式转换
// ---------------------------------------------------------------------------
function toPublishedStyle(style?: CellStyleDefinition): PublishedCellStyle {
  if (!style) return {};
  const res: PublishedCellStyle = {};
  if (style.fontFamily !== undefined) res.fontFamily = style.fontFamily;
  if (style.fontSize !== undefined) res.fontSize = style.fontSize;
  if (style.bold !== undefined) res.bold = style.bold;
  if (style.italic !== undefined) res.italic = style.italic;
  if (style.color !== undefined) res.color = style.color;
  if (style.backgroundColor !== undefined) res.bgColor = style.backgroundColor;
  if (style.textAlign !== undefined) res.align = style.textAlign;
  if (style.verticalAlign !== undefined) res.verticalAlign = style.verticalAlign;
  if (style.wrapText !== undefined) res.wrapText = style.wrapText;
  if ((style as any)?.format !== undefined) res.format = (style as any).format;
  return res;
}

function mergePublishedStyles(base?: PublishedCellStyle, incoming?: PublishedCellStyle): PublishedCellStyle | undefined {
  if (!base && !incoming) return undefined;
  if (!base) return incoming;
  if (!incoming) return base;
  return { ...base, ...incoming };
}

export function resolveCellFormatOptions(cell: CellDefinition): CellFormatOptions {
  const content = cell.content as any;
  const rawOpts: CellFormatOptions = content?.formatOptions || (cell as any).formatOptions || {};
  return {
    format: rawOpts.format || content?.format || (cell.style as any)?.format,
    precision: rawOpts.precision !== undefined ? rawOpts.precision : content?.precision,
    useGrouping: rawOpts.useGrouping !== undefined ? rawOpts.useGrouping : content?.useGrouping,
    scale: rawOpts.scale !== undefined ? rawOpts.scale : content?.scale,
    prefix: rawOpts.prefix !== undefined ? rawOpts.prefix : content?.prefix,
    suffix: rawOpts.suffix !== undefined ? rawOpts.suffix : content?.suffix,
    negativeFormat: rawOpts.negativeFormat || content?.negativeFormat,
    emptyDisplay: rawOpts.emptyDisplay !== undefined ? rawOpts.emptyDisplay : content?.emptyDisplay,
    zeroDisplay: rawOpts.zeroDisplay || content?.zeroDisplay,
    dateFormat: rawOpts.dateFormat || content?.dateFormat,
    tooltip: rawOpts.tooltip || content?.tooltip || (cell as any).tooltip,
  };
}

function formatValue(value: any, format?: string, options?: CellFormatOptions): string {
  // 1. 空值容错处理
  if (value === null || value === undefined || value === '') {
    return options?.emptyDisplay !== undefined ? options.emptyDisplay : '';
  }

  // 2. 零值显示处理
  if (value === 0 || value === '0') {
    if (options?.zeroDisplay === 'blank') return '';
    if (options?.zeroDisplay === 'dash') return '-';
  }

  // 3. 日期时间格式化
  if (options?.dateFormat && (typeof value === 'string' || value instanceof Date || (typeof value === 'number' && value > 1000000000))) {
    try {
      const d = value instanceof Date ? value : new Date(value);
      if (!isNaN(d.getTime())) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');

        let df = options.dateFormat;
        df = df.replace(/YYYY/g, String(year));
        df = df.replace(/MM/g, month);
        df = df.replace(/DD/g, day);
        df = df.replace(/HH/g, hours);
        df = df.replace(/mm/g, minutes);
        df = df.replace(/ss/g, seconds);
        return df;
      }
    } catch {}
  }

  // 4. 数值类型格式化
  if (typeof value === 'number' || (!isNaN(Number(value)) && typeof value === 'string' && value.trim() !== '')) {
    const rawNum = typeof value === 'number' ? value : Number(value);

    // 量级缩放 (例如除以 10000 转换为万元)
    let num = options?.scale && options.scale > 0 ? rawNum / options.scale : rawNum;

    const isPct = format === 'percent' || format === 'percentage';
    if (isPct) {
      num = num * 100;
    }

    // 小数位数精度
    let prec: number | undefined = undefined;
    if (options?.precision !== undefined) {
      prec = Math.max(0, Math.min(6, options.precision));
    } else if (format === 'integer') {
      prec = 0;
    } else if (format === 'number' || format === 'decimal2' || format === 'currency' || isPct) {
      prec = 2;
    }

    const useGrouping =
      options?.useGrouping !== false &&
      (options?.useGrouping !== undefined ||
        format === 'number' ||
        format === 'integer' ||
        format === 'currency');

    // 前缀与后缀
    const prefix = options?.prefix ?? (format === 'currency' ? '¥' : '');
    const suffix = options?.suffix ?? (isPct ? '%' : '');

    // 负数处理
    const isNegative = num < 0;
    const absNum = Math.abs(num);

    let absStr: string;
    if (prec !== undefined) {
      absStr = absNum.toLocaleString('en-US', {
        minimumFractionDigits: prec,
        maximumFractionDigits: prec,
        useGrouping,
      });
    } else if (useGrouping && absNum >= 1000) {
      absStr = absNum.toLocaleString('en-US', {
        maximumFractionDigits: 6,
        useGrouping: true,
      });
    } else {
      absStr = String(absNum);
    }

    if (isNegative) {
      const negFmt = options?.negativeFormat || 'minus';
      if (negFmt === 'bracket' || negFmt === 'red_bracket') {
        return `(${prefix}${absStr}${suffix})`;
      }
      return `-${prefix}${absStr}${suffix}`;
    }

    return `${prefix}${absStr}${suffix}`;
  }

  return String(value);
}

// ---------------------------------------------------------------------------
// 自然文本与字母数字排序比较函数 (CE-T12, 解决数字10排在2前及月份错乱问题)
// ---------------------------------------------------------------------------
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// ---------------------------------------------------------------------------
// 将 Excel 风格列标 (如 A, B, Z, AA) 转换为 0-based 列索引
// ---------------------------------------------------------------------------
function colLetterToIndex(colStr: string): number {
  let index = 0;
  for (let i = 0; i < colStr.length; i++) {
    index = index * 26 + (colStr.charCodeAt(i) - 64);
  }
  return index - 1;
}

// ---------------------------------------------------------------------------
// 评估包含单元格坐标引用 (如 A1, B2) 或范围/聚合函数 (如 MAX(B2,C2), SUM(A1:A5)) 的 sheet-formula
// ---------------------------------------------------------------------------
function evaluateSheetFormula(
  formula: string,
  cellsMap: Map<string, BiGridCell>,
  currentR: number,
  currentC: number
): { value: any; error?: string } {
  const cellAccessor = (r: number, c: number) => {
    if (r === currentR && c === currentC) return null;
    const cell = cellsMap.get(`${r}:${c}`);
    if (cell && cell.value !== null && cell.value !== undefined) {
      return cell.value;
    }
    return null;
  };
  return evaluateSheetFormulaEngine(formula, cellAccessor, currentR, currentC);
}

// ---------------------------------------------------------------------------
// 树型展开节点结构
// ---------------------------------------------------------------------------
interface ExpansionNode {
  memberKey: string;
  memberValue: any;
  displayText: string;
  records: readonly DataRecord[];
  path: { field: string; memberKey: string; memberValue?: any }[];
  children: ExpansionNode[];
  // 测量与结果几何
  startCoord: number;
  span: number;
}

// ---------------------------------------------------------------------------
// 单元格驱动引擎主入口
// ---------------------------------------------------------------------------
export function expandCellDrivenTemplate(
  doc: CellTemplateDocumentV1,
  rawDataset: readonly DataRecord[],
  options: { sheetId?: string } = {}
): CellExpansionResult {
  const sourceDocument = doc;
  doc = prepareStaticSpanTemplate(doc);
  const diagnostics: TemplateDiagnostic[] = [];
  const sheetId = options.sheetId || doc.sheets?.[0]?.id || 'sheet-1';

  // 1. 过滤当前工作表的单元格
  // 默认父格决议只修改本次执行计划；不得把 'none' 写回 null 污染下一轮预览/保存。
  const docCells = (doc.cells || []).filter((c) => c.sheetId === sheetId).map((c) => ({
    ...c,
    parents: c.parents ? { ...c.parents } : { row: null, column: null },
  }));
  const cellMap = new Map<string, CellDefinition>(docCells.map((c) => [c.id, c]));

  // 2. 检查父格依赖环路 (CE-T16)
  const color = new Map<string, number>(); // 0: unvisited, 1: visiting, 2: visited
  function checkCycles(u: string, path: string[]) {
    color.set(u, 1);
    const cell = cellMap.get(u);
    const neighbors: string[] = [];
    if (cell?.parents?.row) neighbors.push(cell.parents.row);
    if (cell?.parents?.column) neighbors.push(cell.parents.column);

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
        checkCycles(v, [...path, u]);
      }
    }
    color.set(u, 2);
  }
  for (const cellId of cellMap.keys()) {
    if ((color.get(cellId) || 0) === 0) {
      checkCycles(cellId, []);
    }
  }

  // 3. 区域过滤数据集 (CER-14)
  const regionRecordCache = new Map<string, readonly DataRecord[]>();
  function getRecordsForRegion(regionId?: string): readonly DataRecord[] {
    const key = regionId || '__DEFAULT__';
    if (regionRecordCache.has(key)) return regionRecordCache.get(key)!;

    const targetRegion = regionId
      ? doc.regions?.find((r) => r.id === regionId)
      : doc.regions?.[0];

    if (!targetRegion?.filters || targetRegion.filters.length === 0) {
      regionRecordCache.set(key, rawDataset);
      return rawDataset;
    }

    // 统一过滤语义：与 expandTemplate (v1) 共享同一实现，消除两套引擎行为不一致
    const res = applyRegionFilters(rawDataset, targetRegion.filters);
    regionRecordCache.set(key, res);
    return res;
  }

  const primaryRegion = doc.regions?.[0];
  const filteredRecords = getRecordsForRegion(primaryRegion?.id);

  // 3.1 自动解析“默认”父格（遵循帆软/Excel报表模型：默认左父格跟随左侧最近行维度，默认上父格跟随上方最近列维度）
  const candidateRowDrivers = docCells.filter(
    (c) =>
      c.content.kind === 'field' &&
      ((c.content as FieldCellContent).role === 'row-dimension' ||
        (c.content as FieldCellContent).expand === 'down')
  );
  const candidateColDrivers = docCells.filter(
    (c) =>
      c.content.kind === 'field' &&
      ((c.content as FieldCellContent).role === 'column-dimension' ||
        (c.content as FieldCellContent).expand === 'right')
  );

  // 辅助函数：判断未显式指定父格的文本或公式单元格是否处于行维度原型的上下文区域内 (CER-14, 增加严格的同 region 约束)
  function isCellInRowDriverScope(
    cell: CellDefinition,
    candidates: CellDefinition[],
    allDocCells: CellDefinition[]
  ): boolean {
    const leftDrivers = candidates.filter(
      (rd) =>
        rd.id !== cell.id &&
        rd.sheetId === cell.sheetId &&
        (!cell.regionId || !rd.regionId || cell.regionId === rd.regionId) &&
        rd.position.column < cell.position.column &&
        rd.position.row <= cell.position.row
    );
    if (leftDrivers.length === 0) return false;

    // 1. 同一行中存在度量/计算格 (同区域)
    const hasSiblingInSameRow = allDocCells.some(
      (c) =>
        c.id !== cell.id &&
        c.sheetId === cell.sheetId &&
        (!cell.regionId || !c.regionId || cell.regionId === c.regionId) &&
        c.position.row === cell.position.row &&
        (c.parents?.row === 'default' ||
          leftDrivers.some((d) => d.id === c.parents?.row) ||
          c.content.kind === 'business-formula' ||
          (c.content.kind === 'field' && (c.content as FieldCellContent).role === 'measure'))
    );
    if (hasSiblingInSameRow) return true;

    // 2. 同一列中存在已经绑定该行驱动的指标标签格 (如上一行的"交付件数"标签，同区域)
    const hasMetricLabelAbove = allDocCells.some(
      (c) =>
        c.id !== cell.id &&
        c.sheetId === cell.sheetId &&
        (!cell.regionId || !c.regionId || cell.regionId === c.regionId) &&
        c.position.column === cell.position.column &&
        c.position.row < cell.position.row &&
        (c.parents?.row === 'default' || leftDrivers.some((d) => d.id === c.parents?.row))
    );
    if (hasMetricLabelAbove) return true;

    return false;
  }

  // 辅助函数：判断未显式指定父格的单元格是否处于列维度原型的上下文区域内 (CER-14, 增加严格的同 region 约束)
  function isCellInColDriverScope(
    cell: CellDefinition,
    candidates: CellDefinition[],
    allDocCells: CellDefinition[]
  ): boolean {
    const aboveDrivers = candidates.filter(
      (cd) =>
        cd.id !== cell.id &&
        cd.sheetId === cell.sheetId &&
        (!cell.regionId || !cd.regionId || cell.regionId === cd.regionId) &&
        cd.position.row < cell.position.row &&
        cd.position.column <= cell.position.column
    );
    if (aboveDrivers.length === 0) return false;

    const hasSiblingInSameCol = allDocCells.some(
      (c) =>
        c.id !== cell.id &&
        c.sheetId === cell.sheetId &&
        (!cell.regionId || !c.regionId || cell.regionId === c.regionId) &&
        c.position.column === cell.position.column &&
        (c.parents?.column === 'default' ||
          aboveDrivers.some((d) => d.id === c.parents?.column) ||
          c.content.kind === 'business-formula' ||
          (c.content.kind === 'field' && (c.content as FieldCellContent).role === 'measure'))
    );
    if (hasSiblingInSameCol) return true;

    const hasMetricLabelLeft = allDocCells.some(
      (c) =>
        c.id !== cell.id &&
        c.sheetId === cell.sheetId &&
        (!cell.regionId || !c.regionId || cell.regionId === c.regionId) &&
        c.position.row === cell.position.row &&
        c.position.column < cell.position.column &&
        (c.parents?.column === 'default' || aboveDrivers.some((d) => d.id === c.parents?.column))
    );
    if (hasMetricLabelLeft) return true;

    return false;
  }

  for (const cell of docCells) {
    if (!cell.parents) {
      cell.parents = { row: null, column: null };
    }

    // 1. 规范化显式“无父格”
    const isExplicitNoneRow = cell.parents.row === 'none';
    const isExplicitNoneCol = cell.parents.column === 'none';
    if (isExplicitNoneRow) {
      cell.parents.row = null;
    }
    if (isExplicitNoneCol) {
      cell.parents.column = null;
    }

    const isFieldOrFormula = cell.content.kind === 'field' || cell.content.kind === 'business-formula';
    const fieldContent = isFieldOrFormula && cell.content.kind === 'field' ? (cell.content as FieldCellContent) : null;

    // 2. 决议左父格 (Row Parent)
    // 只要非独立列维度、非显式声明 'none'，且（显式声明 'default' 或位于行维度原型区域内）时决议左父格
    const isColumnDriver = fieldContent && (fieldContent.role === 'column-dimension' || fieldContent.expand === 'right');
    const inRowDriverScope = !cell.parents.row && isCellInRowDriverScope(cell, candidateRowDrivers, docCells);
    const shouldResolveRow = !isColumnDriver && !isExplicitNoneRow && (cell.parents.row === 'default' || inRowDriverScope);

    if (shouldResolveRow) {
      const leftDrivers = candidateRowDrivers.filter(
        (rd) =>
          rd.id !== cell.id &&
          rd.sheetId === cell.sheetId &&
          (!cell.regionId || !rd.regionId || cell.regionId === rd.regionId) &&
          rd.position.column < cell.position.column &&
          rd.position.row <= cell.position.row
      );
      if (leftDrivers.length > 0) {
        leftDrivers.sort((a, b) => {
          if (b.position.column !== a.position.column) {
            return b.position.column - a.position.column; // 最靠左侧最近
          }
          return Math.abs(a.position.row - cell.position.row) - Math.abs(b.position.row - cell.position.row);
        });
        const bestLeft = leftDrivers[0];
        cell.parents.row = bestLeft ? bestLeft.id : null;
      } else {
        cell.parents.row = null;
      }
    } else if (cell.parents.row === 'default') {
      cell.parents.row = null;
    }

    // 3. 决议上父格 (Column Parent)
    // 只要非独立行维度、非显式声明 'none'，且（显式声明 'default' 或位于列维度原型区域内）时决议上父格
    const isRowDriver = fieldContent && (fieldContent.role === 'row-dimension' || fieldContent.expand === 'down');
    const inColDriverScope = !cell.parents.column && isCellInColDriverScope(cell, candidateColDrivers, docCells);
    const shouldResolveCol = !isRowDriver && !isExplicitNoneCol && (cell.parents.column === 'default' || inColDriverScope);

    if (shouldResolveCol) {
      const aboveDrivers = candidateColDrivers.filter(
        (cd) =>
          cd.id !== cell.id &&
          cd.sheetId === cell.sheetId &&
          (!cell.regionId || !cd.regionId || cell.regionId === cd.regionId) &&
          cd.position.row < cell.position.row &&
          cd.position.column <= cell.position.column
      );
      if (aboveDrivers.length > 0) {
        aboveDrivers.sort((a, b) => {
          if (b.position.row !== a.position.row) {
            return b.position.row - a.position.row; // 最靠上方最近
          }
          return Math.abs(a.position.column - cell.position.column) - Math.abs(b.position.column - cell.position.column);
        });
        const bestCol = aboveDrivers[0];
        cell.parents.column = bestCol ? bestCol.id : null;
      } else {
        cell.parents.column = null;
      }
    } else if (cell.parents.column === 'default') {
      cell.parents.column = null;
    }
  }

  // 4. 分析驱动格 (Drivers) 与 静态格 (Static Cells)
  const rowDrivers: CellDefinition[] = [];
  const colDrivers: CellDefinition[] = [];
  const dataCells: CellDefinition[] = [];
  const staticCells: CellDefinition[] = [];

  for (const cell of docCells) {
    const isField = cell.content.kind === 'field';
    const isFormula = cell.content.kind === 'business-formula' || cell.content.kind === 'sheet-formula';

    if (isField) {
      const fc = cell.content as FieldCellContent;
      const rowParent = cell.parents?.row ? cellMap.get(cell.parents.row) : null;
      const colParent = cell.parents?.column ? cellMap.get(cell.parents.column) : null;

      const isRowParentList = rowParent?.content.kind === 'field' && (rowParent.content as FieldCellContent).operation === 'list';
      const isColParentList = colParent?.content.kind === 'field' && (colParent.content as FieldCellContent).operation === 'list';

      if (fc.expand === 'down' && fc.operation === 'group') {
        rowDrivers.push(cell);
      } else if (fc.expand === 'down' && fc.operation === 'list' && !isRowParentList) {
        rowDrivers.push(cell);
      } else if (fc.expand === 'right' && fc.operation === 'group') {
        colDrivers.push(cell);
      } else if (fc.expand === 'right' && fc.operation === 'list' && !isColParentList) {
        colDrivers.push(cell);
      } else {
        dataCells.push(cell);
      }
    } else if (isFormula) {
      dataCells.push(cell);
    } else {
      const hasParent = Boolean(
        (cell.parents?.row && cellMap.has(cell.parents.row)) ||
        (cell.parents?.column && cellMap.has(cell.parents.column))
      );
      if (hasParent) {
        dataCells.push(cell);
      } else {
        staticCells.push(cell);
      }
    }
  }

  // 4.1 划分根行驱动与子行驱动
  const rootRowDrivers = rowDrivers.filter(
    (d) => !d.parents?.row || !cellMap.has(d.parents.row)
  );
  // 4.2 划分根列驱动与子列驱动
  const rootColDrivers = colDrivers.filter(
    (d) => !d.parents?.column || !cellMap.has(d.parents.column)
  );

  // 4.3 测量局部原型尺寸 (Proto Height & Width)
  // 行驱动的局部原型高度：所有以其为行父格（或就是它自身）的单元格在模板中占用的行跨度
  const rowProtoHeights = new Map<string, number>();
  for (const rd of rowDrivers) {
    const deps = docCells.filter((c) => c.id === rd.id || c.parents?.row === rd.id);
    const minR = Math.min(...deps.map((c) => c.position.row));
    const maxR = Math.max(...deps.map((c) => c.position.row));
    rowProtoHeights.set(rd.id, Math.max(1, maxR - minR + 1));
  }

  // 列驱动的局部原型宽度：所有以其为列父格（或就是它自身）的单元格在模板中占用的列跨度
  const colProtoWidths = new Map<string, number>();
  for (const cd of colDrivers) {
    const deps = docCells.filter((c) => c.id === cd.id || c.parents?.column === cd.id);
    const minC = Math.min(...deps.map((c) => c.position.column));
    const maxC = Math.max(...deps.map((c) => c.position.column));
    colProtoWidths.set(cd.id, Math.max(1, maxC - minC + 1));
  }

  // 5. 递归构建行扩展树 (Row Expansion Tree)
  function buildRowNodes(
    driver: CellDefinition,
    records: readonly DataRecord[],
    parentPath: { field: string; memberKey: string }[]
  ): ExpansionNode[] {
    const fc = driver.content as FieldCellContent;
    const fieldKey = fc.fieldKey;
    const protoH = rowProtoHeights.get(driver.id) || 1;

    // 查找挂在当前行驱动下的子行驱动 (嵌套分组)
    const childDrivers = rowDrivers.filter((d) => d.parents?.row === driver.id && d.id !== driver.id);

    if (fc.operation === 'list') {
      // 检查明细主键重复性与缺失 (CER-10)
      const seenPKs = new Set<string>();
      let warnedNoPk = false;
      for (const rec of records) {
        const pk = rec.id ?? rec._id ?? rec.key;
        if (pk !== undefined && pk !== null) {
          const pkStr = encodeMemberValue(pk);
          if (seenPKs.has(pkStr)) {
            diagnostics.push({
              severity: 'error',
              code: 'ERR_DETAIL_DUPLICATE_PRIMARY_KEY',
              message: `Duplicate record primary key "${pkStr}" detected in list/detail records.`,
              targetId: driver.id,
            });
          }
          seenPKs.add(pkStr);
        } else if (!warnedNoPk) {
          warnedNoPk = true;
          diagnostics.push({
            severity: 'warning',
            code: 'WARN_DETAIL_NO_PRIMARY_KEY',
            message:
              'List/detail records lack a primary key (id/_id/key); identity falls back to field value and is read-only.',
            targetId: driver.id,
          });
        }
      }

      // 明细列表：按记录逐条展开 (CE-T02, CER-09)。
      // 无主键时退回字段值，并在值重复时追加序号，避免静默身份碰撞导致实例覆盖错位。
      const seenVal = new Map<string, number>();
      return records.map((rec, idx) => {
        const rawVal = rec[fieldKey];
        const pk = rec.id ?? rec._id ?? rec.key;
        let memberKey: string;
        if (pk !== undefined && pk !== null) {
          memberKey = encodeMemberValue(pk);
        } else {
          const base = encodeMemberValue(rawVal);
          const c = (seenVal.get(base) || 0) + 1;
          seenVal.set(base, c);
          memberKey = c === 1 ? base : `${base}#${c}`;
        }
        const currentPath = [...parentPath, { field: fieldKey, memberKey, memberValue: rawVal, recordId: pk }];
        return {
          memberKey,
          memberValue: rawVal,
          displayText: rawVal === null || rawVal === undefined ? '' : String(rawVal),
          records: [rec],
          path: currentPath,
          children: [],
          startCoord: 0,
          span: protoH,
        };
      });
    }

    // 分组展开：提取唯一种类并排序 (支持 timeBucket, CER-08)
    const groupsMap = new Map<string, { value: any; recs: DataRecord[] }>();
    for (const rec of records) {
      let rawVal = rec[fieldKey];
      if (fc.timeBucket) {
        rawVal = formatTimeBucket(rawVal, {
          field: fieldKey,
          granularity: fc.timeBucket.granularity as any,
          customIntervalDays: fc.timeBucket.customIntervalDays,
          timezone: fc.timeBucket.timezone,
          weekStartsOn: fc.timeBucket.weekStartsOn,
          format: fc.timeBucket.format,
        } as any);
      }
      const encoded = encodeMemberValue(rawVal);
      let g = groupsMap.get(encoded);
      if (!g) {
        g = { value: rawVal, recs: [] };
        groupsMap.set(encoded, g);
      }
      g.recs.push(rec);
    }

    // CE-T12: 确定性业务键自然排序 (支持自然数字序与字母混合排序)
    const sortedEntries = Array.from(groupsMap.entries()).sort(([a], [b]) => naturalCompare(a, b));
    const nodes: ExpansionNode[] = [];
    for (const [memberKey, g] of sortedEntries) {
      const currentPath = [...parentPath, { field: fieldKey, memberKey, memberValue: g.value }];
      let children: ExpansionNode[] = [];

      if (childDrivers.length > 0) {
        // 多级嵌套分组 (CE-T03)
        for (const childDriver of childDrivers) {
          const childNodes = buildRowNodes(childDriver, g.recs, currentPath);
          children.push(...childNodes);
        }
      }

      // 计算本成员实例的实际跨度高度
      let span = protoH;
      if (children.length > 0) {
        span = children.reduce((sum, ch) => sum + ch.span, 0);
      }

      nodes.push({
        memberKey,
        memberValue: g.value,
        displayText: g.value === null || g.value === undefined ? '' : String(g.value),
        records: g.recs,
        path: currentPath,
        children,
        startCoord: 0,
        span,
      });
    }

    return nodes;
  }

  // 6. 递归构建列扩展树 (Column Expansion Tree)
  function buildColNodes(
    driver: CellDefinition,
    records: readonly DataRecord[],
    parentPath: { field: string; memberKey: string }[]
  ): ExpansionNode[] {
    const fc = driver.content as FieldCellContent;
    const fieldKey = fc.fieldKey;
    const protoW = colProtoWidths.get(driver.id) || 1;

    const childDrivers = colDrivers.filter((d) => d.parents?.column === driver.id && d.id !== driver.id);

    if (fc.operation === 'list') {
      const seenPKs = new Set<string>();
      let warnedNoPk = false;
      for (const rec of records) {
        const pk = rec.id ?? rec._id ?? rec.key;
        if (pk !== undefined && pk !== null) {
          const pkStr = encodeMemberValue(pk);
          if (seenPKs.has(pkStr)) {
            diagnostics.push({
              severity: 'error',
              code: 'ERR_DETAIL_DUPLICATE_PRIMARY_KEY',
              message: `Duplicate record primary key "${pkStr}" detected in list/detail records.`,
              targetId: driver.id,
            });
          }
          seenPKs.add(pkStr);
        } else if (!warnedNoPk) {
          warnedNoPk = true;
          diagnostics.push({
            severity: 'warning',
            code: 'WARN_DETAIL_NO_PRIMARY_KEY',
            message:
              'List/detail records lack a primary key (id/_id/key); identity falls back to field value and is read-only.',
            targetId: driver.id,
          });
        }
      }

      const seenVal = new Map<string, number>();
      return records.map((rec) => {
        const rawVal = rec[fieldKey];
        const pk = rec.id ?? rec._id ?? rec.key;
        let memberKey: string;
        if (pk !== undefined && pk !== null) {
          memberKey = encodeMemberValue(pk);
        } else {
          const base = encodeMemberValue(rawVal);
          const c = (seenVal.get(base) || 0) + 1;
          seenVal.set(base, c);
          memberKey = c === 1 ? base : `${base}#${c}`;
        }
        const currentPath = [...parentPath, { field: fieldKey, memberKey, memberValue: rawVal, recordId: pk }];
        return {
          memberKey,
          memberValue: rawVal,
          displayText: rawVal === null || rawVal === undefined ? '' : String(rawVal),
          records: [rec],
          path: currentPath,
          children: [],
          startCoord: 0,
          span: protoW,
        };
      });
    }

    const groupsMap = new Map<string, { value: any; recs: DataRecord[] }>();
    for (const rec of records) {
      let rawVal = rec[fieldKey];
      if (fc.timeBucket) {
        rawVal = formatTimeBucket(rawVal, {
          field: fieldKey,
          granularity: fc.timeBucket.granularity as any,
          customIntervalDays: fc.timeBucket.customIntervalDays,
          timezone: fc.timeBucket.timezone,
          weekStartsOn: fc.timeBucket.weekStartsOn,
          format: fc.timeBucket.format,
        } as any);
      }
      const encoded = encodeMemberValue(rawVal);
      let g = groupsMap.get(encoded);
      if (!g) {
        g = { value: rawVal, recs: [] };
        groupsMap.set(encoded, g);
      }
      g.recs.push(rec);
    }

    // CE-T12: 确定性业务键自然排序 (支持自然数字序与字母混合排序)
    const sortedEntries = Array.from(groupsMap.entries()).sort(([a], [b]) => naturalCompare(a, b));
    const nodes: ExpansionNode[] = [];
    for (const [memberKey, g] of sortedEntries) {
      const currentPath = [...parentPath, { field: fieldKey, memberKey, memberValue: g.value }];
      let children: ExpansionNode[] = [];

      if (childDrivers.length > 0) {
        for (const childDriver of childDrivers) {
          const childNodes = buildColNodes(childDriver, g.recs, currentPath);
          children.push(...childNodes);
        }
      }

      let span = protoW;
      if (children.length > 0) {
        span = children.reduce((sum, ch) => sum + ch.span, 0);
      }

      nodes.push({
        memberKey,
        memberValue: g.value,
        displayText: g.value === null || g.value === undefined ? '' : String(g.value),
        records: g.recs,
        path: currentPath,
        children,
        startCoord: 0,
        span,
      });
    }

    return nodes;
  }

  // 7. 测量并排定起始物理坐标 (Layout Coordinate Assignment)
  // 如果没有行驱动，则默认有 1 个单行上下文
  let expandedRowTrees: { driver: CellDefinition; nodes: ExpansionNode[]; startRow: number }[] = [];

  if (rootRowDrivers.length > 0) {
    const occupiedColRanges: { startCol: number; endCol: number; endRow: number }[] = [];
    for (const rd of rootRowDrivers) {
      const rdRecords = getRecordsForRegion(rd.regionId);
      const nodes = buildRowNodes(rd, rdRecords, []);
      const protoW = colProtoWidths.get(rd.id) || 1;
      const startCol = rd.position.column;
      const endCol = startCol + protoW - 1;

      // 检查之前放置的根驱动在列跨度上是否与当前根驱动重叠 (CER-13)
      const overlapping = occupiedColRanges.filter(
        (ocr) => Math.max(startCol, ocr.startCol) <= Math.min(endCol, ocr.endCol)
      );
      let startRow = rd.position.row;
      if (overlapping.length > 0) {
        startRow = Math.max(startRow, ...overlapping.map((o) => o.endRow));
      }

      let cursor = startRow;
      function assignRowCoords(list: ExpansionNode[]) {
        for (const n of list) {
          n.startCoord = cursor;
          if (n.children.length > 0) {
            assignRowCoords(n.children);
          } else {
            cursor += n.span;
          }
        }
      }
      assignRowCoords(nodes);
      expandedRowTrees.push({ driver: rd, nodes, startRow });
      occupiedColRanges.push({ startCol, endCol, endRow: cursor });
    }
  }

  let expandedColTrees: { driver: CellDefinition; nodes: ExpansionNode[]; startCol: number }[] = [];

  if (rootColDrivers.length > 0) {
    const occupiedRowRanges: { startRow: number; endRow: number; endCol: number }[] = [];
    for (const cd of rootColDrivers) {
      const cdRecords = getRecordsForRegion(cd.regionId);
      const nodes = buildColNodes(cd, cdRecords, []);
      const protoH = rowProtoHeights.get(cd.id) || 1;
      const startRow = cd.position.row;
      const endRow = startRow + protoH - 1;

      const overlapping = occupiedRowRanges.filter(
        (orr) => Math.max(startRow, orr.startRow) <= Math.min(endRow, orr.endRow)
      );
      let startCol = cd.position.column;
      if (overlapping.length > 0) {
        startCol = Math.max(startCol, ...overlapping.map((o) => o.endCol));
      }

      let cursor = startCol;
      function assignColCoords(list: ExpansionNode[]) {
        for (const n of list) {
          n.startCoord = cursor;
          if (n.children.length > 0) {
            assignColCoords(n.children);
          } else {
            cursor += n.span;
          }
        }
      }
      assignColCoords(nodes);
      expandedColTrees.push({ driver: cd, nodes, startCol });
      occupiedRowRanges.push({ startRow, endRow, endCol: cursor });
    }
  }

  // 7.1 计算每个扩展区域产生的行列推移向量 (Displacement Vectors)
  interface DisplacementZone {
    regionId?: string | undefined;
    startRow: number;
    endRow: number;
    startCol: number;
    endCol: number;
    deltaRow: number;
    deltaCol: number;
  }

  const displacementZones: DisplacementZone[] = [];

  for (const tree of expandedRowTrees) {
    const rd = tree.driver;
    const protoH = rowProtoHeights.get(rd.id) || 1;
    const totalHeight = tree.nodes.reduce((sum, n) => sum + n.span, 0);
    const deltaR = Math.max(0, totalHeight - protoH);

    const associatedCells = docCells.filter(
      (c) => c.id === rd.id || c.parents?.row === rd.id
    );
    const minCol = Math.min(...associatedCells.map((c) => c.position.column));
    const maxCol = Math.max(...associatedCells.map((c) => c.position.column));
    const maxProtoRow = Math.max(...associatedCells.map((c) => c.position.row));

    displacementZones.push({
      regionId: rd.regionId,
      startRow: rd.position.row,
      endRow: maxProtoRow,
      startCol: minCol,
      endCol: maxCol,
      deltaRow: deltaR,
      deltaCol: 0,
    });
  }

  for (const tree of expandedColTrees) {
    const cd = tree.driver;
    const protoW = colProtoWidths.get(cd.id) || 1;
    const totalWidth = tree.nodes.reduce((sum, n) => sum + n.span, 0);
    const deltaC = Math.max(0, totalWidth - protoW);

    const associatedCells = docCells.filter(
      (c) => c.id === cd.id || c.parents?.column === cd.id
    );
    const minRow = Math.min(...associatedCells.map((c) => c.position.row));
    const maxRow = Math.max(...associatedCells.map((c) => c.position.row));
    const maxProtoCol = Math.max(...associatedCells.map((c) => c.position.column));

    displacementZones.push({
      regionId: cd.regionId,
      startRow: minRow,
      endRow: maxRow,
      startCol: cd.position.column,
      endCol: maxProtoCol,
      deltaRow: 0,
      deltaCol: deltaC,
    });
  }

  // 8. 实例化网格与单元格生成
  const cellsMap = new Map<string, BiGridCell>();
  const cellTemplateIdMap = new Map<string, string>();
  const staticCellPositions = new Map<string, CellDefinition>();
  const bindings: ReportBinding[] = [];
  const footprints = new Map<string, ReportCellMerge>(); // templateCellId -> footprint
  const driverFootprintMerges: ReportCellMerge[] = [];

  const analysisId = `analysis-${primaryRegion?.id || 'main'}`;

  // 不继承某一轴的格也必须跟随该轴整个重复块的尺寸推移（如行专属总计）。
  function displacedPosition(cell: CellDefinition): { row: number; column: number } {
    let shiftR = 0;
    let shiftC = 0;

    for (const zone of displacementZones) {
      if (cell.position.row > zone.endRow) {
        const inColScope =
          (cell.regionId && zone.regionId && cell.regionId === zone.regionId) ||
          (cell.position.column >= zone.startCol && cell.position.column <= zone.endCol) ||
          (!cell.regionId && docCells.filter((c) => c.regionId === zone.regionId).length === 0);
        if (inColScope) {
          shiftR = Math.max(shiftR, zone.deltaRow);
        }
      }
      if (cell.position.column > zone.endCol) {
        // 显式属于另一独立区域的格，不因共享表头行被横向推移。
        if (cell.regionId && zone.regionId && cell.regionId !== zone.regionId) continue;
        const inRowScope =
          (cell.regionId && zone.regionId && cell.regionId === zone.regionId) ||
          (cell.position.row >= zone.startRow && cell.position.row <= zone.endRow) ||
          (!cell.regionId && docCells.filter((c) => c.regionId === zone.regionId).length === 0);
        if (inRowScope) {
          shiftC = Math.max(shiftC, zone.deltaCol);
        }
      }
    }
    return { row: cell.position.row + shiftR, column: cell.position.column + shiftC };
  }

  // 8.1 放置静态单元格 (Static / Title Cells, 具备动态推移能力，防止展开碾压)
  for (const sc of staticCells) {
    const { row: r, column: c } = displacedPosition(sc);
    const rawVal = sc.content.kind === 'literal' ? (sc.content as LiteralCellContent).value : '';
    const formatOpts = resolveCellFormatOptions(sc);
    const cellStyle = toPublishedStyle(sc.style);
    if (formatOpts.format) {
      cellStyle.format = formatOpts.format;
    }
    const numVal = typeof rawVal === 'number' ? rawVal : Number(rawVal);
    if (!isNaN(numVal) && numVal < 0 && (formatOpts.negativeFormat === 'red_minus' || formatOpts.negativeFormat === 'red_bracket')) {
      cellStyle.color = '#cf1322';
    }
    const cell: BiGridCell = {
      row: r,
      col: c,
      value: rawVal,
      sourceCellId: sc.id, regionId: sc.regionId,
      displayText: formatValue(rawVal, formatOpts.format, formatOpts),
      role: 'custom',
      style: cellStyle,
      tooltip: formatOpts.tooltip,
    };
    cellsMap.set(`${r}:${c}`, cell);
    cellTemplateIdMap.set(`${r}:${c}`, sc.id);
    staticCellPositions.set(`${r}:${c}`, sc);

    const b = createReportBinding({
      analysisId: `analysis-${sc.regionId || primaryRegion?.id || 'static'}`,
      sheetId,
      row: r,
      column: c,
      role: 'custom',
    });
    (b as any).templateCellId = sc.id;
    (b as any).regionId = sc.regionId || 'static';
    (b as any).instanceKey = buildInstanceKey({
      templateCellId: sc.id,
      regionId: sc.regionId || 'static',
      rowPath: '__NONE__',
      columnPath: '__NONE__',
      metricId: '__NONE__',
      role: 'static',
    });
    (b as any).originalValue = rawVal;
    bindings.push(b);
  }

  // 8.2 扁平化叶子节点以进行笛卡尔相交
  interface LeafContext {
    driver: CellDefinition;
    node: ExpansionNode;
    startCoord: number;
    span: number;
    records: readonly DataRecord[];
    path: { field: string; memberKey: string }[];
  }

  function collectLeafNodes(driver: CellDefinition, list: ExpansionNode[]): LeafContext[] {
    const leaves: LeafContext[] = [];
    function walk(n: ExpansionNode) {
      if (n.children.length === 0) {
        leaves.push({
          driver,
          node: n,
          startCoord: n.startCoord,
          span: n.span,
          records: n.records,
          path: n.path,
        });
      } else {
        for (const ch of n.children) walk(ch);
      }
    }
    for (const n of list) walk(n);
    return leaves;
  }

  // 提取所有驱动节点（包括父节点与叶子节点）用于放置标签并记录 Footprint
  function placeDriverLabels(
    axis: 'row' | 'column',
    driver: CellDefinition,
    list: ExpansionNode[]
  ) {
    for (const n of list) {
      const r = axis === 'row' ? n.startCoord : driver.position.row;
      const c = axis === 'column' ? n.startCoord : driver.position.column;
      const key = `${r}:${c}`;

      if (staticCellPositions.has(key)) {
        const existingStatic = staticCellPositions.get(key);
        diagnostics.push({
          severity: 'error',
          code: 'ERR_REGION_CELL_COLLISION',
          message: `Driver cell "${driver.id}" at (${r}, ${c}) collides with static cell "${existingStatic?.id}".`,
          targetId: driver.id,
          sheetId,
        });
      }

      const axisRefPath = n.path.map((p) => ({
        axisId: axis === 'row' ? 'rows' : 'columns',
        field: p.field,
        memberKey: String(p.memberValue !== undefined ? p.memberValue : decodeMemberValue(p.memberKey)),
        label: String(p.memberValue !== undefined ? p.memberValue : decodeMemberValue(p.memberKey)),
      }));

      const formatOpts = resolveCellFormatOptions(driver);
      const dispText = formatOpts.dateFormat || formatOpts.emptyDisplay !== undefined
        ? formatValue(n.memberValue, formatOpts.format, formatOpts)
        : n.displayText;

      const cell: BiGridCell = {
        row: r,
        col: c,
        value: n.memberValue,
        sourceCellId: driver.id, regionId: driver.regionId, ruleFacts: n.records,
        displayText: dispText,
        role: 'dimension-member',
        rowPath: axis === 'row' ? axisRefPath : undefined,
        columnPath: axis === 'column' ? axisRefPath : undefined,
        style: {
          verticalAlign: 'middle',
          ...toPublishedStyle(driver.style),
        },
        tooltip: formatOpts.tooltip,
      };
      cellsMap.set(key, cell);
      cellTemplateIdMap.set(key, driver.id);

      const b = createReportBinding({
        analysisId: `analysis-${driver.regionId || primaryRegion?.id || 'main'}`,
        sheetId,
        row: r,
        column: c,
        role: 'dimension-member',
        rowPath: axis === 'row' ? axisRefPath : undefined,
        columnPath: axis === 'column' ? axisRefPath : undefined,
        field: (driver.content as FieldCellContent).fieldKey,
      });
      (b as any).templateCellId = driver.id;
      (b as any).regionId = driver.regionId || primaryRegion?.id || 'main';
      (b as any).instanceKey = buildInstanceKey({
        templateCellId: driver.id,
        regionId: driver.regionId || primaryRegion?.id || 'main',
        rowPath: axis === 'row' ? encodeMemberTuple(n.path.map((p) => `${p.field}=${p.memberKey}`)) : '__NONE__',
        columnPath: axis === 'column' ? encodeMemberTuple(n.path.map((p) => `${p.field}=${p.memberKey}`)) : '__NONE__',
        metricId: '__NONE__',
        role: 'dimension-member',
      });
      (b as any).originalValue = n.memberValue;
      bindings.push(b);

      // 记录真实 Footprint (跨越其所有子代或局部原型，并保留模板初始合并跨度)
      const templateMerge = (doc.layoutRules || []).find(
        (lr) =>
          lr.sheetId === sheetId &&
          lr.kind === 'merge' &&
          lr.range &&
          lr.range.startRow === driver.position.row &&
          lr.range.startColumn === driver.position.column
      );
      const initialColSpan = templateMerge && templateMerge.range
        ? Math.max(1, templateMerge.range.endColumn - templateMerge.range.startColumn + 1)
        : 1;
      const initialRowSpan = templateMerge && templateMerge.range
        ? Math.max(1, templateMerge.range.endRow - templateMerge.range.startRow + 1)
        : 1;

      const footprintMerge: ReportCellMerge = {
        startRow: r,
        endRow: axis === 'row' ? n.startCoord + Math.max(n.span, initialRowSpan) - 1 : r + initialRowSpan - 1,
        startCol: c,
        endCol: axis === 'column' ? n.startCoord + Math.max(n.span, initialColSpan) - 1 : c + initialColSpan - 1,
      };
      footprints.set(`${driver.id}::${n.memberKey}`, footprintMerge);
      if (n.memberValue !== undefined && n.memberValue !== null) {
        footprints.set(`${driver.id}::${String(n.memberValue)}`, footprintMerge);
      }
      if (n.path.length > 1) {
        const pathKey = n.path.map((p) => `${p.field}=${p.memberKey}`).join('::');
        footprints.set(`${driver.id}::${pathKey}`, footprintMerge);
      }
      if (footprintMerge.endRow > footprintMerge.startRow || footprintMerge.endCol > footprintMerge.startCol) {
        driverFootprintMerges.push(footprintMerge);
      }

      if (n.children.length > 0) {
        // 递归处理子驱动
        const childDriver = rowDrivers.find((d) => d.parents?.row === driver.id) ||
                            colDrivers.find((d) => d.parents?.column === driver.id);
        if (childDriver) {
          placeDriverLabels(axis, childDriver, n.children);
        }
      }
    }
  }

  // 放置所有行驱动与列驱动的标签
  for (const tree of expandedRowTrees) {
    placeDriverLabels('row', tree.driver, tree.nodes);
  }
  for (const tree of expandedColTrees) {
    placeDriverLabels('column', tree.driver, tree.nodes);
  }

  // 8.3 放置数据单元格与计算交集 (Data & Formula Cells)
  const rowLeaves = expandedRowTrees.length > 0
    ? expandedRowTrees.flatMap((t) => collectLeafNodes(t.driver, t.nodes))
    : [{
        driver: null as any,
        node: null as any,
        startCoord: docCells[0]?.position?.row || 0,
        span: 1,
        records: filteredRecords,
        path: [],
      }];

  const colLeaves = expandedColTrees.length > 0
    ? expandedColTrees.flatMap((t) => collectLeafNodes(t.driver, t.nodes))
    : [{
        driver: null as any,
        node: null as any,
        startCoord: docCells[0]?.position?.column || 0,
        span: 1,
        records: filteredRecords,
        path: [],
      }];

  interface DriverInstance {
    driver: CellDefinition;
    node: ExpansionNode;
    startCoord: number;
    span: number;
    records: readonly DataRecord[];
    path: { field: string; memberKey: string }[];
  }

  function collectDriverInstances(
    driverId: string | undefined,
    trees: { driver: CellDefinition; nodes: ExpansionNode[] }[]
  ): DriverInstance[] {
    if (!driverId) return [];
    const instances: DriverInstance[] = [];
    function search(driver: CellDefinition, list: ExpansionNode[]) {
      if (driver.id === driverId) {
        for (const n of list) {
          instances.push({
            driver,
            node: n,
            startCoord: n.startCoord,
            span: n.span,
            records: n.records,
            path: n.path,
          });
        }
        return;
      }
      for (const n of list) {
        if (n.children.length > 0) {
          const childDriver = rowDrivers.find((d) => d.parents?.row === driver.id) ||
                              colDrivers.find((d) => d.parents?.column === driver.id);
          if (childDriver) {
            search(childDriver, n.children);
          }
        }
      }
    }
    for (const t of trees) {
      search(t.driver, t.nodes);
    }
    return instances;
  }

  function evaluateDataCell(
    dc: CellDefinition,
    records: readonly DataRecord[],
    r: number,
    c: number,
    rowPath?: { field: string; memberKey: string }[],
    colPath?: { field: string; memberKey: string }[]
  ) {
    const fc = dc.content;
    let computedValue: any = null;
    let role = 'metric-value';

    const cellKey = `${r}:${c}`;
    if (staticCellPositions.has(cellKey)) {
      const existingStatic = staticCellPositions.get(cellKey);
      diagnostics.push({
        severity: 'error',
        code: 'ERR_REGION_CELL_COLLISION',
        message: `Expanded cell "${dc.id}" at (${r}, ${c}) collides with static cell "${existingStatic?.id}".`,
        targetId: dc.id,
        sheetId,
      });
    }

    if (fc.kind === 'literal') {
      computedValue = (fc as LiteralCellContent).value;
      role = 'custom';
    } else if (fc.kind === 'field') {
      const fieldOp = fc.operation;
      const fieldKey = fc.fieldKey;

      if (fieldOp === 'list') {
        const firstRec = records[0];
        computedValue = firstRec ? (firstRec as any)[fieldKey] : null;
      } else if (fieldOp === 'sum') {
        computedValue = records.reduce((sum, rec) => sum + (Number((rec as any)[fieldKey]) || 0), 0);
      } else if (fieldOp === 'avg') {
        const validVals = records.map((rec) => Number((rec as any)[fieldKey])).filter((n) => !isNaN(n));
        computedValue = validVals.length > 0 ? validVals.reduce((s, v) => s + v, 0) / validVals.length : null;
      } else if (fieldOp === 'count') {
        computedValue = records.length;
      } else if (fieldOp === 'min') {
        const vals = records.map((rec) => Number((rec as any)[fieldKey])).filter((n) => !isNaN(n));
        computedValue = vals.length > 0 ? Math.min(...vals) : null;
      } else if (fieldOp === 'max') {
        const vals = records.map((rec) => Number((rec as any)[fieldKey])).filter((n) => !isNaN(n));
        computedValue = vals.length > 0 ? Math.max(...vals) : null;
      }
    } else if (fc.kind === 'business-formula') {
      const bfc = fc as BusinessFormulaCellContent;
      const expr = bfc.expression;
      try {
        const context: Record<string, any> = {};
        const matches = Array.from(expr.matchAll(/\[([^\]]+)\]/g));
        for (const m of matches) {
          const rawRef = m[1];
          if (!rawRef) continue;
          const aggMatch = /^(SUM|AVG|MIN|MAX|COUNT)\((.+)\)$/i.exec(rawRef);
          if (aggMatch && aggMatch[1] && aggMatch[2]) {
            const op = aggMatch[1].toUpperCase();
            const fld = aggMatch[2].trim();
            if (op === 'SUM') {
              context[rawRef] = records.reduce((s, r) => s + (Number((r as any)[fld]) || 0), 0);
            } else if (op === 'AVG') {
              const vals = records.map((r) => Number((r as any)[fld])).filter((n) => !isNaN(n));
              context[rawRef] = vals.length > 0 ? vals.reduce((sum, n) => sum + n, 0) / vals.length : null;
            } else if (op === 'COUNT') {
              context[rawRef] = records.length;
            } else if (op === 'MIN') {
              const vals = records.map((r) => Number((r as any)[fld])).filter((n) => !isNaN(n));
              context[rawRef] = vals.length > 0 ? Math.min(...vals) : null;
            } else if (op === 'MAX') {
              const vals = records.map((r) => Number((r as any)[fld])).filter((n) => !isNaN(n));
              context[rawRef] = vals.length > 0 ? Math.max(...vals) : null;
            }
            if (context[fld] === undefined) {
              context[fld] = context[rawRef];
            }
          } else {
            const fld = rawRef.trim();
            context[fld] = records.reduce((s, r) => s + (Number((r as any)[fld]) || 0), 0);
          }
        }
        const val = evaluateFormula(expr, context, { nullAsZero: true, divisionByZeroAsNull: true });
        if (typeof val === 'number' && Number.isFinite(val)) {
          computedValue = bfc.precision !== undefined ? roundTo(val, bfc.precision) : val;
        } else {
          computedValue = null;
        }
      } catch (err) {
        diagnostics.push({
          severity: 'error',
          code: 'ERR_BUSINESS_FORMULA_EVALUATION',
          message: `Failed to evaluate business formula "${expr}": ${err instanceof Error ? err.message : String(err)}`,
          targetId: dc.id,
        });
        computedValue = null;
      }
    } else if (fc.kind === 'sheet-formula') {
      const formula = (fc as any).formula?.trim() || '';
      const evalResult = evaluateSheetFormula(formula, cellsMap, r, c);
      if (evalResult.error) {
        diagnostics.push({
          severity: evalResult.error === 'ERR_INVALID_SHEET_FORMULA' ? 'error' : 'warning',
          code: evalResult.error,
          message: `Sheet formula note in "${formula}": ${evalResult.error}`,
          targetId: dc.id,
          sheetId,
        });
      }
      computedValue = evalResult.value;
    }

    const rowRefPath: readonly AxisMemberRef[] | undefined =
      rowPath && rowPath.length > 0
        ? rowPath.map((p) => ({ axisId: 'rows', field: p.field, memberKey: p.memberKey, label: p.memberKey }))
        : undefined;
    const colRefPath: readonly AxisMemberRef[] | undefined =
      colPath && colPath.length > 0
        ? colPath.map((p) => ({ axisId: 'columns', field: p.field, memberKey: p.memberKey, label: p.memberKey }))
        : undefined;

    const formatOpts = resolveCellFormatOptions(dc);

    const cellStyle = toPublishedStyle(dc.style);
    if (formatOpts.format) {
      cellStyle.format = formatOpts.format;
    }
    const numVal = typeof computedValue === 'number' ? computedValue : Number(computedValue);
    if (
      !isNaN(numVal) &&
      numVal < 0 &&
      (formatOpts.negativeFormat === 'red_minus' || formatOpts.negativeFormat === 'red_bracket')
    ) {
      cellStyle.color = '#cf1322';
    }

    const hasAdvancedFormat = Boolean(
      (formatOpts.scale && formatOpts.scale !== 1) ||
      formatOpts.suffix ||
      formatOpts.prefix ||
      formatOpts.emptyDisplay !== undefined ||
      formatOpts.zeroDisplay !== undefined ||
      formatOpts.dateFormat ||
      formatOpts.negativeFormat === 'bracket' ||
      formatOpts.negativeFormat === 'red_bracket'
    );

    const gridCell: BiGridCell = {
      row: r,
      col: c,
      value: computedValue,
      sourceCellId: dc.id, regionId: dc.regionId, ruleFacts: records,
      ...(fc.kind === 'sheet-formula' ? { formula: fc.formula } : {}),
      displayText: formatValue(computedValue, formatOpts.format, formatOpts),
      role: role as any,
      rowPath: rowRefPath,
      columnPath: colRefPath,
      metricId: (fc as any).metricId || (fc as any).fieldKey,
      field: (fc as any).fieldKey,
      style: cellStyle,
      tooltip: formatOpts.tooltip,
      ...(hasAdvancedFormat ? { hasAdvancedFormat: true } : {}),
    } as any;
    cellsMap.set(cellKey, gridCell);
    cellTemplateIdMap.set(cellKey, dc.id);

    const b = createReportBinding({
      analysisId: `analysis-${dc.regionId || primaryRegion?.id || 'main'}`,
      sheetId,
      row: r,
      column: c,
      role: role as any,
      rowPath: rowRefPath,
      columnPath: colRefPath,
      metricId: (fc as any).metricId || (fc as any).fieldKey,
      field: (fc as any).fieldKey,
    });
    (b as any).templateCellId = dc.id;
    (b as any).regionId = dc.regionId || primaryRegion?.id || 'r1';
    (b as any).originalValue = computedValue;
    (b as any).instanceKey = buildInstanceKey({
      templateCellId: dc.id,
      regionId: dc.regionId || primaryRegion?.id || 'r1',
      rowPath: rowPath && rowPath.length > 0 ? encodeMemberTuple(rowPath.map((p) => `${p.field}=${p.memberKey}`)) : '__NONE__',
      columnPath: colPath && colPath.length > 0 ? encodeMemberTuple(colPath.map((p) => `${p.field}=${p.memberKey}`)) : '__NONE__',
      metricId: (fc as any).metricId || (fc as any).fieldKey || '__NONE__',
      role: role as any,
    });
    bindings.push(b);
  }

  // 分离普通数据格与公式格，实施二阶段求值确保表格公式可直接引用网格坐标值
  const normalDataCells = dataCells.filter((c) => c.content.kind !== 'sheet-formula');
  const sheetFormulaCells = dataCells.filter((c) => c.content.kind === 'sheet-formula');

  function placeDataCellBatch(cells: CellDefinition[]) {
    for (const dc of cells) {
      const hasRowParent = Boolean(dc.parents?.row && cellMap.has(dc.parents.row));
      const hasColParent = Boolean(dc.parents?.column && cellMap.has(dc.parents.column));

      if (!hasRowParent && !hasColParent) {
        // Group 1: 独立汇总卡片/单格 (CE-T06, CE-T11, CER-14)
        const dcRecords = getRecordsForRegion(dc.regionId);
        const pos = displacedPosition(dc);
        evaluateDataCell(dc, dcRecords, pos.row, pos.column);
      } else if (hasRowParent && !hasColParent) {
        // Group 2: 行专属度量/明细列 (CE-T02, CE-T03, CE-T08)
        const rowInstances = collectDriverInstances(dc.parents?.row ?? undefined, expandedRowTrees);
        const targets = rowInstances.length > 0 ? rowInstances : rowLeaves;
        for (const inst of targets) {
          const offset = inst.driver ? Math.min(Math.max(0, inst.span - 1), Math.max(0, dc.position.row - inst.driver.position.row)) : 0;
          const r = inst.startCoord + offset;
          const c = displacedPosition(dc).column;
          evaluateDataCell(dc, inst.records, r, c, inst.path, undefined);
        }
      } else if (!hasRowParent && hasColParent) {
        // Group 3: 列专属度量/明细行
        const colInstances = collectDriverInstances(dc.parents?.column ?? undefined, expandedColTrees);
        const targets = colInstances.length > 0 ? colInstances : colLeaves;
        for (const inst of targets) {
          const offset = inst.driver ? Math.min(Math.max(0, inst.span - 1), Math.max(0, dc.position.column - inst.driver.position.column)) : 0;
          const r = displacedPosition(dc).row;
          const c = inst.startCoord + offset;
          evaluateDataCell(dc, inst.records, r, c, undefined, inst.path);
        }
      } else {
        // Group 4: 二维正交交叉度量 (CE-T04, CE-T05)
        const rowInstances = collectDriverInstances(dc.parents?.row ?? undefined, expandedRowTrees);
        const colInstances = collectDriverInstances(dc.parents?.column ?? undefined, expandedColTrees);
        const rTargets = rowInstances.length > 0 ? rowInstances : rowLeaves;
        const cTargets = colInstances.length > 0 ? colInstances : colLeaves;

        // 预先建立行/列实例交集缓存，避免 O(R * C * N) 重复计算与频繁 Set 内存分配
        const intersectionCache = new Map<string, DataRecord[]>();

        for (const rInst of rTargets) {
          // 在外层循环建立行记录集合与主键索引 (避免在内层循环数千次重复构建 Set)
          const rSet = new Set(rInst.records);
          const rKeySet = new Set<string>();
          let hasKeys = false;
          for (const r of rInst.records) {
            const pk = (r as any)?.id ?? (r as any)?._id ?? (r as any)?.key;
            if (pk !== undefined && pk !== null) {
              rKeySet.add(String(pk));
              hasKeys = true;
            }
          }

          const rOffset = rInst.driver ? Math.min(Math.max(0, rInst.span - 1), Math.max(0, dc.position.row - rInst.driver.position.row)) : 0;
          const r = rInst.startCoord + rOffset;

          for (const cInst of cTargets) {
            const cOffset = cInst.driver ? Math.min(Math.max(0, cInst.span - 1), Math.max(0, dc.position.column - cInst.driver.position.column)) : 0;
            const c = cInst.startCoord + cOffset;

            const cacheKey = `${rInst.startCoord}:${rInst.span}###${cInst.startCoord}:${cInst.span}`;
            let intersect = intersectionCache.get(cacheKey);

            if (!intersect) {
              if (rInst.records.length === 0 || cInst.records.length === 0) {
                intersect = [];
              } else {
                // 双重匹配：同时支持内存对象引用及业务主键匹配 (解决浅拷贝与多数据源失效问题)
                intersect = cInst.records.filter((rec) => {
                  if (rSet.has(rec)) return true;
                  if (hasKeys) {
                    const pk = (rec as any)?.id ?? (rec as any)?._id ?? (rec as any)?.key;
                    if (pk !== undefined && pk !== null && rKeySet.has(String(pk))) return true;
                  }
                  return false;
                });
              }
              intersectionCache.set(cacheKey, intersect);
            }

            evaluateDataCell(dc, intersect, r, c, rInst.path, cInst.path);
          }
        }
      }
    }
  }

  // 第一阶段：放置所有普通数据与业务公式单元格
  placeDataCellBatch(normalDataCells);

  // 第二阶段：评估所有表格公式单元格 (允许引用已计算的第一阶段单元格坐标与数值)
  placeDataCellBatch(sheetFormulaCells);

  // 9. 消费人工覆盖 (Instance Overrides, CE-05, CER-04, CER-05)
  for (const override of doc.instanceOverrides || []) {
    const targetBinding = bindings.find((b) => (b as any).instanceKey === override.instanceKey);
    if (targetBinding) {
      const immutableBase = (targetBinding as any).originalValue;
      if (override.originalBaseValue !== undefined && immutableBase !== undefined && immutableBase !== override.originalBaseValue) {
        diagnostics.push({
          severity: 'warning',
          code: 'ERR_INSTANCE_OVERRIDE_CONFLICT',
          message: `Instance override conflict: original base value ${override.originalBaseValue} does not match current base value ${immutableBase}`,
          targetId: override.templateCellId,
        });
      }
      if (override.status !== 'conflict') {
        const targetCell = cellsMap.get(`${targetBinding.target.row}:${targetBinding.target.column}`);
        if (targetCell) {
          targetCell.value = override.overrideValue;
          const targetDef = cellMap.get(override.templateCellId);
          targetCell.displayText = formatValue(
            override.overrideValue,
            targetDef?.content?.kind === 'field' ? targetDef.content.format : undefined
          );
        }
      }
    } else {
      diagnostics.push({
        severity: 'warning',
        code: 'WARN_ORPHANED_INSTANCE',
        message: `Instance override "${override.instanceKey}" cannot be mapped to any data cell.`,
        targetId: override.templateCellId,
      });
    }
  }

  // 10. 消费样式与条件格式 (CER-16)
  // 跟随文字的源样本复用相同格式/条件管道，不参与数据布局，且不泄漏到发布坐标。
  const spanSources = activeStaticSpans(sourceDocument, sheetId);
  const spanSamples = new Map<string, BiGridCell>();
  const sampleKeys: string[] = [];
  const bindingCount = bindings.length;
  for (let i = 0; i < spanSources.length; i++) {
    const source = spanSources[i]!;
    const value = source.content.kind === 'literal' ? source.content.value : '';
    const fmt = resolveCellFormatOptions(source);
    const style = toPublishedStyle(source.style);
    if (fmt.format) style.format = fmt.format;
    if (Number(value) < 0 && (fmt.negativeFormat === 'red_minus' || fmt.negativeFormat === 'red_bracket')) style.color = '#cf1322';
    const row = -1 - i, key = `${row}:0`;
    const sample: BiGridCell = { row, col: 0, value, displayText: formatValue(value, fmt.format, fmt), role: 'custom', style, tooltip: fmt.tooltip };
    cellsMap.set(key, sample); cellTemplateIdMap.set(key, source.id); sampleKeys.push(key); spanSamples.set(source.id, sample);
    const binding = createReportBinding({ analysisId: `analysis-${source.staticSpan!.regionId}`, sheetId, row, column: 0, role: 'custom' });
    (binding as any).instanceKey = buildInstanceKey({ templateCellId: source.id, regionId: source.staticSpan!.regionId, rowPath: '__NONE__', columnPath: '__NONE__', metricId: '__NONE__', role: 'static' });
    bindings.push(binding);
  }
  // 11. 组装初始网格模型
  for (const key of sampleKeys) { cellsMap.delete(key); cellTemplateIdMap.delete(key); }
  bindings.length = bindingCount;
  const allPlacedCells = Array.from(cellsMap.values());
  const maxRow = allPlacedCells.reduce((max, c) => Math.max(max, c.row), 0);
  const maxCol = allPlacedCells.reduce((max, c) => Math.max(max, c.col), 0);

  // 提取设计态静态合并规则
  const initialMerges: ReportCellMerge[] = [];
  for (const lr of doc.layoutRules || []) {
    if (lr.sheetId === sheetId && lr.kind === 'merge' && lr.range) {
      let endCol = lr.range.endColumn;
      if (lr.id === 'merge-title' && maxCol > 0 && !sourceDocument.cells.some((c) => c.sheetId === sheetId && c.position.row === lr.range!.startRow && c.position.column === lr.range!.startColumn && c.staticSpan)) {
        endCol = maxCol;
      }
      initialMerges.push({
        startRow: lr.range.startRow,
        endRow: lr.range.endRow,
        startCol: lr.range.startColumn,
        endCol,
      });
    }
  }

  // 将每个驱动的真实 Footprint 注入到候选 merges 中供动态合并求值
  for (const fp of driverFootprintMerges) {
    initialMerges.push(fp);
  }

  const baseGrid: BiGridModel = {
    type: 'pivot',
    rowCount: Math.max(maxRow + 5, 20),
    colCount: Math.max(maxCol + 5, 10),
    cells: allPlacedCells,
    merges: initialMerges,
    bindings,
    colWidths: Object.fromEntries(
      (doc.layoutRules || [])
        .filter((r) => r.sheetId === sheetId && r.kind === 'column-width' && r.index !== undefined && r.size !== undefined)
        .map((r) => [r.index!, r.size!])
    ),
    rowHeights: Object.fromEntries(
      (doc.layoutRules || [])
        .filter((r) => r.sheetId === sheetId && r.kind === 'row-height' && r.index !== undefined && r.size !== undefined)
        .map((r) => [r.index!, r.size!])
    ),
  };

  // 12. 纯函数动态合并决议 (CE-05, CE-T14)
  const fakePlan: any = {
    regionId: primaryRegion?.id || 'main',
    datasetId: primaryRegion?.datasetId || 'default',
    sheetId,
    layoutKind: 'pivot',
    metricDirection: 'rows',
    anchor: { row: 0, column: 0 },
    filters: [],
    rowDimensions: rowDrivers.map((d) => ({
      templateCellId: d.id,
      fieldId: (d.content as FieldCellContent).fieldKey,
      fieldKey: (d.content as FieldCellContent).fieldKey,
      displayName: (d.content as FieldCellContent).displayName || (d.content as FieldCellContent).fieldKey,
      position: d.position,
    })),
    columnDimensions: colDrivers.map((d) => ({
      templateCellId: d.id,
      fieldId: (d.content as FieldCellContent).fieldKey,
      fieldKey: (d.content as FieldCellContent).fieldKey,
      displayName: (d.content as FieldCellContent).displayName || (d.content as FieldCellContent).fieldKey,
      position: d.position,
    })),
    measures: dataCells
      .filter((c) => c.content.kind === 'field' || c.content.kind === 'business-formula')
      .map((c) => ({
        templateCellId: c.id,
        metricId: (c.content as any).metricId || (c.content as any).fieldKey,
        fieldKey: (c.content as any).fieldKey || (c.content as any).metricId,
        displayName: (c.content as any).displayName || (c.content as any).fieldKey,
        position: c.position,
      })),
    detailColumns: [],
  };

  const isExplicitOnly = doc.mergeConfig?.legacyFallback === 'explicit-only';
  const effectivePolicies = [...(doc.mergeConfig?.policies || [])];
  const configuredCellIds = new Set(
    effectivePolicies
      .filter((p) => p.target.kind === 'template-cell' && (p.target as any).templateCellId)
      .map((p) => (p.target as any).templateCellId as string)
  );

  if (!isExplicitOnly) {
    for (const rd of rowDrivers) {
      if (!configuredCellIds.has(rd.id)) {
        effectivePolicies.push({
          id: `auto-policy-${rd.id}`,
          sheetId,
          regionId: rd.regionId || primaryRegion?.id || 'main',
          target: {
            kind: 'template-cell',
            templateCellId: rd.id,
            subject: 'row-member-label',
          },
          kind: 'group-span',
          direction: 'vertical',
          enabled: true,
          boundary: 'parent-group',
          source: 'preset',
          sequence: 100,
        });
      }
    }
  }

  const projectedLayoutRules = (doc.layoutRules || []).map((rule) => {
    if (rule.kind !== 'merge' || !rule.range || rule.id === 'merge-title' || rule.semanticSelector) return rule;
    const range = rule.range;
    const covered = docCells.filter((c) => c.position.row >= range.startRow && c.position.row <= range.endRow &&
      c.position.column >= range.startColumn && c.position.column <= range.endColumn);
    if (covered.some((c) => c.content.kind === 'field')) return rule;
    const regionId = covered[0]?.regionId || primaryRegion?.id;
    const start = displacedPosition({ position: { row: range.startRow, column: range.startColumn }, regionId } as CellDefinition);
    const end = displacedPosition({ position: { row: range.endRow, column: range.endColumn }, regionId } as CellDefinition);
    return { ...rule, range: { startRow: start.row, startColumn: start.column, endRow: end.row, endColumn: end.column } };
  });
  const effectiveDoc: CellTemplateDocumentV1 = {
    ...doc,
    layoutRules: projectedLayoutRules,
    mergeConfig: doc.mergeConfig
      ? { ...doc.mergeConfig, policies: effectivePolicies }
      : {
          capability: 'template-merge-v1',
          identityVersion: 1,
          policies: effectivePolicies,
          suppressions: [],
        },
  };

  const resolved = resolveTemplateMerges(effectiveDoc, fakePlan, baseGrid, { sheetId });
  if (resolved.diagnostics.length > 0) {
    diagnostics.push(...resolved.diagnostics);
  }

  const finalGrid: BiGridModel = {
    ...baseGrid,
    merges: resolved.merges,
    mergeOrigins: resolved.resolvedDetails,
  };

  const spanDrivers: SpanDriverInstance[] = [
    ...rowDrivers.flatMap((d) => collectDriverInstances(d.id, expandedRowTrees).map((i) => ({ templateCellId: d.id, regionId: d.regionId || primaryRegion?.id || '',
      axis: 'row' as const, start: i.startCoord, end: i.startCoord + i.span - 1, path: i.path }))),
    ...colDrivers.flatMap((d) => collectDriverInstances(d.id, expandedColTrees).map((i) => ({ templateCellId: d.id, regionId: d.regionId || primaryRegion?.id || '',
      axis: 'column' as const, start: i.startCoord, end: i.startCoord + i.span - 1, path: i.path }))),
  ];
  const spanned = applyStaticSpans(sourceDocument, finalGrid, { sheetId, drivers: spanDrivers, position: displacedPosition, renderLiteral: (c) => spanSamples.get(c.id) });
  const presentation = applyPresentationRules(sourceDocument, spanned.grid, rawDataset, { sheetId });
  diagnostics.push(...spanned.diagnostics, ...presentation.diagnostics);
  return {
    grid: presentation.grid,
    recordCount: rawDataset.length,
    filteredCount: filteredRecords.length,
    diagnostics,
    footprints,
  };
}
