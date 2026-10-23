import type { BiGridModel } from '../report/types.js';
import type { CellDefinition, CellTemplateDocumentV1, MergeConfigV1 } from '../report-template/types.js';
import { hybridAxisKey } from '../report-template/hybridAxes.js';
import { computeBindingSignature } from '../report-template/identity.js';
import { syncDocumentFromWorkbookSnapshot } from './syncWorkbookToTemplate.js';

export function mergeRetainedHybridConfig(previous: MergeConfigV1 | undefined, active: MergeConfigV1 | undefined): MergeConfigV1 | undefined {
  if (!active) return previous;
  return { ...active,
    policies: [...new Map([...(previous?.policies || []), ...active.policies].map((p) => [p.id, p])).values()],
    suppressions: [...new Map([...(previous?.suppressions || []), ...active.suppressions].map((s) => [s.id, s])).values()] };
}

export function rebindHybridMergeConfig(config: MergeConfigV1 | undefined, oldCells: readonly CellDefinition[], panel: CellTemplateDocumentV1): MergeConfigV1 | undefined {
  if (!config) return undefined;
  const policyIds = new Map<string, string>();
  const policies = config.policies.map((p) => {
    if (p.target.kind !== 'template-cell') return p;
    const previousId = p.target.templateCellId;
    const previous = oldCells.find((c) => c.id === previousId);
    const current = panel.cells.find((c) => c.id === previousId || (previous && hybridAxisKey(previous) && hybridAxisKey(c) === hybridAxisKey(previous)));
    if (!current) return p; // 暂不在布局内的规则保留为休眠配置。
    const id = p.id.startsWith('merge-policy-') ? `merge-policy-${current.id}` : p.id;
    policyIds.set(p.id, id);
    return { ...p, id, target: { ...p.target, templateCellId: current.id } };
  });
  return { ...config, policies, suppressions: config.suppressions.map((s) => ({ ...s, policyId: policyIds.get(s.policyId) || s.policyId })) };
}

/** 预览投影的取消按来源还原为源意图，而不是保存当前坐标的合并结果。 */
export function captureHybridPreviewMerges(doc: CellTemplateDocumentV1, snapshot: any, grid: BiGridModel): CellTemplateDocumentV1 {
  const sheetId = doc.sheets[0]?.id || 'sheet-1';
  const merges = snapshot?.sheets?.[sheetId]?.mergeData;
  if (!Array.isArray(merges) || !doc.mergeConfig || !grid.mergeOrigins) return doc;
  const key = (m: any) => `${m.startRow}:${m.endRow}:${m.startCol ?? m.startColumn}:${m.endCol ?? m.endColumn}`;
  const actual = new Set(merges.map(key));
  const config: MergeConfigV1 = { ...doc.mergeConfig, policies: [...doc.mergeConfig.policies], suppressions: [...doc.mergeConfig.suppressions] };
  const disabled = new Set(doc.hybridConfig?.version === 2 ? doc.hybridConfig.disabledLayoutRuleIds : []);
  for (const origin of grid.mergeOrigins) {
    if (actual.has(key(origin.range))) continue;
    if (origin.origin === 'static-layout' || origin.origin === 'manual-instance') {
      disabled.add(origin.ruleId);
      continue;
    }
    const id = `unmerge:${origin.ruleId}:${origin.groupContextKey || key(origin.range)}`;
    if (config.suppressions.some((s) => s.id === id)) continue;
    if (origin.origin === 'group-span' && origin.groupContextKey) {
      config.suppressions.push({ id, policyId: origin.ruleId, policyKind: 'group-span', scope: 'group-context',
        groupContextKey: origin.groupContextKey, source: 'user', sequence: config.suppressions.length + 1 });
    } else {
      const cellKeys = grid.bindings.filter((b) => b.target.row >= origin.range.startRow && b.target.row <= origin.range.endRow &&
        b.target.column >= origin.range.startCol && b.target.column <= origin.range.endCol).map((b) => (b as any).instanceKey).filter(Boolean);
      config.suppressions.push({ id, policyId: origin.ruleId, policyKind: origin.origin, scope: 'instance-cells', cellKeys,
        source: 'user', sequence: config.suppressions.length + 1 });
    }
  }
  const generated = new Set(grid.merges.map(key));
  const manualOnly = { ...snapshot, sheets: { ...snapshot.sheets, [sheetId]: { ...snapshot.sheets[sheetId], mergeData: merges.filter((m: any) => !generated.has(key(m))) } } };
  const synced = syncDocumentFromWorkbookSnapshot(doc, manualOnly, 'preview', grid);
  const rules = doc.layoutRules.filter((r) => !disabled.has(r.id));
  for (const rule of synced.layoutRules.filter((r) => r.kind === 'merge' && r.range)) {
    if (rules.some((r) => r.kind === 'merge' && r.range && key(r.range) === key(rule.range))) continue;
    const range = rule.range!;
    const bindings = grid.bindings.filter((b) => b.target.row >= range.startRow && b.target.row <= range.endRow &&
      b.target.column >= range.startColumn && b.target.column <= range.endColumn);
    const master = bindings.find((b) => b.target.row === range.startRow && b.target.column === range.startColumn);
    const source = master && doc.cells.find((c) => c.id === (master as any).templateCellId);
    const shiftR = source && master ? source.position.row - master.target.row : 0;
    const shiftC = source && master ? source.position.column - master.target.column : 0;
    rules.push({ ...rule, id: `hybrid-merge:${sheetId}:${key(range)}`, ...(master && bindings.some((b) => b.semantic.field) ? { semanticSelector: {
      regionId: (master as any).regionId || doc.regions[0]?.id, masterSignature: computeBindingSignature(master),
      coveredSignatures: bindings.map(computeBindingSignature).sort(),
    } } : { range: { startRow: range.startRow + shiftR, endRow: range.endRow + shiftR,
      startColumn: range.startColumn + shiftC, endColumn: range.endColumn + shiftC } }) });
  }
  return { ...doc, mergeConfig: config, layoutRules: rules,
    ...(doc.hybridConfig?.version === 2 ? { hybridConfig: { ...doc.hybridConfig, disabledLayoutRuleIds: [...disabled] } } : {}) };
}
