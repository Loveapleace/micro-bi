import type { CellDefinition, CellTemplateDocumentV1, LayoutRule } from '../report-template/types.js';
import type { DataRecord } from '../engine/types.js';
import { expandCellDrivenTemplate } from '../report-template/cellExpansionEngine.js';
import { relocateSheetFormulaReferences, type FormulaCellPosition } from '../report-template/sheetFormulaEvaluator.js';
import { mergeHybridCells } from './hybridTemplateState.js';

/** Checkbox.Group may return registration order; preserve the user's explicit order and append additions. */
export function reconcileMeasureSelection(current: readonly string[], checked: readonly string[]): string[] {
  const wanted = new Set(checked);
  return [...new Set([...current.filter(key => wanted.has(key)), ...checked])];
}

/** Move a selected metric by identity without changing its configuration. */
export function moveMeasure(current: readonly string[], from: string, to: string): string[] {
  const source = current.indexOf(from), destination = current.indexOf(to);
  if (source < 0 || destination < 0 || source === destination) return [...current];
  const next = [...current];
  next.splice(source, 1);
  next.splice(destination, 0, from);
  return next;
}
/** Ordinary styles/rules already use stable source ids; coordinate dimensions and sheet formulas need relocation. */
export function relocateMeasureCustomizations(
  before: CellTemplateDocumentV1,
  nextPanel: CellTemplateDocumentV1,
  extras: readonly CellDefinition[],
  layouts: readonly LayoutRule[],
  records: readonly DataRecord[],
  variableValues?: Readonly<Record<string, unknown>>,
): { cells: CellDefinition[]; layouts: LayoutRule[] } {
  const afterCells = mergeHybridCells(nextPanel, extras, before.cells), byId = new Map(afterCells.map(cell => [cell.id, cell]));
  const rows = new Map<number, number>(), cols = new Map<number, number>();
  for (const old of before.cells) {
    const next = byId.get(old.id);
    if (!next || old.content.kind !== 'field' || !['measure', 'detail-column', 'total'].includes(old.content.role)) continue;
    if (old.position.row !== next.position.row) rows.set(old.position.row, next.position.row);
    if (old.position.column !== next.position.column) cols.set(old.position.column, next.position.column);
  }
  const nextLayouts = layouts.map(rule => rule.index === undefined ? rule : rule.kind === 'column-width' && cols.has(rule.index)
    ? { ...rule, index: cols.get(rule.index)! } : rule.kind === 'row-height' && rows.has(rule.index) ? { ...rule, index: rows.get(rule.index)! } : rule);
  if (!extras.some(cell => cell.content.kind === 'sheet-formula')) return { cells: [...extras], layouts: nextLayouts };
  const after = { ...before, cells: afterCells, layoutRules: nextPanel.layoutRules };
  const movesBySheet = new Map<string, Map<string, FormulaCellPosition>>();
  for (const sheet of before.sheets) {
    const oldGrid = expandCellDrivenTemplate(before, records, { sheetId: sheet.id, variableValues }).grid,
      nextGrid = expandCellDrivenTemplate(after, records, { sheetId: sheet.id, variableValues }).grid;
    const group = (cells: typeof oldGrid.cells) => {
      const groups = new Map<string, typeof cells>();
      for (const cell of [...cells].sort((a, b) => a.row - b.row || a.col - b.col)) {
        if (!cell.sourceCellId) continue;
        const items = groups.get(cell.sourceCellId) || []; items.push(cell); groups.set(cell.sourceCellId, items);
      }
      return groups;
    };
    const oldGroups = group(oldGrid.cells), nextGroups = group(nextGrid.cells), moves = new Map<string, FormulaCellPosition>();
    for (const [id, oldCells] of oldGroups) {
      const nextCells = nextGroups.get(id);
      if (!nextCells || nextCells.length !== oldCells.length) throw new Error('当前数据布局尚未稳定，请等待数据更新后再排序');
      oldCells.forEach((cell, index) => { const next = nextCells[index]!;
        if (cell.row !== next.row || cell.col !== next.col) moves.set(`${cell.row}:${cell.col}`, { row: next.row, col: next.col });
      });
    }
    movesBySheet.set(sheet.id, moves);
  }
  return { cells: extras.map(cell => cell.content.kind === 'sheet-formula'
    ? { ...cell, content: { ...cell.content, formula: relocateSheetFormulaReferences(cell.content.formula, movesBySheet.get(cell.sheetId) || new Map()) } }
    : cell), layouts: nextLayouts };
}
