import type { BiGridCell, BiGridModel, ReportBinding, ReportCellMerge } from '../report/types.js';
import type { CellDefinition, CellMergeRange, CellTemplateDocumentV1, StaticSpanConfig, TemplateDiagnostic } from './types.js';
import { createReportBinding } from '../report/bindings.js';
import { buildInstanceKey, encodeMemberTuple } from './identity.js';
import { sourceStyleToPublished } from '../report/cellStyle.js';

export interface SpanDriverInstance {
  templateCellId: string;
  regionId: string;
  axis: 'row' | 'column';
  start: number;
  end: number;
  path: readonly { field: string; memberKey: string }[];
}
type Bounds = { left: number; dataLeft: number; dataEnd: number; right: number; top: number; bottom: number };
const nonempty = (v: unknown) => v !== null && v !== undefined && v !== '';
const intersects = (a: ReportCellMerge, b: ReportCellMerge) => a.startRow <= b.endRow && b.startRow <= a.endRow && a.startCol <= b.endCol && b.startCol <= a.endCol;
const isTotal = (c: CellDefinition) => c.content.kind === 'field' && (c.content.role === 'total' || c.id.startsWith('meas-rowtotal-') || c.content.metricId?.startsWith('metric-rowtotal-'));
export const activeStaticSpans = (doc: CellTemplateDocumentV1, sheetId?: string) => doc.cells.filter((c) => c.staticSpan?.enabled && (!sheetId || c.sheetId === sheetId));

export function ownsStaticSpanMerge(doc: CellTemplateDocumentV1, rule: { sheetId: string; kind: string; range?: CellMergeRange | undefined }): boolean {
  if (rule.kind !== 'merge' || !rule.range) return false;
  return activeStaticSpans(doc, rule.sheetId).some((c) => c.position.row === rule.range!.startRow && c.position.column === rule.range!.startColumn &&
    !doc.cells.some((other) => other.id !== c.id && other.sheetId === c.sheetId && other.position.row >= rule.range!.startRow && other.position.row <= rule.range!.endRow &&
      other.position.column >= rule.range!.startColumn && other.position.column <= rule.range!.endColumn && other.content.kind === 'literal' && nonempty(other.content.value)));
}

/** 先排除跟随文字，避免它参与父格推断、原型测量或被业务数据覆盖。 */
export function prepareStaticSpanTemplate(doc: CellTemplateDocumentV1): CellTemplateDocumentV1 {
  const active = new Set(activeStaticSpans(doc).map((c) => c.id));
  if (!active.size) return doc;
  return { ...doc, cells: doc.cells.filter((c) => !active.has(c.id)), layoutRules: doc.layoutRules.filter((r) => !ownsStaticSpanMerge(doc, r)) };
}

