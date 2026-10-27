/**
 * Univer 工作簿快照与单元格报表模板双向同步工具 (syncWorkbookToTemplate.ts)
 * 遵循 Section 18 / DCR-09 / CD-12, 32, 35, 37:
 * 1. 捕获 F2、字符键入、工具栏操作、粘贴等原生 Univer 编辑并同步回写至 CellTemplateDocumentV1
 * 2. 映射文字内容、公式 (=)、样式 (字体/加粗/颜色/对齐/背景)、合并区域 (mergeData -> layoutRules)
 * 3. 动态展开预览态下，映射度量实例修改至 doc.instanceOverrides (DCR-02)
 */
import type {
  CellTemplateDocumentV1,
  CellDefinition,
  CellStyleDefinition,
  LayoutRule,
  InstanceOverride,
  StyleRule,
} from '../report-template/types.js';
import {
  generateTemplateCellId,
  buildInstanceKey,
  encodeMemberTuple,
  computeBindingSignature,
} from '../report-template/identity.js';
import type { BiGridModel } from '../report/types.js';
import { captureStaticSpanIntent, omitStaticSpanProjection, restoreStaticSpanSourceMerges } from './staticSpanIntent.js';
import { publishedStyleToUniver } from '../report/buildBiGrid.js';
import { targetForCell } from '../report-template/presentationTypes.js';

export function extractStyleFromUniver(
  styleIdOrObj: any,
  stylesDict?: Record<string, any>
): CellStyleDefinition | undefined {
  if (!styleIdOrObj) return undefined;
  const s =
    typeof styleIdOrObj === 'string' && stylesDict
      ? stylesDict[styleIdOrObj]
      : styleIdOrObj;
  if (!s || typeof s !== 'object') return undefined;

  const style: CellStyleDefinition = {};
  if (s.ff) style.fontFamily = s.ff;
  if (typeof s.fs === 'number') style.fontSize = s.fs;
  if (s.bl === 1 || s.bl === true) style.bold = true;
  else if (s.bl === 0 || s.bl === false) style.bold = false;

  if (s.it === 1 || s.it === true) style.italic = true;
  else if (s.it === 0 || s.it === false) style.italic = false;

  if (s.cl?.rgb) style.color = s.cl.rgb;
  if (s.bg?.rgb) style.backgroundColor = s.bg.rgb;

  if (s.ht === 1) style.textAlign = 'left';
  else if (s.ht === 2) style.textAlign = 'center';
  else if (s.ht === 3) style.textAlign = 'right';

  if (s.vt === 1) style.verticalAlign = 'top';
  else if (s.vt === 2) style.verticalAlign = 'middle';
  else if (s.vt === 3) style.verticalAlign = 'bottom';

  return Object.keys(style).length > 0 ? style : undefined;
}

