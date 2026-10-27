import type { CellDefinition, CellStyleDefinition, StyleRule } from './types.js';
export type ConditionOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne' | 'between' | 'contains' | 'startsWith' | 'endsWith' | 'in' | 'notIn' | 'empty' | 'notEmpty';
export type RuleOperand = {
    kind: 'current';
    basis?: 'value' | 'display-number' | 'text' | undefined;
} | {
    kind: 'literal';
    valueType?: 'list' | undefined;
    value: string | number | boolean | null | (string | number | boolean)[];
} | {
    kind: 'field';
    field: string;
    agg?: 'sum' | 'avg' | 'count' | 'min' | 'max' | undefined;
} | {
    kind: 'metric';
    metricId: string;
};
export type RulePredicate = {
    kind: 'group';
    mode: 'and' | 'or';
    children: RulePredicate[];
} | {
    kind: 'comparison';
    left: RuleOperand;
    operator: ConditionOperator;
    right?: RuleOperand | undefined;
    upper?: RuleOperand | undefined;
};
export interface VisualStyleAction {
    scope: 'cell' | 'row';
    presetId?: 'red' | 'orange' | 'green' | undefined;
    regionId?: string | undefined;
    style: CellStyleDefinition;
    reset?: ('color' | 'backgroundColor' | 'bold' | 'italic')[] | undefined;
    noFill?: boolean | undefined;
    rowColumns?: [
        number,
        number
    ] | undefined;
}
export interface PresentationTarget {
    sheetId: string;
    regionId?: string | undefined;
    cellId: string;
    field?: string | undefined;
    contentKind?: string | undefined;
    role?: string | undefined;
    operation?: string | undefined;
    /** source格（默认）或同一字段/指标的选定角色。 */
    kind?: 'source' | 'field' | undefined;
    roles?: string[] | undefined;
}
export interface PresentationRule {
    id: string;
    name: string;
    enabled: boolean;
    order: number;
    predicate: RulePredicate;
    style?: VisualStyleAction | undefined;
    text?: string | undefined;
    stopIfTrue: boolean;
}
export interface PresentationRuleSet {
    id: string;
    order: number;
    target: PresentationTarget;
    rules: PresentationRule[];
    otherwise?: {
        text?: string | undefined;
        style?: VisualStyleAction | undefined;
    } | undefined;
}
export interface PresentationRules {
    version: 1;
    revision: number;
    ruleSets: PresentationRuleSet[];
}
export interface RuleStatistics {
    ruleId: string;
    targets: number;
    matched: number;
    applied: number;
    blocked: number;
    affectedRows: number;
    affectedCells: number;
    skippedMerges: number;
    samples: {
        row: number;
        col: number;
        value: unknown;
        formatted: string;
        matched: boolean;
        text?: string | undefined;
    }[];
}
/** 高级面板原子更新：root配置不是CellDefinition中的临时数据。 */
export type AdvancedCellUpdate = Partial<CellDefinition> & {
    presentationRules?: PresentationRules | undefined;
    visualStyleRules?: StyleRule[] | undefined;
};
export const emptyPresentationRules = (): PresentationRules => ({ version: 1, revision: 0, ruleSets: [] });
export const createPredicate = (): RulePredicate => ({ kind: 'comparison', left: { kind: 'current' }, operator: 'lt', right: { kind: 'literal', value: 90 } });
export function targetForCell(cell: CellDefinition): PresentationTarget {
    const c = cell.content;
    return { sheetId: cell.sheetId, regionId: cell.regionId, cellId: cell.id, contentKind: c.kind,
        roles: [cell.id.startsWith('meas-rowtotal-') || c.kind === 'field' && c.role === 'total' ? 'total' : c.kind === 'field' ? c.role.endsWith('dimension') ? 'dimension' : 'data' : c.kind === 'literal' ? cell.id.startsWith('hdr-') ? 'header' : cell.id.startsWith('lbl-') ? 'dimension' : 'static' : 'data'],
        ...(c.kind === 'field' ? { field: c.fieldKey, role: c.role, operation: c.operation } : {}) };
}