export function validateStaticSpans(doc: CellTemplateDocumentV1): TemplateDiagnostic[] {
  const result: TemplateDiagnostic[] = [];
  const ids = new Set<string>();
  for (const c of doc.cells) {
    const s = c.staticSpan;
    if (!s) continue;
    const error = (message: string) => result.push({ severity: 'error', code: 'ERR_STATIC_SPAN_CONFIG', message, targetId: c.id, sheetId: c.sheetId });
    if (!s.id || ids.has(s.id)) error(`静态范围规则身份缺失或重复：${s.id}`);
    ids.add(s.id);
    if (!s.enabled) continue;
    if (c.content.kind !== 'literal') error('范围跟随仅用于静态单元格/静态区域');
    const region = doc.regions.find((r) => r.id === s.regionId);
    if (!region || region.sheetId !== c.sheetId) error('请选择同一工作表内的目标动态区域');
    if (!['report', 'columns', 'column-group'].includes(s.scope) || !['template', 'before-region', 'after-region', 'before-group', 'after-group'].includes(s.placement) ||
      !['once', 'row-groups', 'column-groups'].includes(s.repeat)) error('静态范围类型、锚点或出现上下文无效');
    if (!Number.isInteger(s.height) || s.height < 1 || s.height > 1000 || !Number.isInteger(s.rowOffset) || s.rowOffset < 0) error('区域高度需为1～1000的整数，行偏移需为非负整数');
    for (const axis of ['row', 'column'] as const) {
      const required = axis === 'row' ? s.repeat === 'row-groups' : s.repeat === 'column-groups' || s.scope === 'column-group';
      if (!required) continue;
      const target = doc.cells.find((p) => p.id === (axis === 'row' ? s.rowParentId : s.columnParentId));
      if (!target || target.sheetId !== c.sheetId || target.regionId !== s.regionId || target.content.kind !== 'field' || target.content.role !== `${axis}-dimension`) error(`范围跟随的${axis === 'row' ? '行' : '列'}父分组不存在，请重新选择`);
    }
    if ((s.placement === 'before-group' || s.placement === 'after-group') && s.repeat === 'once') error('组前/组后锚点需要选择分组出现上下文');
    if (s.scope === 'column-group' && s.repeat === 'once') error('所属列分组范围需要列分组或行列分组上下文');
    if (s.repeat === 'column-groups' && s.scope !== 'column-group') error('列分组上下文请选择所属列分组宽度');
    if (s.scope === 'column-group' && s.includeTotals) error('所属列分组不包含整表末尾总计');
    const area = s.templateRange;
    if (area && (area.endRow < area.startRow || area.endColumn < area.startColumn)) error('静态源区域无效');
    if (area) {
      const other = doc.cells.find((p) => p.id !== c.id && p.sheetId === c.sheetId && p.position.row >= c.position.row && p.position.row < c.position.row + s.height &&
        p.position.column >= c.position.column && p.position.column <= c.position.column + area.endColumn - area.startColumn && (p.content.kind !== 'literal' || nonempty(p.content.value)));
      if (other) error(`静态源区域包含其他内容：${other.id}，不能覆盖`);
    }
  }
  return result;
}

function prototypeBounds(doc: CellTemplateDocumentV1, regionId: string): Bounds {
  const region = doc.regions.find((r) => r.id === regionId)!;
  const fields = doc.cells.filter((c) => c.regionId === regionId && c.content.kind === 'field' && !c.staticSpan?.enabled);
  const data = fields.filter((c) => c.content.kind === 'field' && ['measure', 'total', 'detail-column'].includes(c.content.role));
  const normal = data.filter((c) => !isTotal(c));
  const columns = fields.filter((c) => c.content.kind === 'field' && c.content.role === 'column-dimension');
  const dataCandidates = normal.length ? normal : columns.length ? columns : fields;
  const dataLeft = dataCandidates.length ? Math.min(...dataCandidates.map((c) => c.position.column)) : region.anchor.column;
  const left = Math.min(region.anchor.column, ...fields.map((c) => c.position.column));
  return { left, dataLeft, dataEnd: Math.max(dataLeft, ...normal.map((c) => c.position.column), ...columns.map((c) => c.position.column)),
    right: Math.max(dataLeft, ...fields.map((c) => c.position.column)), top: region.anchor.row,
    bottom: Math.max(region.anchor.row, ...fields.map((c) => c.position.row)) };
}

/** 设计态只显示源静态区域，不把运行时范围写回模板。 */
export function staticSpanDesignRange(cell: CellDefinition, doc?: CellTemplateDocumentV1): ReportCellMerge {
  const s = cell.staticSpan!;
  const fixed = doc?.layoutRules.find((r) => r.kind === 'merge' && r.sheetId === cell.sheetId && r.range?.startRow === cell.position.row && r.range.startColumn === cell.position.column)?.range;
  return { startRow: cell.position.row, endRow: cell.position.row + s.height - 1, startCol: cell.position.column,
    endCol: s.templateRange ? cell.position.column + Math.max(0, s.templateRange.endColumn - s.templateRange.startColumn) : fixed?.endColumn ?? cell.position.column };
}

