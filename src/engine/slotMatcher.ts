/**
 * 语义槽位智能匹配引擎 (Semantic Slot Matcher)
 *
 * 核心目标：
 * 摆脱传统模板硬编码具体物理字段名的限制，通过“业务词根匹配（40%）+ 字段物理类型（40%）+ 数据特征画像（20%）”
 * 启发式置信度评分算法，将抽象业务模板（如：分析主体 × 时间周期 × 核心度量）自适应映射到任意异构数据集的真实字段上。
 */
import type {
  FieldMeta,
  DimensionConfig,
  ColumnConfig,
  DynamicTransformConfig,
  TimeGranularity,
} from './types.js';

export type SemanticSlotRole =
  | 'entity_category'    // 分析主体分类 (车间、部门、产品型号、工厂、产线、客户等)
  | 'time'               // 时间字段 (计划时间、创建时间、完工时间等)
  | 'status_category'    // 状态离散分类 (工单状态、检验结果、等级等低基数字段)
  | 'volume_metric'      // 体量型数值度量 (产量、件数、销售额、工时等)
  | 'ratio_metric';      // 比率型数值度量 (良品率、合格率、达成率、占比等)

export interface SlotCandidate {
  readonly fieldKey: string;
  readonly fieldLabel: string;
  readonly score: number;
}

export interface SemanticSlotMatchResult {
  readonly slotId: string;
  readonly role: SemanticSlotRole;
  readonly title: string;
  readonly description?: string | undefined;
  readonly required?: boolean | undefined;
  readonly matchedField?: string | undefined;
  readonly matchedFieldLabel?: string | undefined;
  readonly confidence: number; // 0 ~ 100
  readonly candidates: readonly SlotCandidate[];
}

export interface ResolvedSlots {
  rowEntityKey?: string | undefined;
  colTimeKey?: string | undefined;
  colTimeGranularity?: TimeGranularity | undefined;
  colCategoryKey?: string | undefined;
  metricKeys?: string[] | undefined;
  indicatorsAsCol?: boolean | undefined;
}

/**
 * 业务词根特征库
 */
const TIME_KEYWORD_REGEX = /plan|start|date|time|day|month|year|created|updated|时间|日期|月份|投产|完工|创建/i;
const ENTITY_KEYWORD_REGEX = /shop|dept|org|factory|line|category|type|client|user|customer|item|part|workshop|work_order_name|name|车间|部门|组织|工厂|产线|品类|类别|主体|工件|客户|产品/i;
const ENTITY_PENALTY_REGEX = /id|no|code|sn|uuid|流水号|编号|条码|批号/i;
const STATUS_KEYWORD_REGEX = /status|state|result|grade|level|phase|step|状态|类型|结果|等级|合格|阶段/i;
const VOLUME_KEYWORD_REGEX = /qty|count|amount|total|sum|sales|output|volume|capacity|duration|hours|cost|件数|数量|金额|产值|产量|总|工时|耗时|缺陷/i;
const RATIO_KEYWORD_REGEX = /rate|ratio|pct|percent|yield|margin|良率|比率|占比|达成率|合格率|利润率/i;

/**
 * 为单个字段在特定语义角色上计算置信度匹配分 (0 ~ 100)
 */
