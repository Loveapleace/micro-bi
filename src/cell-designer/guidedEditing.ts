import type { CellTemplateDocumentV1 } from '../report-template/types.js';
import type { BiGridModel } from '../report/types.js';
import type { FUniver } from '../univer/adapter.js';
import { isUniverDoubleClick } from './univerEvents.js';
import { isEditableGeneratedText } from '../report-template/guidedSource.js';
import { readUniverLiteralValue } from './univerValues.js';
export interface GuidedRange {
    sheetId: string;
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
}
export function guidedDataRanges(panel: CellTemplateDocumentV1): GuidedRange[] {
    const ranges = new Map<string, GuidedRange>();
    for (const c of panel.cells) {
        if (!c.regionId || c.id === 'title' || c.staticSpan)
            continue;
        const key = c.sheetId + ':' + c.regionId, p = c.position, old = ranges.get(key);
        if (old) {
            old.startRow = Math.min(old.startRow, p.row);
            old.endRow = Math.max(old.endRow, p.row);
            old.startColumn = Math.min(old.startColumn, p.column);
            old.endColumn = Math.max(old.endColumn, p.column);
        }
        else
            ranges.set(key, { sheetId: c.sheetId, startRow: p.row, endRow: p.row, startColumn: p.column, endColumn: p.column });
    }
    return [...ranges.values()];
}
const overlaps = (a: GuidedRange, b: GuidedRange) => a.sheetId === b.sheetId && a.startRow <= b.endRow && a.endRow >= b.startRow && a.startColumn <= b.endColumn && a.endColumn >= b.startColumn;
export function guidedCellProtected(panel: CellTemplateDocumentV1, row: number, column: number, sheetId = 'sheet-1'): boolean {
    return guidedDataRanges(panel).some(r => overlaps(r, { sheetId, startRow: row, endRow: row, startColumn: column, endColumn: column }));
}
/** 内容保护与区域结构保护分开：预设文字可以改名，字段值和区域内空隙仍受控。 */
export function guidedCellContentProtected(panel:CellTemplateDocumentV1,row:number,column:number,sheetId='sheet-1'):boolean {
    return guidedCellProtected(panel,row,column,sheetId)&&!panel.cells.some(c=>c.sheetId===sheetId&&c.position.row===row&&c.position.column===column&&isEditableGeneratedText(c));
}
const positionKey=(sheetId:string,row:number,column:number)=>`${sheetId}:${row}:${column}`;
function overlapsProtectedContent(panel:CellTemplateDocumentV1,range:GuidedRange):boolean {
    const labels=new Set(panel.cells.filter(isEditableGeneratedText).map(c=>positionKey(c.sheetId,c.position.row,c.position.column)));
    for(const bound of guidedDataRanges(panel)){
        if(!overlaps(bound,range))continue;
        for(let row=Math.max(bound.startRow,range.startRow);row<=Math.min(bound.endRow,range.endRow);row++)
            for(let col=Math.max(bound.startColumn,range.startColumn);col<=Math.min(bound.endColumn,range.endColumn);col++)
                if(!labels.has(positionKey(bound.sheetId,row,col)))return true;
    }
    return false;
}
function containsFormula(value:unknown):boolean {
    if(!value||typeof value!=='object')return false;
    const cell=value as any;
    return Boolean(cell.f||cell.si)||Object.values(cell).some(containsFormula);
}
/** 原生快照是外观和静态内容的编辑载体，不能覆盖系统数据区的内容。 */
export function protectGuidedSnapshot(snapshot: any, panel: CellTemplateDocumentV1, grid: BiGridModel, mode: 'design' | 'preview'): any {
    if (!snapshot?.sheets)
        return snapshot;
    const next = structuredClone(snapshot), at = new Map(grid.cells.map(c => [`${c.row}:${c.col}`, c])), ranges = guidedDataRanges(panel);
    for (const [sheetId, sheet] of Object.entries(next.sheets) as [
        string,
        any
    ][]) {
        for (const [rowKey, row] of Object.entries(sheet.cellData || {}) as [
            string,
            any
        ][]) {
            for (const [colKey, cell] of Object.entries(row) as [
                string,
                any
            ][]) {
                const r = Number(rowKey), c = Number(colKey);
                if (!cell || mode === 'design' && !ranges.some(b => overlaps(b, { sheetId, startRow: r, endRow: r, startColumn: c, endColumn: c })))
                    continue;
                const original = at.get(`${r}:${c}`);
                const source=panel.cells.find(source=>source.sheetId===sheetId&&source.position.row===r&&source.position.column===c);
                if(mode==='design'&&isEditableGeneratedText(source)&&!cell.f&&!cell.si){
                    const fullSheet=Number.isInteger(sheet.rowCount)&&Number.isInteger(sheet.columnCount);
                    const hasValue=fullSheet||Object.prototype.hasOwnProperty.call(cell,'v')||typeof cell.p?.body?.dataStream==='string'||cell.custom?.biProjection;
                    row[colKey]={...cell,...(hasValue?{v:readUniverLiteralValue(cell)??null,p:null}:{}),f:null,si:null};continue;
                }
                row[colKey] = { ...cell, v: original?.value ?? null, t: typeof original?.value === 'number' ? 2 : typeof original?.value === 'boolean' ? 3 : 1, f: original?.formula || null, si:null, p: null };
            }
        }
    }
    return next;
}
function getRanges(params: any, selection: GuidedRange): GuidedRange[] {
    const sheetId = params?.subUnitId || params?.sheetId || selection.sheetId;
    const inputs = [...(Array.isArray(params?.ranges) ? params.ranges : []), ...(Array.isArray(params?.selections) ? params.selections.map((s: any) => s.range || s) : []), params?.range, params?.fromRange, params?.toRange].filter(Boolean);
    // SDK批量粘贴/清空mutation只有绝对cellValue坐标，实际影响范围可大于当前单格选区。
    for (const [row, cols] of Object.entries(params?.cellValue || {}) as [
        string,
        any
    ][]) {
        const columns = Object.keys(cols || {}).map(Number).filter(Number.isInteger);
        if (Number.isInteger(Number(row)) && columns.length)
            inputs.push({ startRow: Number(row), endRow: Number(row), startColumn: Math.min(...columns), endColumn: Math.max(...columns) });
    }
    return inputs.length ? inputs.map(r => ({ sheetId, startRow: r.startRow ?? selection.startRow, endRow: r.endRow ?? r.startRow ?? selection.endRow,
        startColumn: r.startColumn ?? selection.startColumn, endColumn: r.endColumn ?? r.startColumn ?? selection.endColumn })) : [selection];
}
/** SDK合并会清空被覆盖格；受控数据只接受合并几何和样式，保留底层内容供公式计算。 */
function protectMergeMutation(panel: CellTemplateDocumentV1, mode: 'design' | 'preview', command: {
    id: string;
    params?: any;
}, sheetId: string): boolean {
    const params = command.params;
    if (command.id !== 'sheet.mutation.set-range-values' || !/^sheet\.command\.(?:add|remove)-worksheet-merge(?:-|$)/.test(params?.trigger || '') || !params?.cellValue)
        return false;
    const targetSheet = params.subUnitId || params.sheetId || sheetId;
    const bounds = guidedDataRanges(panel);
    params.cellValue = Object.fromEntries(Object.entries(params.cellValue).map(([row, cols]: [
        string,
        any
    ]) => [row,
        Object.fromEntries(Object.entries(cols || {}).map(([column, cell]: [
            string,
            any
        ]) => [column,
            mode === 'preview' || bounds.some(b => overlaps(b, { sheetId: targetSheet, startRow: Number(row), endRow: Number(row), startColumn: Number(column), endColumn: Number(column) }))
                ? cell && Object.prototype.hasOwnProperty.call(cell, 's') ? { s: cell.s } : {}
                : cell]))]));
    return true;
}
/** SDK按原公式身份提交计算结果；仅允许v/t，公式本身仍由SDK的sourceFormulaData校验。 */
function isFormulaResultMutation(command: {
    id: string;
    params?: any;
}): boolean {
    if (command.id !== 'sheet.mutation.set-range-values' || !command.params?.sourceFormulaData || !command.params.cellValue)
        return false;
    let count = 0;
    for (const [row, cols] of Object.entries(command.params.cellValue) as [
        string,
        any
    ][]) {
        for (const [column, cell] of Object.entries(cols || {}) as [
            string,
            any
        ][]) {
            const source = command.params.sourceFormulaData[row]?.[column];
            if (!cell || typeof cell !== 'object' || Object.keys(cell).some(k => k !== 'v' && k !== 't') || !(source?.f || source?.si))
                return false;
            count++;
        }
    }
    return count > 0;
}
function clipboardRange(event: {
    text?: string;
    html?: string;
}, selection: GuidedRange): GuidedRange {
    const lines = (event.text || '').replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    let rows = lines.length, columns = Math.max(...lines.map(line => line.split('\t').length));
    if (event.html && typeof DOMParser !== 'undefined') {
        const html = new DOMParser().parseFromString(event.html, 'text/html');
        const trs = Array.from(html.querySelectorAll('tr'));
        rows = Math.max(rows, trs.length);
        columns = Math.max(columns, ...trs.map(tr => Array.from(tr.querySelectorAll('td,th')).reduce((n, td) => n + Math.max(1, Number(td.getAttribute('colspan')) || 1), 0)));
    }
    return { ...selection, endRow: Math.max(selection.endRow, selection.startRow + rows - 1), endColumn: Math.max(selection.endColumn, selection.startColumn + columns - 1) };
}
export function unsupportedToolbarCommand(command:{id:string;params?:any}):string|undefined{
    if(command.id==='sheet.command.set-text-rotation'||command.id==='sheet.command.set-shrink-to-fit')return '当前VTable展示暂不支持文本旋转与缩小字体填充';
    const style=command.params?.style;
    const borderType=command.params?.value?.type||command.params?.value;
    if(command.id.startsWith('sheet.command.set-border')&&typeof borderType==='string'&&['tlbr','tlbc_tlmr','tlbr_tlbc_tlmr','bl_tr','mltr_bctr'].includes(borderType))return '当前VTable展示暂不支持单元格对角线边框';
    if(command.id==='sheet.command.set-text-wrap'&&command.params?.value===1||command.id==='sheet.command.set-style'&&style?.type==='tb'&&style.value===1)return '当前报表支持自动换行与截断，暂不支持跨单元格文本溢出';
    if(command.id==='sheet.command.set-style'&&['tr','stf'].includes(style?.type))return '当前VTable展示暂不支持文本旋转与缩小字体填充';
    return undefined;
}
export function shouldBlockGuidedCommand(panel: CellTemplateDocumentV1, mode: 'design' | 'preview', command: {
    id: string;
    params?: any;
}, selection: GuidedRange): boolean {
    const id = command.id.toLowerCase(), params = command.params, ranges = getRanges(params, selection), bounds = guidedDataRanges(panel);
    if(unsupportedToolbarCommand(command))return true;
    if (isFormulaResultMutation(command))
        return false;
    if (/(?:insert|remove|delete|move|copy|duplicate|rename)-sheet|set-worksheet-(?:name|order|hidden|show|row-count|column-count)$/.test(id))
        return true;
    if (/(?:insert|delete)-range-move/.test(id))
        return mode === 'preview' || ranges.some(r => bounds.some(b => overlaps(r, b)));
    if (/(?:insert|remove|delete|move)-(?:row|col)/.test(id)) {
        if (mode === 'preview')
            return true;
        const row = /-(?:row)/.test(id), insert = id.includes('insert'), isMove = /(?:^|\.)move-/.test(id);
        return ranges.some(r => bounds.some(b => {
            if (r.sheetId !== b.sheetId)
                return false;
            if (isMove)
                return true;
            let start = row ? r.startRow : r.startColumn, end = row ? r.endRow : r.endColumn;
            if (id.endsWith('-after')) {
                start = end + 1;
                end = start;
            }
            const first = row ? b.startRow : b.startColumn, last = row ? b.endRow : b.endColumn;
            return insert ? start > first && start <= last : start <= last && end >= first;
        }));
    }
    const styleOnly = (value: any): boolean => {
        if (!value || typeof value !== 'object')
            return false;
        if ('v' in value || 'f' in value || 'p' in value)
            return false;
        if ('s' in value)
            return true;
        const children = Object.values(value);
        return children.length > 0 && children.every(styleOnly);
    };
    // Command使用value，已安装SDK的字体/颜色mutation使用cellValue。
    if (mode === 'design' && id.includes('set-range-values') && styleOnly(params?.value ?? params?.cellValue))
        return false;
    const values = /paste|cut|set-range-values|clear-(?:selection|range)(?:-content|-all)?$|auto-fill|move-range/.test(id);
    if (values)
        return mode === 'preview' || ranges.some(r => overlapsProtectedContent(panel,r)) ||
            containsFormula(params?.value??params?.cellValue)&&ranges.some(r=>panel.cells.some(c=>isEditableGeneratedText(c)&&overlaps(r,{sheetId:c.sheetId,startRow:c.position.row,endRow:c.position.row,startColumn:c.position.column,endColumn:c.position.column})));
    if (mode === 'preview' && /^sheet\.command\.(?:set-|clear-)/.test(id) && !/selection|freeze|zoom|scroll/.test(id))
        return true;
    return false;
}
/** 公共SDK事件前置保护；程序投影及源历史回放继续沿既有事务标记放行。 */
export function attachGuidedEditingGuard(api: FUniver, getState: () => {
    panel: CellTemplateDocumentV1;
    mode: 'design' | 'preview';
}, onBlocked: () => void, onUnsupported:(reason:string)=>void=onBlocked): () => void {
    const a = api as any, disposers: {
        dispose: () => void;
    }[] = [];
    const selection = (): GuidedRange => {
        const sheet = a.getActiveWorkbook()?.getActiveSheet(), r = sheet?.getSelection()?.getActiveRange()?.getRange?.() || {};
        return { sheetId: sheet?.getSheetId?.() || 'sheet-1', startRow: r.startRow ?? 0, endRow: r.endRow ?? r.startRow ?? 0, startColumn: r.startColumn ?? 0, endColumn: r.endColumn ?? r.startColumn ?? 0 };
    };
    const bypass = () => a.__isProgrammaticWrite || a.__biTransaction || a.__biSourceHistoryReplay;
    const stop = (e: any) => { if (typeof e.cancel === 'function')
        e.cancel();
    else
        e.cancel = true; onBlocked(); };
    const listen = (name: any, fn: (e: any) => void) => { if (name) {
        const d = a.addEvent(name, fn);
        if (d?.dispose)
            disposers.push(d);
    } };
    listen(a.Event?.BeforeSheetEditStart, e => {
        if (bypass())
            return;
        const state = getState(), s = e.worksheet?.getSheetId?.() || selection().sheetId;
        if (state.mode === 'preview') { stop(e); return; }
        // 设计态双击由业务桥接决定高级配置或普通输入；预览不因双击例外放开。
        if (isUniverDoubleClick(e)) return;
        if (guidedCellContentProtected(state.panel, e.row, e.column, s))
            stop(e);
    });
    listen(a.Event?.BeforeClipboardPaste, e => { if (bypass())
        return; const state = getState(), range = clipboardRange(e, selection()); if (state.mode === 'preview' || overlapsProtectedContent(state.panel,range))
        stop(e); });
    listen(a.Event?.BeforeCommandExecute, e => {
        if (bypass())
            return;
        const unsupported=unsupportedToolbarCommand(e);
        if(unsupported){if(typeof e.cancel==='function')e.cancel();else e.cancel=true;onUnsupported(unsupported);return;}
        const state = getState(), selected = selection();
        if (e.id === 'sheet.command.add-worksheet-merge' && e.params) {
            const ranges = getRanges(e.params, selected), bounds = guidedDataRanges(state.panel);
            // 数据原值不会被删除，跳过SDK与实际行为不符的“丢弃其他值”确认；静态区保留原生提示。
            if (state.mode === 'preview' || ranges.every(r => bounds.some(b => b.sheetId === r.sheetId && b.startRow <= r.startRow && b.endRow >= r.endRow && b.startColumn <= r.startColumn && b.endColumn >= r.endColumn)))
                e.params.defaultMerge = true;
        }
        if (protectMergeMutation(state.panel, state.mode, e, selected.sheetId))
            return;
        if (shouldBlockGuidedCommand(state.panel, state.mode, e, selected))
            stop(e);
    });
    return () => disposers.forEach(d => d.dispose());
}
