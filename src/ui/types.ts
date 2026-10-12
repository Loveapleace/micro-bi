/**
 * 可视化配置面板 UI 组件类型定义 (React 17+)
 */
import type { CSSProperties } from 'react';
import type { DataRecord } from '../types.js';
import type {
  DynamicTransformConfig,
  TransformResult,
  HeaderMapping,
} from '../engine/types.js';
import type { ConfigValidationResult } from '../engine/validator.js';
import type { DynamicDataLocale, DeepPartial } from '../locale/types.js';
import type { RegisteredDataset, DatasetDataLoader } from '../core/datasetRegistry.js';

/**
 * 配置面板实例暴露的方法句柄 (Ref Handle)
 *
 * 宿主项目无论将配置面板嵌入在 Antd Modal、Antd Drawer、自定义弹窗还是页面路由中，
 * 均可通过此 ref 句柄直接读取最新配置内容、执行校验或获取试算结果。
 */
export interface DynamicDataConfigPanelRef {
  /**
   * 获取当前最新的配置对象 (DynamicTransformConfig)。
   * 无论外部是以受控 (value/onChange) 还是非受控 (defaultValue) 模式使用，均返回当前有效配置。
   */
  getConfig: () => DynamicTransformConfig;

  /**
   * 校验当前配置并返回校验结果与配置内容。
   * 当 valid 为 false 时，issues 中包含具体的校验错误列表。
   */
  validateAndGetConfig: () => ConfigValidationResult;

  /**
   * 获取当前配置对输入数据即时试算的结果 (TransformResult)。
   */
  getTransformResult: () => TransformResult;

  /**
   * 重置配置到初始状态。
   */
  resetConfig: () => void;

  /**
   * 获取当前选中的数据集契约 ID（若使用了注册数据源或指定了 datasetId）。
   */
  getDatasetId: () => string | undefined;

  /**
   * 获取当前选中的完整注册数据集元信息与原始记录。
   */
  getDataset: () => RegisteredDataset | undefined;

  /**
   * 编程式切换选中的数据集。
   */
  setDatasetId: (id: string) => void;

  /**
   * 刷新当前选中的数据集数据（若数据源为异步获取方法函数）。
   */
  refreshDataset: () => Promise<void>;

  /**
   * 当前数据集是否处于加载状态。
   */
  isDatasetLoading: () => boolean;
}

/** 面板核心受控/非受控组件 Props */
export interface DynamicDataConfigPanelProps {
  /**
   * 输入的原始数据集合或数据获取方法（直接代码模式）。
   * 支持传入 DataRecord[] 或 () => Promise<DataRecord[]> 异步获取函数。
   * 当未提供 data 且配置了 datasetId 或注册了数据集时，自动从注册数据源获取。
   */
  readonly data?: readonly DataRecord[] | DatasetDataLoader | undefined;
  /** 表头与字段键名映射字典（如 { sales: '销售额', cost: '成本' }） */
  readonly headers?: HeaderMapping | undefined;
  /**
   * 当前激活展示的数据集契约 ID（注册制模式）。
   * 若提供，将从注册表中自动选取对应数据集。
   */
  readonly datasetId?: string | undefined;
  /**
   * 显式传入的可选数据集列表（局部覆盖全局注册表）。
   * 若缺省，自动从 globalDatasetRegistry 读取所有已注册数据集。
   */
  readonly datasets?: readonly RegisteredDataset[] | undefined;
  /**
   * 当用户在面板中切换数据集时的回调函数。
   */
  readonly onDatasetChange?: ((datasetId: string, dataset: RegisteredDataset) => void) | undefined;
  /**
   * 是否展示顶部数据源选择器切换栏，默认 true (当候选数据源 > 1 时生效)
   */
  readonly showDatasetSelector?: boolean | undefined;
  /** 当前受控的配置项 */
  readonly value?: DynamicTransformConfig | undefined;
  /** 初始非受控默认配置 */
  readonly defaultValue?: DynamicTransformConfig | undefined;
  /** 配置变化时的回调 */
  readonly onChange?: ((config: DynamicTransformConfig) => void) | undefined;
  /** 计算结果发生变更时的回调（方便外部直接获取转换后数据） */
  readonly onTransformResult?: ((result: TransformResult) => void) | undefined;
  /** 字段探查样本限制条数，默认 100 */
  readonly sampleLimit?: number | undefined;
  /** 自定义外层样式 */
  readonly style?: CSSProperties | undefined;
  /** 自定义外层类名 */
  readonly className?: string | undefined;
  /** 国际化语言包或局部覆盖词条 */
  readonly locale?: DeepPartial<DynamicDataLocale> | undefined;
  /** 是否展示快速一键分析模板（趋势/对比/明细/占比），默认 true */
  readonly showQuickPresets?: boolean | undefined;
  /** 是否展示底层开发级 DSL (JSON) 复制与导入工具，默认 false (防用户认知过载) */
  readonly showDslTools?: boolean | undefined;
}