export function addStaticSpanDesignMerges(doc: CellTemplateDocumentV1, grid: BiGridModel): BiGridModel {
  const sources = activeStaticSpans(doc);
  if (!sources.length) return grid;
  const ranges = sources.map((c) => ({ cell: c, range: staticSpanDesignRange(c, doc) }));
  const owned = new Set(doc.layoutRules.filter((r) => ownsStaticSpanMerge(doc, r)).map((r) => r.id));
  const merges = grid.merges.filter((m) => !doc.layoutRules.some((r) => owned.has(r.id) && r.range && r.range.startRow === m.startRow && r.range.endRow === m.endRow && r.range.startColumn === m.startCol && r.range.endColumn === m.endCol));
  const cells = grid.cells.map((c) => {
    const owner = sources.find((s) => s.position.row === c.row && s.position.column === c.col);
    return owner ? { ...c, style: { ...c.style, align: owner.style?.textAlign || 'center', verticalAlign: owner.style?.verticalAlign || 'middle' } } : c;
  });
  return { ...grid, cells, merges: [...merges, ...ranges.filter(({ cell: c, range: r }) => c.staticSpan!.merge && (r.startRow !== r.endRow || r.startCol !== r.endCol)).map((x) => x.range)],
    staticSpanInstances: ranges.map(({ cell: c, range }) => ({ ruleId: c.staticSpan!.id, templateCellId: c.id, regionId: c.staticSpan!.regionId, instanceKey: `design:${c.id}`, range,
      merged: c.staticSpan!.merge && (range.startRow !== range.endRow || range.startCol !== range.endCol) })),
    rowCount: Math.max(grid.rowCount, ...ranges.map((x) => x.range.endRow + 2)), colCount: Math.max(grid.colCount, ...ranges.map((x) => x.range.endCol + 2)) };
}

export interface StaticSpanRuntimeOptions {
  sheetId: string;
  drivers?: SpanDriverInstance[];
  position?: (cell: CellDefinition) => { row: number; column: number };
  renderLiteral?: (cell: CellDefinition) => BiGridCell | undefined;
}

/** 旧投影器的兼容上下文，由语义绑定及其完整父路径恢复，不改变旧报表的数据求值。 */
export function inferStaticSpanDrivers(doc: CellTemplateDocumentV1, grid: BiGridModel, sheetId: string): SpanDriverInstance[] {
  const result: SpanDriverInstance[] = [];
  const key = (path: readonly any[]) => JSON.stringify(path.map((p) => [p.field, p.memberKey]));
  for (const cell of doc.cells.filter((c) => c.sheetId === sheetId && c.content.kind === 'field' && ['row-dimension', 'column-dimension'].includes(c.content.role))) {
    const axis = (cell.content as any).role === 'row-dimension' ? 'row' : 'column';
    const seen = new Set<string>();
    for (const b of grid.bindings.filter((b) => (b as any).templateCellId === cell.id && b.semantic.role === 'dimension-member')) {
      const path = axis === 'row' ? b.semantic.rowPath : b.semantic.columnPath;
      const index = path.findIndex((p) => p.field === (cell.content as any).fieldKey);
      if (index < 0) continue;
      const prefix = path.slice(0, index + 1);
      const encoded = key(prefix);
      if (seen.has(encoded)) continue;
      seen.add(encoded);
      const targets = grid.bindings.filter((target) => (target as any).regionId === cell.regionId &&
        key((axis === 'row' ? target.semantic.rowPath : target.semantic.columnPath).slice(0, index + 1)) === encoded);
      const positions = targets.map((t) => axis === 'row' ? t.target.row : t.target.column);
      result.push({ templateCellId: cell.id, regionId: cell.regionId || '', axis,
        start: Math.min(...positions), end: Math.max(...positions), path: prefix.map((p) => ({ field: p.field, memberKey: p.memberKey })) });
    }
  }
  return result;
}