export function syncDocumentFromWorkbookSnapshot(
  doc: CellTemplateDocumentV1,
  snapshot: any,
  mode: 'design' | 'preview',
  grid?: BiGridModel,
  dataRevision?: string | number
): CellTemplateDocumentV1 {
  const source = captureStaticSpanIntent(doc, snapshot, grid, mode === 'design');
  doc = source;
  snapshot = omitStaticSpanProjection(snapshot, grid);
  if (grid?.staticSpanInstances?.length) {
    const key = (m: any) => `${m.startRow}:${m.endRow}:${m.startCol}:${m.endCol}`;
    const projected = new Set(grid.staticSpanInstances.map((i) => key(i.range)));
    grid = { ...grid, merges: grid.merges.filter((m) => !projected.has(key(m))) };
  }
  if (!snapshot || !snapshot.sheets) return doc;

  const nextCells: CellDefinition[] = doc.cells.map((c) => ({
    ...c,
    content: { ...c.content },
    style: c.style ? { ...c.style } : undefined,
  }));
  const nextLayoutRules: LayoutRule[] = [...doc.layoutRules];
  let nextStyleRules: StyleRule[] = [...(doc.styleRules || [])];
  const nextOverrides: InstanceOverride[] = [...(doc.instanceOverrides || [])];
  let nextMergeConfig = doc.mergeConfig ? JSON.parse(JSON.stringify(doc.mergeConfig)) : undefined;

  const rawStyles = snapshot.styles || {};
  const rawSheets = snapshot.sheets || {};
  const sheetOrder: string[] = snapshot.sheetOrder || Object.keys(rawSheets);

  for (const sheetId of sheetOrder) {
    const rawSheet = rawSheets[sheetId];
    if (!rawSheet) continue;

    // 1. 同步合并单元格意图 (DCR-01, DCR-09, R3-04, CER-17, CER-21)
    if (Array.isArray(rawSheet.mergeData)) {
      const nonMergeRules = nextLayoutRules.filter(
        (r) => !(r.sheetId === sheetId && r.kind === 'merge')
      );

      const sheetPolicies = (doc.mergeConfig?.policies || []).filter(
        (p) => (p.sheetId || 'sheet-1') === sheetId && p.enabled !== false
      );

      if (mode === 'preview' && sheetPolicies.length > 0 && grid?.merges) {
        // If snapshot has 0 merges while preview grid had dynamic merges -> user explicitly cancelled merges (CER-21)
        if (rawSheet.mergeData.length === 0 && grid.merges.length > 0) {
          if (!nextMergeConfig) {
            nextMergeConfig = JSON.parse(JSON.stringify(doc.mergeConfig));
          }
          for (const p of nextMergeConfig.policies) {
            if ((p.sheetId || 'sheet-1') === sheetId) {
              p.enabled = false;
            }
          }
          nextLayoutRules.length = 0;
          nextLayoutRules.push(...nonMergeRules);
        } else {
          // If snapshot has merges that were produced by dynamic policies, don't solidify them into manual LayoutRules (CER-17)
          const dynamicMergeSet = new Set(
            grid.merges.map((m) => `${m.startRow}:${m.endRow}:${m.startCol}:${m.endCol}`)
          );
          const manualMerges = rawSheet.mergeData.filter(
            (m: any) => !dynamicMergeSet.has(`${m.startRow}:${m.endRow}:${m.startColumn}:${m.endColumn}`)
          );

          const manualRules: LayoutRule[] = manualMerges.map((m: any, idx: number) => ({
            id: `merge-${sheetId}-manual-${idx}`,
            kind: 'merge' as const,
            sheetId,
            range: {
              startRow: m.startRow,
              endRow: m.endRow,
              startColumn: m.startColumn,
              endColumn: m.endColumn,
            },
            source: 'user',
          }));

          nextLayoutRules.length = 0;
          nextLayoutRules.push(...nonMergeRules, ...manualRules);
        }
      } else {
        const mergeRules: LayoutRule[] = rawSheet.mergeData.map((m: any, idx: number) => {
          let semanticSelector: any = undefined;

          // 查找已有合并规则中相同范围或相同 ID 的规则，保留已持久化的业务选择器和元数据 (R4-M1, R4-01, R4-02)
          const existingRule = (doc.layoutRules || []).find(
            (r) =>
              r.sheetId === sheetId &&
              r.kind === 'merge' &&
              r.range?.startRow === m.startRow &&
              r.range?.endRow === m.endRow &&
              r.range?.startColumn === m.startColumn &&
              r.range?.endColumn === m.endColumn
          );

          if (grid?.bindings && grid.bindings.length > 0) {
            const covered = grid.bindings.filter(
              (b) =>
                b.target.row >= m.startRow &&
                b.target.row <= m.endRow &&
                b.target.column >= m.startColumn &&
                b.target.column <= m.endColumn
            );
            const master = grid.bindings.find(
              (b) => b.target.row === m.startRow && b.target.column === m.startColumn
            );
            if (covered.length > 0 && master) {
              semanticSelector = {
                regionId: (master as any).regionId || doc.regions[0]?.id,
                masterSignature: computeBindingSignature(master),
                coveredSignatures: covered.map(computeBindingSignature).sort(),
                metricDirection: doc.regions[0]?.metricDirection,
              };
            }
          }

          // 如果在 design 态没有运行时 bindings，但已有规则具有有效 selector，必须原样保留
          if (!semanticSelector && existingRule?.semanticSelector) {
            semanticSelector = existingRule.semanticSelector;
          }

          return {
            id: existingRule?.id || `merge-${sheetId}-${idx}`,
            kind: 'merge' as const,
            sheetId,
            range: {
              startRow: m.startRow,
              endRow: m.endRow,
              startColumn: m.startColumn,
              endColumn: m.endColumn,
            },
            ...(existingRule?.source ? { source: existingRule.source } : {}),
            ...(existingRule?.sequence !== undefined ? { sequence: existingRule.sequence } : {}),
            ...(semanticSelector ? { semanticSelector } : {}),
          };
        });
        nextLayoutRules.length = 0;
        nextLayoutRules.push(...nonMergeRules, ...mergeRules);
      }
    }

    // 2. 遍历工作表单元格数据并映射回源模板 (DCR-09, DCR-02)
    const cellData = rawSheet.cellData || {};
    for (const [rStr, rowObj] of Object.entries(cellData)) {
      const r = Number(rStr);
      if (!rowObj || typeof rowObj !== 'object') continue;

      for (const [cStr, cellVal] of Object.entries(rowObj as Record<string, any>)) {
        const c = Number(cStr);
        if (!cellVal) continue;

        const v = cellVal.v;
        const f = cellVal.f;
        const s = cellVal.s;
        const mappedStyle = extractStyleFromUniver(s, rawStyles);

        if (mode === 'design') {
          const existing = nextCells.find(
            (item) =>
              item.sheetId === sheetId &&
              item.position.row === r &&
              item.position.column === c
          );

          if (existing) {
            // 已存在模板单元格：同步内容与样式
            if (f) {
              existing.content = { kind: 'sheet-formula', formula: f };
            } else if (v === null || v === '') {
              if (existing.content.kind === 'literal') {
                existing.content.value = v;
              }
            } else if (v !== undefined) {
              if (existing.content.kind === 'literal') {
                existing.content.value = v;
              } else if (existing.content.kind === 'field') {
                // 字段格不通过原生快照回写显示名：绑定与显示名统一在属性面板维护，
                // 避免“键入文字静默替换绑定”导致字段丢失（遵循 §4.2）。
              } else if (existing.content.kind === 'business-formula') {
                const str = String(v);
                if (str.startsWith('=[') && str.endsWith(']')) {
                  existing.content.displayName = str.slice(2, -1);
                }
              } else if (existing.content.kind === 'sheet-formula') {
                existing.content.formula = String(v);
              }
            }

            if (mappedStyle) {
              const projected = grid?.cells.find(t=>t.row===r&&t.col===c);
              if (cellVal.custom?.biProjection && projected) {
                const expected=extractStyleFromUniver(publishedStyleToUniver(projected.style||{}))||{};
                const delta:CellStyleDefinition={};
                for(const prop of new Set([...Object.keys(mappedStyle),...Object.keys(expected)]))
                  if(JSON.stringify((mappedStyle as any)[prop])!==JSON.stringify((expected as any)[prop]))(delta as any)[prop]=(mappedStyle as any)[prop];
                if(Object.keys(delta).length){
                  const active=nextStyleRules.filter(x=>x.scope==='template-cell'&&x.targetId===existing.id).sort((a,b)=>b.priority-a.priority)[0];
                  const id=active?.id||`native-style-${sheetId}-${existing.id}`;
                  const next={...active,id,sheetId,targetId:existing.id,target:targetForCell(existing),scope:'template-cell' as const,presetId:undefined,style:{...active?.style,...delta},priority:active?.priority??nextStyleRules.length};
                  if('backgroundColor' in delta && delta.backgroundColor===undefined)next.noFill=true;
                  nextStyleRules=nextStyleRules.filter(x=>x.id!==id);nextStyleRules.push(next);
                }
              } else existing.style = { ...(existing.style || {}), ...mappedStyle };
            }
          } else if ((v !== undefined && v !== null && v !== '') || f) {
            // 过滤：绝不将内部渲染的字段占位符 "{...}" 或 "=[...]" 错误固化为普通静态字面量单元格
            const strVal = String(v ?? '').trim();
            const isTemplatePlaceholder = /^\{.*\}$/.test(strVal) || /^=\[.*\]$/.test(strVal);
            if (isTemplatePlaceholder) {
              continue;
            }

            // 全新键入的自由单元格 (例如标题、补充说明)
            const newCell: CellDefinition = {
              id: generateTemplateCellId(),
              sheetId,
              position: { row: r, column: c },
              content:
                f || strVal.startsWith('=')
                  ? { kind: 'sheet-formula', formula: f || strVal }
                  : { kind: 'literal', value: v },
              parents: { row: null, column: null },
              ...(mappedStyle ? { style: mappedStyle } : {}),
            };
            nextCells.push(newCell);
          }
        } else if (mode === 'preview' && grid?.bindings) {
          // 预览态：检查是否修改了业务实例度量单元格 (DCR-02)
          const binding = grid.bindings.find(
            (b) => b.target.row === r && b.target.column === c
          );
          if (binding && v !== undefined && v !== null) {
            const gridCell = grid.cells.find((cell) => cell.row === r && cell.col === c);
            const currentDisplayVal = gridCell?.value;
            // 只有与当前展示值不同时，才作为覆盖项
            if (v === currentDisplayVal && (!f || f === (gridCell as any)?.formula)) {
              continue;
            }

            const overrideVal = typeof v === 'number' ? v : Number(v) || v;
            const rowTuple = (binding.semantic?.rowPath || []).map((p: any) =>
              p.field ? `${p.field}=${p.memberKey}` : p.memberKey
            );
            const colTuple = (binding.semantic?.columnPath || []).map((p: any) =>
              p.field ? `${p.field}=${p.memberKey}` : p.memberKey
            );
            const targetCell = doc.cells.find(
              (cell) =>
                (cell.content.kind === 'field' && cell.content.metricId === binding.semantic?.metricId) ||
                (cell.content.kind === 'business-formula' && cell.content.metricId === binding.semantic?.metricId)
            );
            const templateCellId = (binding as any).templateCellId || targetCell?.id || binding.semantic?.metricId || 'metric';
            const regionId = (binding as any).regionId || targetCell?.regionId || doc.regions[0]?.id || 'r1';
            const role = binding.semantic?.role || 'metric-value';

            const instKey =
              (binding as any).instanceKey ||
              buildInstanceKey({
                templateCellId,
                regionId,
                rowPath: encodeMemberTuple(rowTuple),
                columnPath: encodeMemberTuple(colTuple),
                metricId: binding.semantic?.metricId || 'metric',
                role,
              });

            const existingIdx = nextOverrides.findIndex(
              (o) => o.instanceKey === instKey
            );
            const existingOverride = existingIdx >= 0 ? nextOverrides[existingIdx] : undefined;
            // 连续编辑时保留最初的事实基线 (R3-01, FR-02, FR-03, R4-03, R4-06)
            const originalBaseValue =
              existingOverride?.originalBaseValue !== undefined
                ? existingOverride.originalBaseValue
                : ((binding as any).originalValue ?? currentDisplayVal);

            const overrideItem: InstanceOverride = {
              instanceKey: instKey,
              templateCellId,
              originalBaseValue,
              overrideValue: overrideVal,
              ...(f ? { formula: f } : {}),
              // 数据版本与模板版本分离：记录覆盖发生时的数据版本（未显式提供时回退时间戳）
              dataRevision: dataRevision ?? Date.now(),
              status: 'active',
            };
            if (existingIdx >= 0) {
              nextOverrides[existingIdx] = overrideItem;
            } else {
              nextOverrides.push(overrideItem);
            }
          }
        }
      }
    }
  }

  return restoreStaticSpanSourceMerges(source, {
    ...doc,
    templateRevision: (doc.templateRevision || 0) + 1,
    cells: nextCells,
    layoutRules: nextLayoutRules,
    styleRules: nextStyleRules,
    instanceOverrides: nextOverrides,
    ...(nextMergeConfig ? { mergeConfig: nextMergeConfig } : {}),
  });
}
