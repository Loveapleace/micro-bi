import type { CellDefinition, CellTemplateDocumentV1, LiteralCellContent } from './types.js';
/** 面板生成的文字标签可改文案；标题保留独立的内容/范围高级配置。 */
export function isEditableGeneratedText(cell:CellDefinition|null|undefined):cell is CellDefinition&{content:LiteralCellContent} {
    return Boolean(cell?.panelOwner?.generator==='hybrid-panel'&&cell.id!=='title'&&cell.content.kind==='literal');
}
/** 产品读取边界：只接受模式三的受控源，不从自由单元格文档反推面板。 */
export function isGuidedSourceDocument(value: unknown): value is CellTemplateDocumentV1 {
    const doc = value as CellTemplateDocumentV1;
    const guided = doc?.hybridConfig;
    // 复用已有模式三v1读取能力；只有显式Hybrid标识可进入，不能据自由格反推。
    const hasGuidedSource = guided?.version === 2
        ? Array.isArray(guided.rowAxes) && Array.isArray(guided.columnAxes)
        : guided?.version === 1 && typeof guided.showRowTotals === 'boolean';
    return Boolean(doc && doc.documentType === 'cell-template' && doc.schemaVersion === '2.0' && doc.capabilitiesVersion === 'cell-expansion-v2' &&
        hasGuidedSource &&
        Array.isArray(doc.cells) && Array.isArray(doc.regions) && doc.regions.length === 1 && Array.isArray(doc.sheets) && doc.sheets.length > 0);
}
