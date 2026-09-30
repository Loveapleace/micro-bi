/**
 * 行业指标计算模板与热拔插注册表 (Metric Template Registry)
 */
import type { Identifiable } from '../types.js';
import { createRegistry } from '../core/registry.js';
import type { ColumnConfig, FieldDataType } from './types.js';

/** 行业指标模板所需原字段依赖声明 */
export interface TemplateFieldRequirement {
  /** 模板内部变量名，例如 'revenue' 或 'cost' */
  readonly key: string;
  /** 给用户在 UI 映射时展示的友好说明，例如 '主营业务收入' */
  readonly label: string;
  /** 要求的数据类型 */
  readonly type: FieldDataType;
}

/** 行业指标模板契约接口 */
export interface MetricTemplate extends Identifiable {
  /** 唯一标识，例如 'retail:gross_margin' */
  readonly id: string;
  /** 模板显示名称，例如 '零售业 - 综合毛利率' */
  readonly name: string;
  /** 行业分类，例如 '零售电商'、'SaaS软件'、'财务管理' */
  readonly category: string;
  /** 指标详细解释与业务意义 */
  readonly description?: string;
  /** 依赖的原数据字段规范 */
  readonly requires: readonly TemplateFieldRequirement[];
  /**
   * 根据用户的字段映射字典，生成推荐的度量列与动态计算列
   * @param mapping 用户选择的原数据字段字典，如 { sales: 'sales', cost: 'cost' }
   */
  createColumns(
    mapping: Readonly<Record<string, string>>
  ): readonly ColumnConfig[];
}

/** 全局行业指标模板注册表 */
export const metricTemplateRegistry = createRegistry<MetricTemplate>();

/**
 * 注册内置基础常用模板
 */
export function registerDefaultMetricTemplates(): void {
  // 1. 零售 - 销售毛利与毛利率
  metricTemplateRegistry.register({
    id: 'retail:gross_profit',
    name: '零售 - 毛利与毛利率',
    category: '零售电商',
    description: '自动基于销售额与采购成本，计算销售总额、总成本、综合毛利额及毛利率。',
    requires: [
      { key: 'sales', label: '销售额/营业额', type: 'number' },
      { key: 'cost', label: '商品成本/采购额', type: 'number' },
    ],
    createColumns(mapping) {
      const salesField = mapping['sales'] || 'sales';
      const costField = mapping['cost'] || 'cost';

      return [
        { type: 'aggregated', field: salesField, agg: 'sum', label: '销售额' },
        { type: 'aggregated', field: costField, agg: 'sum', label: '采购成本' },
        {
          type: 'computed',
          name: 'gross_profit',
          label: '毛利额',
          expression: `[${salesField}] - [${costField}]`,
          precision: 2,
        },
        {
          type: 'computed',
          name: 'gross_margin_rate',
          label: '毛利率(%)',
          expression: `IF([${salesField}] > 0, ROUND(([${salesField}] - [${costField}]) / [${salesField}] * 100, 2), 0)`,
          precision: 2,
        },
      ];
    },
  });

  // 2. 销售转化 - 客单价 (ATV)
  metricTemplateRegistry.register({
    id: 'retail:average_order_value',
    name: '零售 - 客单价 (ATV)',
    category: '零售电商',
    description: '计算每笔订单或用户的平均消费金额。',
    requires: [
      { key: 'amount', label: '支付总金额', type: 'number' },
      { key: 'order_id', label: '订单ID', type: 'text' },
    ],
    createColumns(mapping) {
      const amountField = mapping['amount'] || 'amount';
      const orderIdField = mapping['order_id'] || 'order_id';

      return [
        { type: 'aggregated', field: amountField, agg: 'sum', label: '总支付金额' },
        { type: 'aggregated', field: orderIdField, agg: 'count', label: '订单数' },
        {
          type: 'computed',
          name: 'atv',
          label: '平均客单价',
          expression: `IF([COUNT(${orderIdField})] > 0, ROUND([SUM(${amountField})] / [COUNT(${orderIdField})], 2), 0)`,
          precision: 2,
        },
      ];
    },
  });

  // 3. 评级打标 - 业绩达标状态
  metricTemplateRegistry.register({
    id: 'performance:achievement_grade',
    name: '考核 - 业绩档位打标',
    category: '经营考核',
    description: '根据目标达成情况自动为分组打上 S/A/B 绩效等级标签。',
    requires: [
      { key: 'perf', label: '完成金额', type: 'number' },
    ],
    createColumns(mapping) {
      const perfField = mapping['perf'] || 'perf';

      return [
        { type: 'aggregated', field: perfField, agg: 'sum', label: '完成金额' },
        {
          type: 'computed',
          name: 'grade',
          label: '评级档位',
          expression: `IF([${perfField}] >= 100000, 'S级卓越', IF([${perfField}] >= 50000, 'A级良好', 'B级待提升'))`,
        },
      ];
    },
  });
}

// 默认初始化预置模板
registerDefaultMetricTemplates();