/** 在业务网格形成之后解析文字跨度，并为组内/表中说明保留行带。 */
export function applyStaticSpans(doc: CellTemplateDocumentV1, input: BiGridModel, options: StaticSpanRuntimeOptions): { grid: BiGridModel; diagnostics: TemplateDiagnostic[] } {
  const sources = activeStaticSpans(doc, options.sheetId);
  if (!sources.length) return { grid: input, diagnostics: [] };
  const diagnostics: TemplateDiagnostic[] = validateStaticSpans(doc).filter((d) => !d.sheetId || d.sheetId === options.sheetId);
  if (diagnostics.some((d) => d.severity === 'error')) return { grid: input, diagnostics };
  const sourceMap = new Map(doc.cells.map((c) => [c.id, c]));
  const bindingAt = new Map(input.bindings.map((b) => [`${b.target.row}:${b.target.column}`, b]));
  const regionFor = (b?: ReportBinding) => (b as any)?.regionId || b?.analysisId?.replace(/^analysis-/, '');
  const bounds = new Map<string, Bounds>();
  for (const region of doc.regions.filter((r) => r.sheetId === options.sheetId)) {
    const proto = prototypeBounds(doc, region.id);
    const all = input.bindings.filter((b) => regionFor(b) === region.id && sourceMap.get((b as any).templateCellId)?.content.kind === 'field');
    const business = all.filter((b) => {
      const c = sourceMap.get((b as any).templateCellId);
      return c?.content.kind === 'field' && ['measure', 'total', 'detail-column'].includes(c.content.role);
    });
    const normal = business.filter((b) => !isTotal(sourceMap.get((b as any).templateCellId)!));
    const axis = all.filter((b) => sourceMap.get((b as any).templateCellId)?.content.kind === 'field' && (sourceMap.get((b as any).templateCellId)!.content as any).role === 'column-dimension');
    bounds.set(region.id, { left: all.reduce((n, b) => Math.min(n, b.target.column), proto.left), top: all.reduce((n, b) => Math.min(n, b.target.row), proto.top),
      bottom: all.reduce((n, b) => Math.max(n, b.target.row), proto.bottom), dataLeft: normal.length ? normal.reduce((n, b) => Math.min(n, b.target.column), Infinity) : proto.dataLeft,
      dataEnd: normal.length ? normal.reduce((n, b) => Math.max(n, b.target.column), 0) : axis.length ? axis.reduce((n, b) => Math.max(n, b.target.column), 0) : proto.dataEnd,
      right: all.length ? all.reduce((n, b) => Math.max(n, b.target.column), 0) : proto.right });
  }
  const drivers = options.drivers || inferStaticSpanDrivers(doc, input, options.sheetId);
  type Instance = { cell: CellDefinition; config: StaticSpanConfig; region: Bounds; rawRow: number; range: ReportCellMerge; instanceKey: string; insert: boolean; rowPath: SpanDriverInstance['path']; columnPath: SpanDriverInstance['path'] };
  const instances: Instance[] = [];
  for (const cell of sources) {
    const config = cell.staticSpan!;
    const region = bounds.get(config.regionId);
    if (!region) continue;
    const rowContexts = config.repeat === 'row-groups' ? drivers.filter((d) => d.axis === 'row' && d.regionId === config.regionId && d.templateCellId === config.rowParentId) : [undefined];
    const colContexts = config.scope === 'column-group' || config.repeat === 'column-groups' ? drivers.filter((d) => d.axis === 'column' && d.regionId === config.regionId && d.templateCellId === config.columnParentId) : [undefined];
    for (const row of rowContexts) for (const col of colContexts) {
      let rawRow = (options.position?.({ ...cell, regionId: config.regionId }) || cell.position).row + config.rowOffset;
      if (config.placement === 'before-region') rawRow = Math.max(0, region.top - config.height - config.rowOffset);
      else if (config.placement === 'after-region') rawRow = region.bottom + 1 + config.rowOffset;
      else if (config.placement === 'before-group') rawRow = Math.max(0, (row?.start ?? sourceMap.get(col!.templateCellId)!.position.row) - config.rowOffset);
      else if (config.placement === 'after-group') rawRow = (row?.end ?? region.bottom) + 1 + config.rowOffset;
      else if (row) rawRow = Math.min(row.end + 1, row.start + Math.max(0, cell.position.row - sourceMap.get(row.templateCellId)!.position.row) + config.rowOffset);
      const startCol = col?.start ?? (config.scope === 'report' ? region.left : region.dataLeft);
      const endCol = Math.max(startCol, col?.end ?? (config.includeTotals ? region.right : region.dataEnd));
      const instanceKey = buildInstanceKey({ templateCellId: config.id, regionId: config.regionId,
        rowPath: row ? encodeMemberTuple(row.path.map((p) => `${p.field}=${p.memberKey}`)) : '__NONE__',
        columnPath: col ? encodeMemberTuple(col.path.map((p) => `${p.field}=${p.memberKey}`)) : '__NONE__', metricId: '__NONE__', role: 'static-span' });
      instances.push({ cell, config, region, rawRow, instanceKey, range: { startRow: rawRow, endRow: rawRow + config.height - 1, startCol, endCol },
        insert: rawRow >= region.top && rawRow <= region.bottom, rowPath: row?.path||[], columnPath: col?.path||[] });
    }
  }
  const error = (code: string, message: string, cell: CellDefinition) => diagnostics.push({ severity: 'error', code, message, sheetId: cell.sheetId, targetId: cell.id });
  const otherStaticByRow = new Map<number, BiGridCell[]>();
  const literalAt = new Map(doc.cells.filter((c) => c.sheetId === options.sheetId && c.content.kind === 'literal' && !c.staticSpan?.enabled).map((c) => [`${c.position.row}:${c.position.column}`, c]));
  for (const c of input.cells) {
    const fallback = literalAt.get(`${c.row}:${c.col}`);
    const definition = sourceMap.get((bindingAt.get(`${c.row}:${c.col}`) as any)?.templateCellId) || (fallback?.content.kind === 'literal' && fallback.content.value === c.value ? fallback : undefined);
    if ((nonempty(c.value) || nonempty(c.displayText)) && definition?.content.kind === 'literal' && !definition.panelOwner) {
      const row = otherStaticByRow.get(c.row); if (row) row.push(c); else otherStaticByRow.set(c.row, [c]);
    }
  }
  for (const inst of instances) {
    let conflict: BiGridCell | undefined;
    for (let r = inst.range.startRow; r <= inst.range.endRow && !conflict; r++) conflict = otherStaticByRow.get(r)?.find((c) => c.col >= inst.range.startCol && c.col <= inst.range.endCol);
    if (conflict) error('ERR_STATIC_SPAN_CONTENT_COLLISION', `范围跟随与其他静态内容冲突（R${conflict.row + 1}C${conflict.col + 1}），未覆盖内容`, inst.cell);
  }
  const bands = instances.filter((i) => i.insert).map((i) => ({ row: i.rawRow, height: i.config.height, region: i.region }));
  const affected = (regionId: string | undefined, col: number, band: typeof bands[number]) => {
    const region = regionId ? bounds.get(regionId) : undefined;
    return region ? region.left <= band.region.right && band.region.left <= region.right : col >= band.region.left && col <= band.region.right;
  };
  const prefixCache = new Map<string, { row: number; offset: number }[]>();
  const shift = (row: number, regionId: string | undefined, col: number, inclusive = true) => {
    if (!bands.length) return 0;
    const key = regionId && bounds.has(regionId) ? regionId : `column:${col}`;
    let prefix = prefixCache.get(key);
    if (!prefix) {
      const perRow = new Map<number, number>();
      for (const band of bands) if (affected(regionId, col, band)) perRow.set(band.row, Math.max(perRow.get(band.row) || 0, band.height));
      let offset = 0;
      prefix = [...perRow].sort(([a], [b]) => a - b).map(([r, height]) => ({ row: r, offset: offset += height }));
      prefixCache.set(key, prefix);
    }
    let lo = 0, hi = prefix.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (inclusive ? prefix[mid]!.row <= row : prefix[mid]!.row < row) lo = mid + 1; else hi = mid; }
    return lo ? prefix[lo - 1]!.offset : 0;
  };
  const cells: BiGridCell[] = input.cells.map((c) => ({ ...c, style: c.style ? { ...c.style } : undefined,
    row: c.row + shift(c.row, regionFor(bindingAt.get(`${c.row}:${c.col}`)), c.col) }));
  const bindings = input.bindings.map((b) => ({ ...b, target: { ...b.target, row: b.target.row + shift(b.target.row, regionFor(b), b.target.column) } }));
  const rangeKey = (m: ReportCellMerge) => `${m.startRow}:${m.endRow}:${m.startCol}:${m.endCol}`;
  const origins = input.mergeOrigins || [];
  const originByRange = new Map(origins.map((o) => [rangeKey(o.range), o]));
  const cellIndex = new Map(cells.map((c) => [`${c.row}:${c.col}`, c]));
  const transformed = (m: ReportCellMerge) => {
    const b = bindingAt.get(`${m.startRow}:${m.startCol}`);
    return { ...m, startRow: m.startRow + shift(m.startRow, regionFor(b), m.startCol), endRow: m.endRow + shift(m.endRow, regionFor(b), m.endCol) };
  };
  for (const inst of instances) {
    const delta = shift(inst.rawRow, inst.config.regionId, inst.range.startCol, false);
    inst.range = { ...inst.range, startRow: inst.rawRow + delta, endRow: inst.rawRow + delta + inst.config.height - 1 };
  }
  let active: Instance[] = [];
  for (const inst of [...instances].sort((a, b) => a.range.startRow - b.range.startRow || a.range.startCol - b.range.startCol)) {
    active = active.filter((i) => i.range.endRow >= inst.range.startRow);
    if (active.some((i) => intersects(i.range, inst.range))) error('ERR_STATIC_SPAN_OVERLAP', '两个范围跟随区域相互重叠，请调整锚点或偏移', inst.cell);
    active.push(inst);
  }
  const merges: ReportCellMerge[] = [];
  const mergeOrigins: NonNullable<BiGridModel['mergeOrigins']> = [];
  const cellRows = new Map<number, BiGridCell[]>();
  const indexRow = (c: BiGridCell) => { const row = cellRows.get(c.row); if (row) row.push(c); else cellRows.set(c.row, [c]); };
  for (const c of cells) indexRow(c);
  for (const original of input.merges) {
    const origin = originByRange.get(rangeKey(original));
    const moved = transformed(original);
    let parts = [moved];
    for (const inst of instances) {
      if (!intersects(moved, inst.range)) continue;
      if (origin?.origin !== 'group-span' && origin?.origin !== 'adjacent-equal') {
        error('ERR_STATIC_SPAN_MANUAL_COLLISION', '范围跟随与既有人工合并冲突，请先调整范围', inst.cell);
        continue;
      }
      parts = parts.flatMap((p) => !intersects(p, inst.range) ? [p] : [
        ...(p.startRow < inst.range.startRow ? [{ ...p, endRow: inst.range.startRow - 1 }] : []),
        ...(p.endRow > inst.range.endRow ? [{ ...p, startRow: inst.range.endRow + 1 }] : []),
      ]);
    }
    const master = cellIndex.get(`${moved.startRow}:${moved.startCol}`);
    for (const p of parts) {
      if (master && !cellIndex.has(`${p.startRow}:${p.startCol}`)) { const repeated = { ...master, row: p.startRow, col: p.startCol }; cells.push(repeated); cellIndex.set(`${p.startRow}:${p.startCol}`, repeated); indexRow(repeated); }
      if (p.startRow === p.endRow && p.startCol === p.endCol) continue;
      merges.push(p);
      if (origin) mergeOrigins.push({ ...origin, range: p });
    }
  }
  for (const inst of instances) {
    const { cell, config, range } = inst;
    let collision: BiGridCell | undefined;
    for (let r = range.startRow; r <= range.endRow && !collision; r++) collision = cellRows.get(r)?.find((c) => c.col >= range.startCol && c.col <= range.endCol && (nonempty(c.value) || nonempty(c.displayText)));
    if (collision) { error('ERR_STATIC_SPAN_CONTENT_COLLISION', `范围内仍有内容（R${collision.row + 1}C${collision.col + 1}），未覆盖`, cell); continue; }
    const value = cell.content.kind === 'literal' ? cell.content.value : '';
    const style = cell.style;
    const formatted = options.renderLiteral?.(cell);
    const textCell: BiGridCell = { row: range.startRow, col: range.startCol, value, displayText: formatted?.displayText ?? String(value ?? ''), role: 'custom', tooltip: formatted?.tooltip,
      sourceCellId: cell.id, regionId: config.regionId,
      rowPath: inst.rowPath.map(p=>({axisId:'rows',field:p.field,memberKey:p.memberKey,label:String(p.memberKey)})),
      columnPath: inst.columnPath.map(p=>({axisId:'columns',field:p.field,memberKey:p.memberKey,label:String(p.memberKey)})),
      style: { ...sourceStyleToPublished(style),align: style?.textAlign || 'center', verticalAlign: style?.verticalAlign || 'middle',
        ...Object.fromEntries(Object.entries(formatted?.style || {}).filter(([, v]) => v !== undefined)) } };
    if (typeof value === 'number' && textCell.displayText !== String(value)) (textCell as any).hasAdvancedFormat = true;
    cells.push(textCell); indexRow(textCell);
    // 取消合并后仍保留静态区域的逻辑高度/宽度，发布裁边不能丢掉末尾空行。
    if ((range.endRow !== range.startRow || range.endCol !== range.startCol) && !cells.some((c) => c.row === range.endRow && c.col === range.endCol)) {
      cells.push({ row: range.endRow, col: range.endCol, value: null, displayText: '', role: 'custom', sourceCellId:'' });
    }
    const binding = createReportBinding({ analysisId: `analysis-${config.regionId}`, sheetId: cell.sheetId,
      row: range.startRow, column: range.startCol, role: 'custom' });
    binding.id = `static-span::${inst.instanceKey}`;
    Object.assign(binding, { templateCellId: cell.id, regionId: config.regionId, instanceKey: inst.instanceKey, originalValue: value });
    bindings.push(binding);
    const merged = config.merge && !config.suppressions.includes(inst.instanceKey) && (range.startCol !== range.endCol || range.startRow !== range.endRow);
    if (merged) { merges.push(range); mergeOrigins.push({ ruleId: config.id, origin: 'static-span', targetCellId: cell.id, spanInstanceKey: inst.instanceKey, range }); }
  }
  const staticSpanInstances = instances.map((i) => ({ ruleId: i.config.id, templateCellId: i.cell.id, regionId: i.config.regionId, instanceKey: i.instanceKey, range: i.range,
    merged: mergeOrigins.some((o) => o.origin === 'static-span' && o.spanInstanceKey === i.instanceKey) }));
  const rowHeights: Record<number, number> = {};
  const ownedHeightRows = new Set(sources.flatMap((s) => Array.from({ length: s.staticSpan!.height }, (_, i) => s.position.row + i)));
  for (const [r, h] of Object.entries(input.rowHeights || {})) if (!ownedHeightRows.has(Number(r))) rowHeights[Number(r) + shift(Number(r), undefined, instances[0]?.region.left || 0)] = h;
  for (const inst of instances) for (let offset = 0; offset < inst.config.height; offset++) {
    const height = doc.layoutRules.find((r) => r.sheetId === options.sheetId && r.kind === 'row-height' && r.index === inst.cell.position.row + offset)?.size;
    if (height !== undefined) rowHeights[inst.range.startRow + offset] = height;
  }
  return { grid: { ...input, cells, bindings, merges, mergeOrigins, staticSpanInstances,
    rowCount: merges.reduce((n, m) => Math.max(n, m.endRow + 2), cells.reduce((n, c) => Math.max(n, c.row + 3), input.rowCount)),
    colCount: merges.reduce((n, m) => Math.max(n, m.endCol + 2), input.colCount), rowHeights }, diagnostics };
}
