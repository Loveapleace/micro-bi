import type {
  CellTemplateDocumentV1,
  CellDefinition,
  CellPosition,
  CellContent,
  CellRegionConfig,
  DynamicMergePolicy,
  MergeSuppression,
  MergeConfigV1,
} from '../report-template/types.js';
import { generateTemplateCellId, resolveFieldId, resolveMetricId } from '../report-template/identity.js';
export { generateTemplateCellId };
import { syncDocumentFromWorkbookSnapshot } from './syncWorkbookToTemplate.js';
import type { BiGridModel } from '../report/types.js';

export interface DesignerState {
  document: CellTemplateDocumentV1;
  selectedPos: CellPosition | null;
  selectedCell: CellDefinition | null;
  advancedModalOpen: boolean;
  mode: 'design' | 'preview';
  dirty: boolean;
  draftDirty: boolean;
  editSequence: number;
  history: CellTemplateDocumentV1[];
  future: CellTemplateDocumentV1[];
}

export type DesignerAction =
  | { type: 'SELECT_CELL'; position: CellPosition; sheetId?: string | undefined }
  | { type: 'UPDATE_DRAFT_CONTENT'; content: Partial<CellContent> }
  | { type: 'UPDATE_DRAFT_PARENTS'; parents: { row: string | null; column: string | null } }
  | { type: 'UPDATE_DRAFT_STYLE'; style: Record<string, any> }
  | { type: 'APPLY_DRAFT' }
  | { type: 'REVERT_DRAFT' }
  | { type: 'DELETE_CELL_BINDING' }
  | { type: 'OPEN_ADVANCED' }
  | { type: 'CLOSE_ADVANCED' }
  | { type: 'SET_MODE'; mode: 'design' | 'preview' }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'RESET_DIRTY' }
  | { type: 'UPDATE_REGION'; changes: Partial<CellRegionConfig> }
  | {
      type: 'APPLY_NATIVE_CELL_EDIT';
      row: number;
      column: number;
      sheetId?: string | undefined;
      value?: any;
      formula?: string | undefined;
    }
  | {
      type: 'SYNC_FROM_SNAPSHOT';
      snapshot: any;
      grid?: BiGridModel | undefined;
    }
  | { type: 'SET_DYNAMIC_MERGE_POLICY'; policy: DynamicMergePolicy }
  | { type: 'TOGGLE_DYNAMIC_MERGE_POLICY'; policyId: string; enabled: boolean }
  | { type: 'REMOVE_DYNAMIC_MERGE_POLICY'; policyId: string }
  | { type: 'ADD_MERGE_SUPPRESSION'; suppression: MergeSuppression }
  | { type: 'REMOVE_MERGE_SUPPRESSION'; suppressionId: string }
  | { type: 'CLEAR_MERGE_SUPPRESSIONS'; policyId?: string | undefined }
  | { type: 'LOAD_DOCUMENT'; document: CellTemplateDocumentV1 }
  | { type: 'INSERT_COLUMNS'; sheetId?: string | undefined; startIndex: number; count: number }
  | { type: 'REMOVE_COLUMNS'; sheetId?: string | undefined; startIndex: number; count: number }
  | { type: 'INSERT_ROWS'; sheetId?: string | undefined; startIndex: number; count: number }
  | { type: 'REMOVE_ROWS'; sheetId?: string | undefined; startIndex: number; count: number };

export function createInitialDesignerState(doc: CellTemplateDocumentV1): DesignerState {
  const firstSheetId = doc.sheets?.[0]?.id || 'sheet-1';
  const initialPos: CellPosition = { row: 0, column: 0 };
  const initialCell = doc.cells.find(
    (c) => c.position.row === initialPos.row && c.position.column === initialPos.column
  ) || {
    id: generateTemplateCellId(),
    sheetId: firstSheetId,
    position: initialPos,
    content: { kind: 'literal', value: '' },
    parents: { row: null, column: null },
  };

  return {
    document: doc,
    selectedPos: initialPos,
    selectedCell: initialCell,
    advancedModalOpen: false,
    mode: 'design',
    dirty: false,
    draftDirty: false,
    editSequence: 0,
    history: [],
    future: [],
  };
}