export function scoreFieldForRole(field: FieldMeta, role: SemanticSlotRole): number {
  let score = 0;
  const nameToTest = `${field.key} ${field.label || ''}`;

  switch (role) {
    case 'time': {
      if (field.type === 'time') {
        score += 60;
      } else {
        return 0; // 非时间字段不匹配时间槽位
      }
      if (TIME_KEYWORD_REGEX.test(nameToTest)) {
        score += 30;
      }
      // 优先计划/投产/创建时间，微扣更新时间
      if (/plan|start|created|计划|投产|创建/i.test(nameToTest)) {
        score += 10;
      } else if (/update|updated_at|更新/i.test(nameToTest)) {
        score -= 10;
      }
      break;
    }

    case 'entity_category': {
      if (field.type === 'text') {
        score += 45;
      } else {
        return 0;
      }
      if (ENTITY_KEYWORD_REGEX.test(nameToTest)) {
        score += 35;
      }
      // 严重降权 ID / 流水号 / UUID 等高基数无业务分类语义的字段
      if (ENTITY_PENALTY_REGEX.test(nameToTest)) {
        score -= 40;
      }
      // 若有样本值，检查基数合理性 (通常分类字段样本唯一值数量在 2~50 之间)
      if (field.sampleValues && field.sampleValues.length > 0) {
        const uniqueCount = new Set(field.sampleValues).size;
        if (uniqueCount >= 2 && uniqueCount <= 20) {
          score += 10;
        }
      }
      break;
    }

    case 'status_category': {
      if (field.type === 'text') {
        score += 40;
      } else {
        return 0;
      }
      if (STATUS_KEYWORD_REGEX.test(nameToTest)) {
        score += 50;
      }
      if (ENTITY_PENALTY_REGEX.test(nameToTest)) {
        score -= 40;
      }
      break;
    }

    case 'volume_metric': {
      if (field.type === 'number') {
        score += 50;
      } else {
        return 0;
      }
      if (VOLUME_KEYWORD_REGEX.test(nameToTest)) {
        score += 40;
      }
      // 若包含比率词根，降低体量匹配分
      if (RATIO_KEYWORD_REGEX.test(nameToTest) || nameToTest.includes('%')) {
        score -= 30;
      }
      break;
    }

    case 'ratio_metric': {
      if (field.type === 'number') {
        score += 50;
      } else {
        return 0;
      }
      if (RATIO_KEYWORD_REGEX.test(nameToTest) || nameToTest.includes('%')) {
        score += 45;
      }
      // 降权纯绝对数量词根
      if (/qty|count|件数|数量/i.test(nameToTest) && !RATIO_KEYWORD_REGEX.test(nameToTest)) {
        score -= 30;
      }
      break;
    }
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * 匹配特定角色槽位的最佳字段候选
 */
export function matchSlot(
  slotId: string,
  role: SemanticSlotRole,
  title: string,
  fields: readonly FieldMeta[],
  options: {
    description?: string;
    required?: boolean;
    excludedKeys?: readonly string[];
  } = {}
): SemanticSlotMatchResult {
  const { description, required = true, excludedKeys = [] } = options;
  const candidates: SlotCandidate[] = [];

  for (const f of fields) {
    if (excludedKeys.includes(f.key)) continue;
    const score = scoreFieldForRole(f, role);
    if (score > 0) {
      candidates.push({
        fieldKey: f.key,
        fieldLabel: f.label || f.key,
        score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  return {
    slotId,
    role,
    title,
    description,
    required,
    matchedField: best?.fieldKey,
    matchedFieldLabel: best?.fieldLabel,
    confidence: best?.score ?? 0,
    candidates,
  };
}

/**
 * 透视分析预设模板定义
 */
export interface SemanticTemplateMeta {
  readonly id: string;
  readonly name: string;
  readonly badge?: string;
  readonly description: string;
  readonly isCrossTab: boolean;
  readonly indicatorsAsCol: boolean;
}

export const PIVOT_TEMPLATES: readonly SemanticTemplateMeta[] = [
  {
    id: 'pivot_trend',
    name: '月度趋势双向透视',
    badge: '双向交叉透视',
    description: '行按分类主体（车间/部门），列按月度横向展开，指标在列头横向平铺，对比各主体月度走势。',
    isCrossTab: true,
    indicatorsAsCol: true,
  },
  {
    id: 'pivot_multi_metric',
    name: '多指标综合体检透视',
    badge: '指标纵向排布',
    description: '行按分类主体垂直嵌套各指标（纵向行展开），列按月度横向展开，连贯检视多项综合指标。',
    isCrossTab: true,
    indicatorsAsCol: false,
  },
];

/**
 * 为指定模板推断全量语义槽位绑定
 */
export function inferSlotsForTemplate(
  templateId: string,
  fields: readonly FieldMeta[]
): {
  rowEntitySlot: SemanticSlotMatchResult;
  colTimeSlot: SemanticSlotMatchResult;
  metricsSlots: SemanticSlotMatchResult[];
  indicatorsAsCol: boolean;
} {
  const isMultiMetric = templateId === 'pivot_multi_metric';

  // 1. 匹配分析主体 (行维度)
  const rowEntitySlot = matchSlot(
    'row_entity',
    'entity_category',
    '分析主体 (行维度)',
    fields,
    { description: '作为表格行沿纵向向下排布 (如承制车间、生产线)' }
  );

  // 2. 匹配时间周期 (列维度)
  const colTimeSlot = matchSlot(
    'col_time',
    'time',
    '时间周期 (列维度)',
    fields,
    { description: '作为表头沿横向向右矩阵展开 (按月汇总)' }
  );

  // 3. 匹配指标槽位
  const metricsSlots: SemanticSlotMatchResult[] = [];
  const matchedMetricKeys: string[] = [];

  // 首先匹配 1 个核心体量指标 (求和)
  const volSlot = matchSlot(
    'metric_vol',
    'volume_metric',
    '核心体量指标',
    fields,
    { description: '求和聚合度量 (如交付件数、产值)' }
  );
  if (volSlot.matchedField) {
    metricsSlots.push(volSlot);
    matchedMetricKeys.push(volSlot.matchedField);
  }

  // 其次匹配 1 个比率型指标 (均值)
  const ratioSlot = matchSlot(
    'metric_ratio',
    'ratio_metric',
    '比率/质量指标',
    fields,
    { description: '均值/比率度量 (如综合良品率)', excludedKeys: matchedMetricKeys }
  );
  if (ratioSlot.matchedField) {
    metricsSlots.push(ratioSlot);
    matchedMetricKeys.push(ratioSlot.matchedField);
  }

  // 如果是多指标体检模式，继续补充其他数值指标 (最多凑齐 3~4 个)
  if (isMultiMetric) {
    const remainingNumberFields = fields.filter(
      (f) => f.type === 'number' && !matchedMetricKeys.includes(f.key)
    );
    for (let i = 0; i < Math.min(2, remainingNumberFields.length); i++) {
      const extraField = remainingNumberFields[i]!;
      metricsSlots.push({
        slotId: `metric_extra_${i}`,
        role: 'volume_metric',
        title: `综合指标 ${i + 3}`,
        matchedField: extraField.key,
        matchedFieldLabel: extraField.label || extraField.key,
        confidence: 70,
        candidates: [{ fieldKey: extraField.key, fieldLabel: extraField.label, score: 70 }],
      });
      matchedMetricKeys.push(extraField.key);
    }
  }

  return {
    rowEntitySlot,
    colTimeSlot,
    metricsSlots,
    indicatorsAsCol: !isMultiMetric,
  };
}

/**
 * 根据确认的槽位绑定生成标准的 DynamicTransformConfig
 */
export function buildTransformConfigFromSlots(
  templateId: string,
  resolved: ResolvedSlots,
  fields: readonly FieldMeta[]
): DynamicTransformConfig {
  const isMultiMetric = templateId === 'pivot_multi_metric';
  const indicatorsAsCol = resolved.indicatorsAsCol !== undefined ? resolved.indicatorsAsCol : !isMultiMetric;

  // 1. 维度配置
  const dimensions: DimensionConfig = {
    categories: resolved.rowEntityKey ? [resolved.rowEntityKey] : undefined,
    columnTimeBucket: resolved.colTimeKey
      ? {
          field: resolved.colTimeKey,
          granularity: resolved.colTimeGranularity || 'month',
          customIntervalDays: 7,
        }
      : undefined,
    indicatorsAsCol,
    rowTotals: { showGrandTotals: true, grandTotalLabel: '车间总计' },
    columnTotals: { showGrandTotals: true, grandTotalLabel: '全期总计' },
  };

  // 2. 指标列生成
  const selectedMetricKeys = resolved.metricKeys && resolved.metricKeys.length > 0
    ? resolved.metricKeys
    : fields.filter((f) => f.type === 'number').slice(0, 3).map((f) => f.key);

  const columns: ColumnConfig[] = selectedMetricKeys.map((key) => {
    const fieldMeta = fields.find((f) => f.key === key);
    const label = fieldMeta?.label || key;
    // 如果是比率型指标，使用 avg 聚合；体量型使用 sum
    const isRatio = RATIO_KEYWORD_REGEX.test(key) || (label && RATIO_KEYWORD_REGEX.test(label));
    const agg = isRatio ? 'avg' : 'sum';

    return {
      type: 'aggregated',
      field: key,
      agg,
      label,
    };
  });

  return {
    dimensions,
    columns,
  };
}
