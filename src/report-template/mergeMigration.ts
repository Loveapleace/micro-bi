/**
 * 单元格模板协议版本迁移与兼容 (mergeMigration.ts)
 * 遵循 Section 5.1 & DM-01 规范：
 * 1. 1.0 模板平滑幂等升级至 1.1，保留原有全部单元格、布局规则与样式
 * 2. 1.1 模板具备 mergeConfig 规范（policies 与 suppressions）
 * 3. 未知能力拒绝静默降级
 */
import type {
  CellTemplateDocumentV1,
  MergeConfigV1,
} from './types.js';

export const CURRENT_MERGE_CAPABILITY = 'template-merge-v1';

/**
 * 将 1.0 模板升级为 1.1 动态合并协议版本
 * 幂等操作：若已是 1.1 且结构合规，则安全返回
 */
export function migrateCellTemplateToV1_1(doc: CellTemplateDocumentV1): CellTemplateDocumentV1 {
  if (!doc) {
    throw new Error('Cannot migrate empty or null cell template document.');
  }

  // 若已经是 1.1 版本
  if (doc.schemaVersion === '1.1') {
    if (doc.mergeConfig && doc.mergeConfig.capability !== CURRENT_MERGE_CAPABILITY) {
      throw new Error(
        `Cannot migrate template: unsupported merge capability "${(doc.mergeConfig as any).capability}". Expected "${CURRENT_MERGE_CAPABILITY}".`
      );
    }
    const safeMergeConfig: MergeConfigV1 = {
      capability: CURRENT_MERGE_CAPABILITY,
      identityVersion: 1,
      policies: Array.isArray(doc.mergeConfig?.policies) ? [...doc.mergeConfig.policies] : [],
      suppressions: Array.isArray(doc.mergeConfig?.suppressions) ? [...doc.mergeConfig.suppressions] : [],
    };
    return {
      ...doc,
      schemaVersion: '1.1',
      mergeConfig: safeMergeConfig,
    };
  }

  // 1.0 升级为 1.1
  const existingPolicies = doc.mergeConfig?.policies ? [...doc.mergeConfig.policies] : [];
  const existingSuppressions = doc.mergeConfig?.suppressions ? [...doc.mergeConfig.suppressions] : [];

  const upgradedMergeConfig: MergeConfigV1 = {
    capability: CURRENT_MERGE_CAPABILITY,
    identityVersion: 1,
    policies: existingPolicies,
    suppressions: existingSuppressions,
  };

  return {
    ...doc,
    schemaVersion: '1.1',
    mergeConfig: upgradedMergeConfig,
  };
}

/**
 * 检查模板是否声明并启用了动态合并能力
 */
export function hasTemplateMergeCapability(doc: CellTemplateDocumentV1): boolean {
  return (doc?.schemaVersion === '1.1' || doc?.schemaVersion === '2.0') && doc?.mergeConfig?.capability === CURRENT_MERGE_CAPABILITY;
}
