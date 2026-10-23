import type { CellDefinition, CellFormatOptions, CellTemplateDocumentV1, LayoutRule } from '../report-template/types.js';
import { resolveCellFormatOptions } from '../report-template/cellExpansionEngine.js';
import { hybridAxisKey } from '../report-template/hybridAxes.js';

const panelId = (c: CellDefinition) => c.panelOwner?.cellId || c.id;
const isLegacyTotal = (c: CellDefinition) => c.id === 'hdr-row-total' || c.id.startsWith('meas-rowtotal-');
const identity = (c: CellDefinition) => hybridAxisKey(c) || panelId(c);

/** 新文档以显式意图为准；旧文档必须有计算格，孤立表头不能重新打开总计。 */
export function readHybridRowTotals(doc: CellTemplateDocumentV1): boolean {
  return doc.hybridConfig?.showRowTotals ?? doc.cells.some((c) => c.id.startsWith('meas-rowtotal-'));
}

/** 快照必须相对于实际渲染它的管理清单解释，再按身份迁移至当前配置。 */
export function collectHybridExtras(
  syncedDoc: CellTemplateDocumentV1,
  renderedPanel: CellTemplateDocumentV1,
  previousExtras: readonly CellDefinition[],
  activePanel: CellTemplateDocumentV1
): CellDefinition[] {
  const renderedById = new Map(renderedPanel.cells.map((c) => [c.id, c]));
  const renderedByIdentity = new Map(renderedPanel.cells.map((c) => [identity(c), c]));
  const activeById = new Map(activePanel.cells.map((c) => [identity(c), c]));
  const previousById = new Map(previousExtras.map((c) => [identity(c), c]));
  const result: CellDefinition[] = [];

  for (const c of syncedDoc.cells) {
    const managed = renderedByIdentity.get(identity(c)) || renderedById.get(panelId(c));
    if (managed) {
      const active = activeById.get(identity(managed));
      if (!active) continue; // 关闭总计/删除指标时同时丢弃其高级覆盖。
      const existing = previousById.get(identity(managed));
      result.push({
        ...c,
        ...existing,
        id: active.id,
        panelOwner: active.panelOwner,
        sheetId: active.sheetId,
        position: active.position,
        parents: active.parents,
        style: { ...existing?.style, ...c.style },
        content: { ...c.content, ...existing?.content } as CellDefinition['content'],
      });
    } else if (!c.panelOwner && !isLegacyTotal(c)) {
      // 不按显示文字过滤；用户自己输入“行总计”也是合法备注。
      result.push(c);
    }
  }
  return result;
}

export function mergeHybridCells(panel: CellTemplateDocumentV1, extras: readonly CellDefinition[]): CellDefinition[] {
  const panelIds = new Set(panel.cells.map((c) => c.id));
  const panelIdentities = new Set(panel.cells.map(identity));
  const merged = panel.cells.map((pc) => {
    const override = extras.find((ec) => identity(ec) === identity(pc));
    if (!override) return pc;
    const userContent = override.content as any;
    const pcContent = pc.content as any;
    const formatOptions = override.formatOptions || userContent.formatOptions;
    const conditionRules = override.conditionRules || userContent.conditionRules;
    const mergePolicy = override.mergePolicy || userContent.mergePolicy || formatOptions?.mergePolicy || pc.mergePolicy;
    return {
      ...pc,
      style: override.style ? { ...pc.style, ...override.style } : pc.style,
      // 结构归面板：新叶轴必须进入指标上下文，旧高级覆盖不能恢复旧父链。
      parents: pc.parents,
      formatOptions: formatOptions || pc.formatOptions,
      conditionRules: conditionRules || pc.conditionRules,
      mergePolicy,
      content: {
        ...pcContent,
        format: userContent.format ?? pcContent.format,
        expand: pcContent.role?.endsWith('-dimension') ? pcContent.expand : userContent.expand ?? pcContent.expand,
        operation: pcContent.role?.endsWith('-dimension') ? pcContent.operation : userContent.operation ?? pcContent.operation,
        formatOptions: formatOptions || pcContent.formatOptions,
        conditionRules: conditionRules || pcContent.conditionRules,
        tooltip: userContent.tooltip ?? pcContent.tooltip,
        mergePolicy,
      },
    };
  });
  for (const ec of extras) {
    if (!ec.panelOwner && !panelIds.has(ec.id) && !panelIdentities.has(identity(ec)) && !isLegacyTotal(ec)) {
      merged.push({ ...ec, regionId: ec.regionId || panel.regions[0]?.id });
    }
  }
  return merged;
}

export function mergeHybridLayoutRules(panel: CellTemplateDocumentV1, extras: readonly LayoutRule[]): LayoutRule[] {
  const key = (r: LayoutRule) => `${r.sheetId}:${r.kind}:${r.index}:${r.range?.startRow},${r.range?.startColumn},${r.range?.endRow},${r.range?.endColumn}`;
  return [...new Map([...panel.layoutRules, ...extras].map((r) => [key(r), r])).values()];
}

export type HybridFormatPreset = 'decimal2' | 'integer' | 'currency' | 'percent' | 'number';
const presets: Record<HybridFormatPreset, { precision: number; useGrouping: boolean }> = {
  decimal2: { precision: 2, useGrouping: false },
  integer: { precision: 0, useGrouping: true },
  currency: { precision: 2, useGrouping: true },
  percent: { precision: 2, useGrouping: false },
  number: { precision: 2, useGrouping: true },
};

export function readHybridFormatPreset(cell: CellDefinition): HybridFormatPreset | 'custom' {
  const opts = resolveCellFormatOptions(cell);
  const format = opts.format === 'percentage' ? 'percent' : opts.format;
  if (!format || !(format in presets)) return 'custom';
  const preset = presets[format as HybridFormatPreset];
  if ((opts.precision !== undefined && opts.precision !== preset.precision) ||
      (opts.useGrouping !== undefined && opts.useGrouping !== preset.useGrouping) ||
      (opts.scale !== undefined && opts.scale !== 1) || opts.prefix || opts.suffix ||
      (opts.negativeFormat && opts.negativeFormat !== 'minus') ||
      opts.emptyDisplay !== undefined || (opts.zeroDisplay && opts.zeroDisplay !== 'zero') || opts.dateFormat) {
    return 'custom';
  }
  return format as HybridFormatPreset;
}

/** 显式选择预设只替换数值格式，单位、缩放等高级属性保持。 */
export function applyHybridFormatPreset(cell: CellDefinition, format: HybridFormatPreset): CellDefinition {
  const formatOptions: CellFormatOptions = { ...resolveCellFormatOptions(cell), format, ...presets[format] };
  return { ...cell, formatOptions, content: { ...cell.content, format, formatOptions } };
}
