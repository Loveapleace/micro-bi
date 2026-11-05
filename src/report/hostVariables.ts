import type { CellTemplateDocumentV1 } from '../report-template/types.js';

export function hostVariableId(value: unknown): string | undefined {
  return typeof value === 'string' ? /^\{\{([^{}]+)\}\}$/u.exec(value)?.[1]?.trim() : undefined;
}
export function referencedHostVariables(doc: CellTemplateDocumentV1): string[] {
  return [...new Set(doc.cells.flatMap(cell => cell.content.kind === 'literal' ? [hostVariableId(cell.content.value)].filter((v): v is string => Boolean(v)) : []))];
}
/** 只生成本次计算副本；源token、用户撤销历史和宿主数据均保持。 */
export function resolveHostVariables(doc: CellTemplateDocumentV1, values?: Readonly<Record<string, unknown>>): CellTemplateDocumentV1 {
  if (!values) return doc;
  return { ...doc, cells: doc.cells.map(cell => {
    if (cell.content.kind !== 'literal') return cell;
    const id = hostVariableId(cell.content.value);
    if (!id) return cell;
    const value = Object.prototype.hasOwnProperty.call(values, id) && values[id] !== undefined ? values[id] : `⟪变量未提供：${id}⟫`;
    const scalar = value === undefined || value === null ? null : ['string', 'number', 'boolean'].includes(typeof value) ? value as string | number | boolean : JSON.stringify(value);
    return { ...cell, content: { ...cell.content, value: scalar } };
  }) };
}
