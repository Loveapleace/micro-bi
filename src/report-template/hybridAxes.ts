import type { DynamicTransformConfig } from '../engine/types.js';
import type { CellDefinition, CellTemplateDocumentV1, HybridAxisDefinition, TemplateDiagnostic } from './types.js';

export function normalizeHybridAxes(config: DynamicTransformConfig): {
  rowAxes: HybridAxisDefinition[]; columnAxes: HybridAxisDefinition[]; errors: string[];
} {
  const errors: string[] = [];
  const normalize = (axis: 'row' | 'column', time: any, categories: readonly string[] = []) => {
    const result: HybridAxisDefinition[] = [];
    if (time?.field) {
      result.push({ id: `${axis}:time:${time.field}`, fieldKey: time.field, kind: 'time', timeBucket: {
        granularity: time.granularity || 'day', customIntervalDays: time.customIntervalDays,
        timezone: time.timezone, weekStartsOn: time.weekStartsOn, format: time.format,
      } });
    }
    const seen = new Set<string>();
    for (const fieldKey of categories) {
      if (!fieldKey || seen.has(fieldKey)) {
        errors.push(`重复或无效的${axis === 'row' ? '行' : '列'}分类维度：${fieldKey}`);
        continue;
      }
      seen.add(fieldKey);
      result.push({ id: `${axis}:category:${fieldKey}`, fieldKey, kind: 'category' });
    }
    return result;
  };
  return { rowAxes: normalize('row', config.dimensions?.timeBucket, config.dimensions?.categories),
    columnAxes: normalize('column', config.dimensions?.columnTimeBucket, config.dimensions?.columnCategories), errors };
}

export function hybridAxisKey(cell: CellDefinition): string | undefined {
  if (cell.content.kind !== 'field') return undefined;
  const role = cell.content.role;
  if (role !== 'row-dimension' && role !== 'column-dimension') return undefined;
  return `${role}:${cell.content.fieldKey}:${cell.content.timeBucket ? 'time' : 'category'}`;
}

const bucketKey = (bucket: HybridAxisDefinition['timeBucket']) => JSON.stringify(bucket ? [bucket.granularity,
  bucket.customIntervalDays ?? null, bucket.timezone ?? null, bucket.weekStartsOn ?? null, bucket.format ?? null] : null);

/** 旧版按父格链恢复层级；不依据字段采样类型推断时间轴。 */
export function readHybridAxes(doc: CellTemplateDocumentV1): { rowAxes: HybridAxisDefinition[]; columnAxes: HybridAxisDefinition[] } {
  if (doc.hybridConfig?.version === 2) return { rowAxes: doc.hybridConfig.rowAxes, columnAxes: doc.hybridConfig.columnAxes };
  const read = (axis: 'row' | 'column') => {
    const cells = doc.cells.filter((c) => c.content.kind === 'field' && c.content.role === `${axis}-dimension`);
    const depth = (c: CellDefinition, seen = new Set<string>()): number => {
      const parent = cells.find((p) => p.id === c.parents?.[axis]);
      if (!parent || seen.has(parent.id)) return 0;
      seen.add(parent.id);
      return 1 + depth(parent, seen);
    };
    return [...cells].sort((a, b) => depth(a) - depth(b) || a.position[axis === 'row' ? 'column' : 'row'] - b.position[axis === 'row' ? 'column' : 'row']).map((c) => {
      const content = c.content as any;
      return { id: `${axis}:${content.timeBucket ? 'time' : 'category'}:${content.fieldKey}`, fieldKey: content.fieldKey,
        kind: content.timeBucket ? 'time' as const : 'category' as const, timeBucket: content.timeBucket };
    });
  };
  return { rowAxes: read('row'), columnAxes: read('column') };
}

export function preserveSavedAxisOrder(axes: HybridAxisDefinition[], saved: readonly HybridAxisDefinition[]): HybridAxisDefinition[] {
  // 未改变选择时保留旧文档原父链顺序；分类选项重新排序则按新顺序编译。
  const next = axes.map((a) => {
    const old = saved.find((s) => s.id === a.id);
    return old?.timeBucket && a.timeBucket ? { ...a, timeBucket: { ...old.timeBucket,
      ...Object.fromEntries(Object.entries(a.timeBucket).filter(([, v]) => v !== undefined)) } } : a;
  });
  const keys = next.map((a) => a.id);
  const oldCategories = saved.filter((a) => a.kind === 'category').map((a) => a.id);
  const newCategories = axes.filter((a) => a.kind === 'category').map((a) => a.id);
  if (saved.length === axes.length && saved.every((a) => keys.includes(a.id)) && JSON.stringify(oldCategories) === JSON.stringify(newCategories)) {
    return saved.map((a) => next.find((n) => n.id === a.id)!);
  }
  return next;
}

/** 发布契约：所选轴、字段、分桶与父链必须和实际字段格完全一致。 */
export function validateHybridAxes(doc: CellTemplateDocumentV1): TemplateDiagnostic[] {
  if (doc.hybridConfig?.version !== 2) return [];
  const result: TemplateDiagnostic[] = (doc.hybridConfig.configurationErrors || []).map((message) => ({ severity: 'error', code: 'ERR_HYBRID_AXIS_CONFIG', message }));
  for (const axis of ['row', 'column'] as const) {
    const expected = axis === 'row' ? doc.hybridConfig.rowAxes : doc.hybridConfig.columnAxes;
    const cells = doc.cells.filter((c) => c.content.kind === 'field' && c.content.role === `${axis}-dimension` && c.panelOwner);
    let parent: CellDefinition | undefined;
    const ids = new Set<string>();
    for (const spec of expected) {
      if (ids.has(spec.id)) result.push({ severity: 'error', code: 'ERR_HYBRID_AXIS_CONFIG', message: `重复轴身份：${spec.id}` });
      ids.add(spec.id);
      const matching = cells.filter((c) => c.content.kind === 'field' && c.content.fieldKey === spec.fieldKey &&
        bucketKey(c.content.timeBucket) === bucketKey(spec.timeBucket));
      const cell = matching[0];
      if (!cell || matching.length !== 1 || (parent && cell.parents[axis] !== parent.id) ||
        (!parent && cell.parents[axis] && !['none', 'default'].includes(cell.parents[axis]!))) {
        result.push({ severity: 'error', code: 'ERR_HYBRID_AXIS_NOT_COMPILED', message: `维度未完整编译或父链不一致：${spec.fieldKey}（${axis}）`, targetId: cell?.id });
      }
      parent = cell;
    }
    if (cells.length !== expected.length) result.push({ severity: 'error', code: 'ERR_HYBRID_AXIS_COUNT', message: `${axis}轴配置与模板字段数量不一致` });
  }
  return result;
}
