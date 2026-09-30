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
}

/** 面板核心受控/非受控组件 Props */
export interface DynamicDataConfigPanelProps {
  /** 输入的原始数据集合 */
  readonly data: readonly DataRecord[];
  /** 表头与字段键名映射字典（如 { sales: '销售额', cost: '成本' }） */
  readonly headers?: HeaderMapping | undefined;
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