export function designerReducer(state: DesignerState, action: DesignerAction): DesignerState {
  switch (action.type) {
    case 'SELECT_CELL': {
      state = designerReducer(state, { type: 'APPLY_DRAFT' });
      const { position, sheetId } = action;
      const targetSheetId = sheetId || state.document.sheets?.[0]?.id || 'sheet-1';
      const existing = state.document.cells.find(
        (c) =>
          c.sheetId === targetSheetId &&
          c.position.row === position.row &&
          c.position.column === position.column
      );

      const cell = existing
        ? { ...existing }
        : {
            id: generateTemplateCellId(),
            sheetId: targetSheetId,
            position,
            content: { kind: 'literal' as const, value: '' },
            parents: { row: 'default', column: 'default' },
          };

      return {
        ...state,
        selectedPos: position,
        selectedCell: cell,
        draftDirty: false,
      };
    }

    case 'UPDATE_DRAFT_CONTENT': {
      if (!state.selectedCell) return state;

      let newContent: CellContent;
      const prevContent = state.selectedCell.content;

      let nextParents = state.selectedCell.parents || { row: 'default', column: 'default' };

      // 如果显式切换了 kind，构建干净的目标类型对象，消除旧类型的属性残留
      if (action.content.kind && action.content.kind !== prevContent.kind) {
        if (action.content.kind === 'field' || action.content.kind === 'business-formula') {
          if (nextParents.row === null && nextParents.column === null) {
            nextParents = { row: 'default', column: 'default' };
          }
        }

        if (action.content.kind === 'literal') {
          newContent = {
            kind: 'literal',
            value: (action.content as any).value !== undefined ? (action.content as any).value : '',
          };
        } else if (action.content.kind === 'field') {
          const fieldKey = (action.content as any).fieldKey || 'field_1';
          const role = (action.content as any).role || 'measure';
          const operation = (action.content as any).operation || 'sum';
          newContent = {
            kind: 'field',
            fieldId: (action.content as any).fieldId || resolveFieldId(fieldKey),
            fieldKey,
            displayName: (action.content as any).displayName || fieldKey,
            role,
            operation,
            expand: (action.content as any).expand || 'inherit',
            ...(role === 'measure'
              ? { metricId: (action.content as any).metricId || resolveMetricId(fieldKey, operation) }
              : {}),
          };
        } else {
          newContent = {
            kind: 'business-formula',
            metricId: (action.content as any).metricId || 'calc_1',
            expression: (action.content as any).expression || '',
            scope: (action.content as any).scope || 'summary',
            precision: (action.content as any).precision ?? 2,
            displayName: (action.content as any).displayName || '计算指标',
          };
        }
      } else {
        newContent = {
          ...prevContent,
          ...action.content,
        } as CellContent;
      }

      // 若为度量且缺少稳定 metricId，自动补全，避免同字段同聚合的身份碰撞
      if (newContent.kind === 'field' && newContent.role === 'measure' && !newContent.metricId) {
        newContent = {
          ...newContent,
          metricId: resolveMetricId(newContent.fieldKey, newContent.operation),
        };
      }

      // 对比草稿是否与已固化的模板单元格内容一致
      const committedCell = state.document.cells.find(
        (c) =>
          c.sheetId === state.selectedCell!.sheetId &&
          c.position.row === state.selectedCell!.position.row &&
          c.position.column === state.selectedCell!.position.column
      );

      const isUnchanged = Boolean(
        committedCell && JSON.stringify(committedCell.content) === JSON.stringify(newContent)
      );

      return {
        ...state,
        draftDirty: !isUnchanged,
        selectedCell: {
          ...state.selectedCell,
          content: newContent,
          parents: nextParents,
        },
      };
    }

    case 'REVERT_DRAFT': {
      if (!state.selectedPos) return state;
      const targetSheetId = state.selectedCell?.sheetId || state.document.sheets?.[0]?.id || 'sheet-1';
      const existing = state.document.cells.find(
        (c) =>
          c.sheetId === targetSheetId &&
          c.position.row === state.selectedPos!.row &&
          c.position.column === state.selectedPos!.column
      );
      return {
        ...state,
        draftDirty: false,
        selectedCell: existing
          ? { ...existing }
          : {
              id: generateTemplateCellId(),
              sheetId: targetSheetId,
              position: state.selectedPos,
              content: { kind: 'literal' as const, value: '' },
              parents: { row: 'default', column: 'default' },
            },
      };
    }

    case 'UPDATE_DRAFT_PARENTS': {
      if (!state.selectedCell) return state;
      return {
        ...state,
        draftDirty: true,
        selectedCell: {
          ...state.selectedCell,
          parents: action.parents,
        },
      };
    }

    case 'UPDATE_DRAFT_STYLE': {
      if (!state.selectedCell) return state;
      return {
        ...state,
        draftDirty: true,
        selectedCell: {
          ...state.selectedCell,
          style: {
            ...(state.selectedCell.style || {}),
            ...action.style,
          },
        },
      };
    }

    case 'APPLY_DRAFT': {
      if (!state.draftDirty || !state.selectedCell || !state.selectedPos) return state;
      const currentCell = state.selectedCell;

      // 检查是否属于活动区域
      const region = state.document.regions?.[0];
      const cellWithRegion: CellDefinition = {
        ...currentCell,
        regionId: currentCell.content.kind === 'field' || currentCell.content.kind === 'business-formula'
          ? (region?.id || 'region-1')
          : undefined,
      };

      const remainingCells = state.document.cells.filter(
        (c) =>
          !(
            c.sheetId === cellWithRegion.sheetId &&
            c.position.row === cellWithRegion.position.row &&
            c.position.column === cellWithRegion.position.column
          )
      );

      const nextCells = [...remainingCells, cellWithRegion];
      const nextDoc: CellTemplateDocumentV1 = {
        ...state.document,
        templateRevision: (state.document.templateRevision || 0) + 1,
        cells: nextCells,
      };

      return {
        ...state,
        document: nextDoc,
        selectedCell: cellWithRegion,
        draftDirty: false,
        dirty: true,
        editSequence: state.editSequence + 1,
        history: [...state.history.slice(-20), state.document],
        future: [],
      };
    }

    case 'DELETE_CELL_BINDING': {
      if (!state.selectedPos) return state;
      const remainingCells = state.document.cells.filter(
        (c) =>
          !(
            c.sheetId === state.selectedCell?.sheetId &&
            c.position.row === state.selectedPos!.row &&
            c.position.column === state.selectedPos!.column
          )
      );

      const nextDoc: CellTemplateDocumentV1 = {
        ...state.document,
        templateRevision: (state.document.templateRevision || 0) + 1,
        cells: remainingCells,
      };

      return {
        ...state,
        document: nextDoc,
        selectedCell: {
          id: generateTemplateCellId(),
          sheetId: state.selectedCell?.sheetId || 'sheet-1',
          position: state.selectedPos,
          content: { kind: 'literal', value: '' },
          parents: { row: null, column: null },
        },
        dirty: true,
        draftDirty: false,
        editSequence: state.editSequence + 1,
        history: [...state.history.slice(-20), state.document],
        future: [],
      };
    }

    case 'OPEN_ADVANCED':
      return { ...state, advancedModalOpen: true };

    case 'CLOSE_ADVANCED':
      return { ...state, advancedModalOpen: false };

    case 'SET_MODE':
      return { ...designerReducer(state, { type: 'APPLY_DRAFT' }), mode: action.mode };

    case 'UPDATE_REGION': {
      state = designerReducer(state, { type: 'APPLY_DRAFT' });
      let region = state.document.regions[0];
      // 空模板尚无区域时新建默认区域，避免切换数据集后 datasetId 无处落盘（静默丢失绑定）
      if (!region) {
        region = {
          id: 'region-1',
          sheetId: state.document.sheets?.[0]?.id || 'sheet-1',
          datasetId: action.changes.datasetId || '',
          anchor: { row: 0, column: 0 },
          filters: [],
        };
        return {
          ...state,
          document: {
            ...state.document,
            templateRevision: (state.document.templateRevision || 0) + 1,
            regions: [region],
          },
          dirty: true,
          history: [...state.history.slice(-20), state.document],
          future: [],
        };
      }
      return {
        ...state,
        document: {
          ...state.document,
          templateRevision: state.document.templateRevision + 1,
          regions: [{ ...region, ...action.changes }],
        },
        dirty: true,
        history: [...state.history.slice(-20), state.document],
        future: [],
      };
    }

    case 'UNDO': {
      if (state.history.length === 0) return state;
      const prevDoc = state.history[state.history.length - 1]!;
      return {
        ...state,
        document: prevDoc,
        selectedCell: prevDoc.cells.find((c) => c.id === state.selectedCell?.id) || null,
        draftDirty: false,
        history: state.history.slice(0, -1),
        future: [state.document, ...state.future],
        dirty: true,
      };
    }

    case 'REDO': {
      if (state.future.length === 0) return state;
      const nextDoc = state.future[0]!;
      return {
        ...state,
        document: nextDoc,
        selectedCell: nextDoc.cells.find((c) => c.id === state.selectedCell?.id) || null,
        draftDirty: false,
        history: [...state.history, state.document],
        future: state.future.slice(1),
        dirty: true,
      };
    }

    case 'RESET_DIRTY':
      return { ...state, dirty: false };

    case 'LOAD_DOCUMENT': {
      const firstSheetId = action.document.sheets?.[0]?.id || 'sheet-1';
      const initialPos: CellPosition = { row: 0, column: 0 };
      const initialCell = action.document.cells.find(
        (c) => c.position.row === initialPos.row && c.position.column === initialPos.column
      ) || {
        id: generateTemplateCellId(),
        sheetId: firstSheetId,
        position: initialPos,
        content: { kind: 'literal' as const, value: '' },
        parents: { row: null, column: null },
      };

      return {
        ...state,
        document: action.document,
        selectedPos: initialPos,
        selectedCell: initialCell,
        draftDirty: false,
        dirty: true,
        editSequence: state.editSequence + 1,
        history: [...state.history.slice(-20), state.document],
        future: [],
      };
    }

    case 'SET_DYNAMIC_MERGE_POLICY': {
      state = designerReducer(state, { type: 'APPLY_DRAFT' });
      const currentConfig: MergeConfigV1 = state.document.mergeConfig || {
        capability: 'template-merge-v1',
        identityVersion: 1,
        policies: [],
        suppressions: [],
      };

      const docRegions = state.document.regions || [];
      const primaryRegionId = docRegions[0]?.id || 'region-1';
      const targetRegionId = docRegions.some((r) => r.id === action.policy.regionId)
        ? action.policy.regionId
        : primaryRegionId;

      const sanitizedPolicy: DynamicMergePolicy = {
        ...action.policy,
        regionId: targetRegionId,
        sequence: state.editSequence + 1,
      };

      const existingPolicies = currentConfig.policies || [];
      const idx = existingPolicies.findIndex((p) => p.id === sanitizedPolicy.id);
      let updatedPolicies: DynamicMergePolicy[];
      if (idx >= 0) {
        updatedPolicies = [...existingPolicies];
        updatedPolicies[idx] = sanitizedPolicy;
      } else {
        updatedPolicies = [...existingPolicies, sanitizedPolicy];
      }

      const nextDoc: CellTemplateDocumentV1 = {
        ...state.document,
        schemaVersion: state.document.schemaVersion || '2.0',
        templateRevision: (state.document.templateRevision || 0) + 1,
        mergeConfig: {
          ...currentConfig,
          policies: updatedPolicies,
        },
      };

      return {
        ...state,
        document: nextDoc,
        dirty: true,
        editSequence: state.editSequence + 1,
        history: [...state.history.slice(-20), state.document],
        future: [],
      };
    }

    case 'TOGGLE_DYNAMIC_MERGE_POLICY': {
      const currentConfig = state.document.mergeConfig;
      if (!currentConfig || !currentConfig.policies) return state;

      const updatedPolicies = currentConfig.policies.map((p) =>
        p.id === action.policyId ? { ...p, enabled: action.enabled } : p
      );

      const nextDoc: CellTemplateDocumentV1 = {
        ...state.document,
        templateRevision: (state.document.templateRevision || 0) + 1,
        mergeConfig: {
          ...currentConfig,
          policies: updatedPolicies,
        },
      };

      return {
        ...state,
        document: nextDoc,
        dirty: true,
        editSequence: state.editSequence + 1,
        history: [...state.history.slice(-20), state.document],
        future: [],
      };
    }

    case 'REMOVE_DYNAMIC_MERGE_POLICY': {
      const currentConfig = state.document.mergeConfig;
      if (!currentConfig || !currentConfig.policies) return state;

      const updatedPolicies = currentConfig.policies.filter((p) => p.id !== action.policyId);
      const nextDoc: CellTemplateDocumentV1 = {
        ...state.document,
        templateRevision: (state.document.templateRevision || 0) + 1,
        mergeConfig: {
          ...currentConfig,
          policies: updatedPolicies,
        },
      };

      return {
        ...state,
        document: nextDoc,
        dirty: true,
        editSequence: state.editSequence + 1,
        history: [...state.history.slice(-20), state.document],
        future: [],
      };
    }

    case 'ADD_MERGE_SUPPRESSION': {
      const currentConfig: MergeConfigV1 = state.document.mergeConfig || {
        capability: 'template-merge-v1',
        identityVersion: 1,
        policies: [],
        suppressions: [],
      };

      const existingSuppressions = currentConfig.suppressions || [];
      const updatedSuppressions = [
        ...existingSuppressions.filter((s) => s.id !== action.suppression.id),
        action.suppression,
      ];

      const nextDoc: CellTemplateDocumentV1 = {
        ...state.document,
        templateRevision: (state.document.templateRevision || 0) + 1,
        mergeConfig: {
          ...currentConfig,
          suppressions: updatedSuppressions,
        },
      };

      return {
        ...state,
        document: nextDoc,
        dirty: true,
        editSequence: state.editSequence + 1,
        history: [...state.history.slice(-20), state.document],
        future: [],
      };
    }

    case 'REMOVE_MERGE_SUPPRESSION': {
      const currentConfig = state.document.mergeConfig;
      if (!currentConfig || !currentConfig.suppressions) return state;

      const updatedSuppressions = currentConfig.suppressions.filter(
        (s) => s.id !== action.suppressionId
      );

      const nextDoc: CellTemplateDocumentV1 = {
        ...state.document,
        templateRevision: (state.document.templateRevision || 0) + 1,
        mergeConfig: {
          ...currentConfig,
          suppressions: updatedSuppressions,
        },
      };

      return {
        ...state,
        document: nextDoc,
        dirty: true,
        editSequence: state.editSequence + 1,
        history: [...state.history.slice(-20), state.document],
        future: [],
      };
    }

    case 'CLEAR_MERGE_SUPPRESSIONS': {
      const currentConfig = state.document.mergeConfig;
      if (!currentConfig || !currentConfig.suppressions) return state;

      const updatedSuppressions = action.policyId
        ? currentConfig.suppressions.filter((s) => s.policyId !== action.policyId)
        : [];

      const nextDoc: CellTemplateDocumentV1 = {
        ...state.document,
        templateRevision: (state.document.templateRevision || 0) + 1,
        mergeConfig: {
          ...currentConfig,
          suppressions: updatedSuppressions,
        },
      };

      return {
        ...state,
        document: nextDoc,
        dirty: true,
        editSequence: state.editSequence + 1,
        history: [...state.history.slice(-20), state.document],
        future: [],
      };
    }

    case 'APPLY_NATIVE_CELL_EDIT': {
      const { row, column, sheetId, value, formula } = action;
      const targetSheetId = sheetId || state.document.sheets?.[0]?.id || 'sheet-1';

      if (state.mode === 'design') {
        const remainingCells = state.document.cells.filter(
          (c) => !(c.sheetId === targetSheetId && c.position.row === row && c.position.column === column)
        );
        const existing = state.document.cells.find(
          (c) => c.sheetId === targetSheetId && c.position.row === row && c.position.column === column
        );

        let updatedCell: CellDefinition;
        if (existing) {
          const content = { ...existing.content };
          if (formula) {
            updatedCell = {
              ...existing,
              content: { kind: 'sheet-formula', formula },
            };
          } else if (content.kind === 'literal') {
            updatedCell = {
              ...existing,
              content: { kind: 'literal', value: value ?? '' },
            };
          } else if (content.kind === 'field') {
            // 字段格不允许通过原生键入覆盖显示名：绑定与显示名统一在属性面板维护，
            // 避免“键入文字静默替换绑定”导致字段丢失（遵循 §4.2）。
            updatedCell = { ...existing };
          } else if (content.kind === 'sheet-formula') {
            updatedCell = {
              ...existing,
              content: { kind: 'sheet-formula', formula: String(value ?? '') },
            };
          } else if (content.kind === 'business-formula') {
            const str = String(value ?? '').trim();
            if (str.startsWith('=[') && str.endsWith(']')) {
              const inner = str.slice(2, -1);
              updatedCell = {
                ...existing,
                content: { ...content, displayName: inner || content.displayName },
              };
            } else if (str.startsWith('=')) {
              updatedCell = {
                ...existing,
                content: { ...content, expression: str.slice(1) },
              };
            } else {
              updatedCell = {
                ...existing,
                content: { ...content, displayName: str || content.displayName },
              };
            }
          } else {
            updatedCell = {
              ...existing,
              content: { kind: 'literal', value: value ?? '' },
            };
          }
        } else {
          updatedCell = {
            id: generateTemplateCellId(),
            sheetId: targetSheetId,
            position: { row, column },
            content: formula || String(value ?? '').startsWith('=')
              ? { kind: 'sheet-formula', formula: formula || String(value) }
              : { kind: 'literal', value: value ?? '' },
            parents: { row: null, column: null },
          };
        }

        const nextDoc: CellTemplateDocumentV1 = {
          ...state.document,
          templateRevision: (state.document.templateRevision || 0) + 1,
          cells: [...remainingCells, updatedCell],
        };

        const isCurrentSelected =
          state.selectedPos &&
          state.selectedPos.row === row &&
          state.selectedPos.column === column;

        return {
          ...state,
          document: nextDoc,
          selectedCell: isCurrentSelected ? updatedCell : state.selectedCell,
          draftDirty: isCurrentSelected ? false : state.draftDirty,
          dirty: true,
          editSequence: state.editSequence + 1,
          history: [...state.history.slice(-20), state.document],
          future: [],
        };
      }

      return state;
    }

    case 'SYNC_FROM_SNAPSHOT': {
      const nextDoc = syncDocumentFromWorkbookSnapshot(
        state.document,
        action.snapshot,
        state.mode,
        action.grid
      );
      const isSelectedInDoc = state.selectedPos
        ? nextDoc.cells.find(
            (c) =>
              c.position.row === state.selectedPos?.row &&
              c.position.column === state.selectedPos?.column
          )
        : null;

      return {
        ...state,
        document: nextDoc,
        selectedCell: isSelectedInDoc || state.selectedCell,
        dirty: true,
      };
    }

    case 'INSERT_COLUMNS': {
      const { startIndex, count } = action;
      if (count <= 0) return state;
      const targetSheetId = action.sheetId || state.document.sheets?.[0]?.id || 'sheet-1';

      // 1. Shift cells
      const updatedCells = state.document.cells.map((c) => {
        if ((c.sheetId || 'sheet-1') === targetSheetId && c.position.column >= startIndex) {
          return {
            ...c,
            position: {
              ...c.position,
              column: c.position.column + count,
            },
          };
        }
        return c;
      });

      // 2. Shift layoutRules (column-width and merge)
      const updatedLayoutRules = state.document.layoutRules.map((rule) => {
        if ((rule.sheetId || 'sheet-1') !== targetSheetId) return rule;
        if (rule.kind === 'column-width' && rule.index !== undefined && rule.index >= startIndex) {
          return { ...rule, index: rule.index + count };
        }
        if (rule.kind === 'merge' && rule.range) {
          const r = { ...rule.range };
          if (r.startColumn >= startIndex) {
            r.startColumn += count;
            r.endColumn += count;
          } else if (r.endColumn >= startIndex) {
            r.endColumn += count;
          }
          return { ...rule, range: r };
        }
        return rule;
      });

      // 3. Shift region anchor if applicable
      const updatedRegions = (state.document.regions || []).map((reg) => {
        if ((reg.sheetId || 'sheet-1') === targetSheetId && reg.anchor.column >= startIndex) {
          return {
            ...reg,
            anchor: { ...reg.anchor, column: reg.anchor.column + count },
          };
        }
        return reg;
      });

      const nextDoc: CellTemplateDocumentV1 = {
        ...state.document,
        cells: updatedCells,
        layoutRules: updatedLayoutRules,
        regions: updatedRegions,
        templateRevision: (state.document.templateRevision || 1) + 1,
      };

      const isCurrentSheet = (state.selectedCell?.sheetId || 'sheet-1') === targetSheetId;
      const nextSelectedPos = state.selectedPos && isCurrentSheet && state.selectedPos.column >= startIndex
        ? { ...state.selectedPos, column: state.selectedPos.column + count }
        : state.selectedPos;

      const nextSelectedCell = nextSelectedPos
        ? updatedCells.find((c) => (c.sheetId || 'sheet-1') === targetSheetId && c.position.row === nextSelectedPos.row && c.position.column === nextSelectedPos.column) || null
        : null;

      return {
        ...state,
        document: nextDoc,
        selectedPos: nextSelectedPos,
        selectedCell: nextSelectedCell,
        history: [...state.history.slice(-20), state.document],
        future: [],
        dirty: true,
      };
    }

    case 'REMOVE_COLUMNS': {
      const { startIndex, count } = action;
      if (count <= 0) return state;
      const targetSheetId = action.sheetId || state.document.sheets?.[0]?.id || 'sheet-1';

      // 1. Remove deleted cells, and shift remaining cells left
      const updatedCells = state.document.cells
        .filter((c) => {
          if ((c.sheetId || 'sheet-1') !== targetSheetId) return true;
          return !(c.position.column >= startIndex && c.position.column < startIndex + count);
        })
        .map((c) => {
          if ((c.sheetId || 'sheet-1') === targetSheetId && c.position.column >= startIndex + count) {
            return {
              ...c,
              position: {
                ...c.position,
                column: c.position.column - count,
              },
            };
          }
          return c;
        });

      // 2. Adjust layoutRules
      const updatedLayoutRules = state.document.layoutRules
        .filter((rule) => {
          if ((rule.sheetId || 'sheet-1') !== targetSheetId) return true;
          if (rule.kind === 'column-width' && rule.index !== undefined) {
            return !(rule.index >= startIndex && rule.index < startIndex + count);
          }
          return true;
        })
        .map((rule) => {
          if ((rule.sheetId || 'sheet-1') !== targetSheetId) return rule;
          if (rule.kind === 'column-width' && rule.index !== undefined && rule.index >= startIndex + count) {
            return { ...rule, index: rule.index - count };
          }
          if (rule.kind === 'merge' && rule.range) {
            const r = { ...rule.range };
            if (r.startColumn >= startIndex + count) {
              r.startColumn -= count;
              r.endColumn -= count;
            } else if (r.endColumn >= startIndex) {
              r.endColumn = Math.max(r.startColumn, r.endColumn - count);
            }
            return { ...rule, range: r };
          }
          return rule;
        });

      // 3. Adjust regions
      const updatedRegions = (state.document.regions || []).map((reg) => {
        if ((reg.sheetId || 'sheet-1') === targetSheetId && reg.anchor.column >= startIndex + count) {
          return {
            ...reg,
            anchor: { ...reg.anchor, column: Math.max(0, reg.anchor.column - count) },
          };
        }
        return reg;
      });

      const nextDoc: CellTemplateDocumentV1 = {
        ...state.document,
        cells: updatedCells,
        layoutRules: updatedLayoutRules,
        regions: updatedRegions,
        templateRevision: (state.document.templateRevision || 1) + 1,
      };

      const isCurrentSheet = (state.selectedCell?.sheetId || 'sheet-1') === targetSheetId;
      let nextSelectedPos = state.selectedPos;
      if (nextSelectedPos && isCurrentSheet) {
        if (nextSelectedPos.column >= startIndex && nextSelectedPos.column < startIndex + count) {
          nextSelectedPos = { ...nextSelectedPos, column: Math.max(0, startIndex - 1) };
        } else if (nextSelectedPos.column >= startIndex + count) {
          nextSelectedPos = { ...nextSelectedPos, column: nextSelectedPos.column - count };
        }
      }

      const nextSelectedCell = nextSelectedPos
        ? updatedCells.find((c) => (c.sheetId || 'sheet-1') === targetSheetId && c.position.row === nextSelectedPos.row && c.position.column === nextSelectedPos.column) || null
        : null;

      return {
        ...state,
        document: nextDoc,
        selectedPos: nextSelectedPos,
        selectedCell: nextSelectedCell,
        history: [...state.history.slice(-20), state.document],
        future: [],
        dirty: true,
      };
    }

    case 'INSERT_ROWS': {
      const { startIndex, count } = action;
      if (count <= 0) return state;
      const targetSheetId = action.sheetId || state.document.sheets?.[0]?.id || 'sheet-1';

      // 1. Shift cells down
      const updatedCells = state.document.cells.map((c) => {
        if ((c.sheetId || 'sheet-1') === targetSheetId && c.position.row >= startIndex) {
          return {
            ...c,
            position: {
              ...c.position,
              row: c.position.row + count,
            },
          };
        }
        return c;
      });

      // 2. Shift layoutRules (row-height and merge)
      const updatedLayoutRules = state.document.layoutRules.map((rule) => {
        if ((rule.sheetId || 'sheet-1') !== targetSheetId) return rule;
        if (rule.kind === 'row-height' && rule.index !== undefined && rule.index >= startIndex) {
          return { ...rule, index: rule.index + count };
        }
        if (rule.kind === 'merge' && rule.range) {
          const r = { ...rule.range };
          if (r.startRow >= startIndex) {
            r.startRow += count;
            r.endRow += count;
          } else if (r.endRow >= startIndex) {
            r.endRow += count;
          }
          return { ...rule, range: r };
        }
        return rule;
      });

      // 3. Shift region anchor if applicable
      const updatedRegions = (state.document.regions || []).map((reg) => {
        if ((reg.sheetId || 'sheet-1') === targetSheetId && reg.anchor.row >= startIndex) {
          return {
            ...reg,
            anchor: { ...reg.anchor, row: reg.anchor.row + count },
          };
        }
        return reg;
      });

      const nextDoc: CellTemplateDocumentV1 = {
        ...state.document,
        cells: updatedCells,
        layoutRules: updatedLayoutRules,
        regions: updatedRegions,
        templateRevision: (state.document.templateRevision || 1) + 1,
      };

      const isCurrentSheet = (state.selectedCell?.sheetId || 'sheet-1') === targetSheetId;
      const nextSelectedPos = state.selectedPos && isCurrentSheet && state.selectedPos.row >= startIndex
        ? { ...state.selectedPos, row: state.selectedPos.row + count }
        : state.selectedPos;

      const nextSelectedCell = nextSelectedPos
        ? updatedCells.find((c) => (c.sheetId || 'sheet-1') === targetSheetId && c.position.row === nextSelectedPos.row && c.position.column === nextSelectedPos.column) || null
        : null;

      return {
        ...state,
        document: nextDoc,
        selectedPos: nextSelectedPos,
        selectedCell: nextSelectedCell,
        history: [...state.history.slice(-20), state.document],
        future: [],
        dirty: true,
      };
    }

    case 'REMOVE_ROWS': {
      const { startIndex, count } = action;
      if (count <= 0) return state;
      const targetSheetId = action.sheetId || state.document.sheets?.[0]?.id || 'sheet-1';

      // 1. Remove deleted cells, and shift remaining cells up
      const updatedCells = state.document.cells
        .filter((c) => {
          if ((c.sheetId || 'sheet-1') !== targetSheetId) return true;
          return !(c.position.row >= startIndex && c.position.row < startIndex + count);
        })
        .map((c) => {
          if ((c.sheetId || 'sheet-1') === targetSheetId && c.position.row >= startIndex + count) {
            return {
              ...c,
              position: {
                ...c.position,
                row: c.position.row - count,
              },
            };
          }
          return c;
        });

      // 2. Adjust layoutRules
      const updatedLayoutRules = state.document.layoutRules
        .filter((rule) => {
          if ((rule.sheetId || 'sheet-1') !== targetSheetId) return true;
          if (rule.kind === 'row-height' && rule.index !== undefined) {
            return !(rule.index >= startIndex && rule.index < startIndex + count);
          }
          return true;
        })
        .map((rule) => {
          if ((rule.sheetId || 'sheet-1') !== targetSheetId) return rule;
          if (rule.kind === 'row-height' && rule.index !== undefined && rule.index >= startIndex + count) {
            return { ...rule, index: rule.index - count };
          }
          if (rule.kind === 'merge' && rule.range) {
            const r = { ...rule.range };
            if (r.startRow >= startIndex + count) {
              r.startRow -= count;
              r.endRow -= count;
            } else if (r.endRow >= startIndex) {
              r.endRow = Math.max(r.startRow, r.endRow - count);
            }
            return { ...rule, range: r };
          }
          return rule;
        });

      // 3. Adjust regions
      const updatedRegions = (state.document.regions || []).map((reg) => {
        if ((reg.sheetId || 'sheet-1') === targetSheetId && reg.anchor.row >= startIndex + count) {
          return {
            ...reg,
            anchor: { ...reg.anchor, row: Math.max(0, reg.anchor.row - count) },
          };
        }
        return reg;
      });

      const nextDoc: CellTemplateDocumentV1 = {
        ...state.document,
        cells: updatedCells,
        layoutRules: updatedLayoutRules,
        regions: updatedRegions,
        templateRevision: (state.document.templateRevision || 1) + 1,
      };

      const isCurrentSheet = (state.selectedCell?.sheetId || 'sheet-1') === targetSheetId;
      let nextSelectedPos = state.selectedPos;
      if (nextSelectedPos && isCurrentSheet) {
        if (nextSelectedPos.row >= startIndex && nextSelectedPos.row < startIndex + count) {
          nextSelectedPos = { ...nextSelectedPos, row: Math.max(0, startIndex - 1) };
        } else if (nextSelectedPos.row >= startIndex + count) {
          nextSelectedPos = { ...nextSelectedPos, row: nextSelectedPos.row - count };
        }
      }

      const nextSelectedCell = nextSelectedPos
        ? updatedCells.find((c) => (c.sheetId || 'sheet-1') === targetSheetId && c.position.row === nextSelectedPos.row && c.position.column === nextSelectedPos.column) || null
        : null;

      return {
        ...state,
        document: nextDoc,
        selectedPos: nextSelectedPos,
        selectedCell: nextSelectedCell,
        history: [...state.history.slice(-20), state.document],
        future: [],
        dirty: true,
      };
    }

    default:
      return state;
  }
}
