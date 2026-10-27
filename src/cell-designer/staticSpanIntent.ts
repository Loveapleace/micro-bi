import type { BiGridModel } from '../report/types.js';
import type { CellTemplateDocumentV1 } from '../report-template/types.js';
import { ownsStaticSpanMerge } from '../report-template/staticSpans.js';

const rangeKey = (m: any) => `${m.startRow}:${m.endRow}:${m.startCol ?? m.startColumn}:${m.endCol ?? m.endColumn}`;

/** 原生取消/恢复合并只修改该规则的合并状态，保留范围、锚点及文字。 */
export function captureStaticSpanIntent(doc: CellTemplateDocumentV1, snapshot: any, grid?: BiGridModel, design = false): CellTemplateDocumentV1 {
  if (!grid?.staticSpanInstances?.length) return doc;
  const cells = doc.cells.map((c) => {
    if (!c.staticSpan?.enabled) return c;
    const instances = grid.staticSpanInstances!.filter((i) => i.templateCellId === c.id);
    let span = { ...c.staticSpan, suppressions: [...c.staticSpan.suppressions] };
    for (const instance of instances) {
      const merges = snapshot?.sheets?.[c.sheetId]?.mergeData;
      if (!Array.isArray(merges) || (instance.range.startRow === instance.range.endRow && instance.range.startCol === instance.range.endCol)) continue;
      const present = merges.some((m: any) => rangeKey(m) === rangeKey(instance.range));
      if (present === instance.merged) continue;
      if (design || (span.repeat === 'once' && span.scope !== 'column-group')) span.merge = present;
      else if (present) span.suppressions = span.suppressions.filter((key) => key !== instance.instanceKey);
      else if (!span.suppressions.includes(instance.instanceKey)) span.suppressions.push(instance.instanceKey);
    }
    return { ...c, staticSpan: span };
  });
  return { ...doc, cells };
}

export function omitStaticSpanProjection(snapshot: any, grid?: BiGridModel): any {
  if (!snapshot?.sheets || !grid?.staticSpanInstances?.length) return snapshot;
  const keys = new Set(grid.staticSpanInstances.map((i) => rangeKey(i.range)));
  const sheets = Object.fromEntries(Object.entries(snapshot.sheets || {}).map(([id, raw]: [string, any]) => [id,
    { ...raw, ...(Array.isArray(raw.mergeData) ? { mergeData: raw.mergeData.filter((m: any) => !keys.has(rangeKey(m))) } : {}) }]));
  return { ...snapshot, sheets };
}

export function restoreStaticSpanSourceMerges(source: CellTemplateDocumentV1, synced: CellTemplateDocumentV1): CellTemplateDocumentV1 {
  const keys = new Set(synced.layoutRules.map((r) => r.id));
  return { ...synced, layoutRules: [...synced.layoutRules, ...source.layoutRules.filter((r) => !keys.has(r.id) && ownsStaticSpanMerge(source, r))] };
}
