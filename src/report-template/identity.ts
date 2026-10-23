/**
 * 稳定实例与语义身份编解码工具
 */

export interface InstanceKeyComponents {
  templateCellId: string;
  regionId: string;
  rowPath: string;
  columnPath: string;
  metricId: string;
  role: string;
}

/**
 * 规范化成员值，确保区分数字 1、字符串 "1"、null、空串
 */
export function encodeMemberValue(val: unknown): string {
  if (val === null) return '__NULL__';
  if (val === undefined) return '__UNDEFINED__';
  if (typeof val === 'number') return `n:${val}`;
  if (typeof val === 'boolean') return `b:${val}`;
  if (typeof val === 'string') return `s:${encodeURIComponent(val)}`;
  return `o:${JSON.stringify(val)}`;
}

/**
 * 编码维度路径元组
 */
export function encodeMemberTuple(tuple: readonly unknown[]): string {
  if (!tuple || tuple.length === 0) return '__ROOT__';
  return tuple.map(encodeMemberValue).join('/');
}

/**
 * 解码成员元组项
 */
export function decodeMemberValue(encoded: string): unknown {
  if (encoded === '__NULL__') return null;
  if (encoded === '__UNDEFINED__') return undefined;
  if (encoded.startsWith('n:')) return Number(encoded.slice(2));
  if (encoded.startsWith('b:')) return encoded.slice(2) === 'true';
  if (encoded.startsWith('s:')) return decodeURIComponent(encoded.slice(2));
  if (encoded.startsWith('o:')) {
    try {
      return JSON.parse(encoded.slice(2));
    } catch {
      return encoded.slice(2);
    }
  }
  return encoded;
}

/**
 * 解码维度路径元组
 */
export function decodeMemberTuple(encodedTuple: string): unknown[] {
  if (!encodedTuple || encodedTuple === '__ROOT__' || encodedTuple === '__NONE__') return [];
  return encodedTuple.split('/').map(decodeMemberValue);
}

/**
 * 构造稳定的展开实例键
 */
export function buildInstanceKey(components: InstanceKeyComponents): string {
  const { templateCellId, regionId, rowPath, columnPath, metricId, role } = components;
  return [
    templateCellId,
    regionId,
    `r=${rowPath}`,
    `c=${columnPath}`,
    `m=${metricId}`,
    `role=${role}`,
  ].join('::');
}

/**
 * 解析实例键
 */
export function parseInstanceKey(key: string): InstanceKeyComponents | null {
  const parts = key.split('::');
  if (parts.length < 6) return null;
  const templateCellId = parts[0];
  const regionId = parts[1];
  const rPart = parts[2];
  const cPart = parts[3];
  const mPart = parts[4];
  const rolePart = parts[5];

  if (!templateCellId || !regionId || !rPart || !cPart || !mPart || !rolePart) {
    return null;
  }

  return {
    templateCellId,
    regionId,
    rowPath: rPart.replace(/^r=/, ''),
    columnPath: cPart.replace(/^c=/, ''),
    metricId: mPart.replace(/^m=/, ''),
    role: rolePart.replace(/^role=/, ''),
  };
}

let counter = 0;
export function generateTemplateCellId(prefix: string = 'c'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function generateRegionId(prefix: string = 'reg'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/**
 * 统一、确定性地派生字段身份（fieldId）。
 * 全链路（设计器/向导/归一层）共用同一口径：由物理 fieldKey 派生，
 * 显示标题（displayName）变化不影响 fieldId；物理 fieldKey 变更视为语义变化。
 */
export function resolveFieldId(fieldKey: string): string {
  return `f-${fieldKey}`;
}

/**
 * 统一、确定性地派生指标身份（metricId）。
 * 由字段/表达式与聚合方式共同派生，避免不同字段或不同聚合截断碰撞。
 */
export function resolveMetricId(fieldOrExpr: string, agg: string = 'val'): string {
  const sanitized = fieldOrExpr.replace(/[^a-zA-Z0-9_]/g, '_');
  return `m_${agg}_${sanitized}`;
}

export function generateMetricId(fieldOrExpr: string, agg: string = 'val'): string {
  return resolveMetricId(fieldOrExpr, agg);
}

/**
 * 计算 ReportBinding 的稳定业务签名，用于动态合并等跨数据重定位
 */
export function computeBindingSignature(b: any): string {
  if (!b || !b.semantic) return '';
  const row = (b.semantic.rowPath || []).map((p: any) => [p.field, p.memberKey]);
  const col = (b.semantic.columnPath || []).map((p: any) => [p.field, p.memberKey]);
  return JSON.stringify({
    role: b.semantic.role,
    metric: b.semantic.metricId,
    row,
    col,
  });
}

export interface GroupContextKeyComponents {
  regionId: string;
  axis: 'row' | 'column';
  fieldId: string;
  memberPath: string;
}

/**
 * 构造分组上下文取消键 (GroupContextKey)
 * 格式：grp::<regionId>::<axis>::<fieldId>::<memberPath>
 */
export function buildGroupContextKey(components: GroupContextKeyComponents): string {
  const { regionId, axis, fieldId, memberPath } = components;
  return `grp::${regionId}::${axis}::${fieldId}::${memberPath}`;
}

/**
 * 解析分组上下文取消键
 */
export function parseGroupContextKey(key: string): GroupContextKeyComponents | null {
  if (!key || !key.startsWith('grp::')) return null;
  const parts = key.split('::');
  if (parts.length < 5) return null;
  return {
    regionId: parts[1] || '',
    axis: parts[2] === 'column' ? 'column' : 'row',
    fieldId: parts[3] || '',
    memberPath: parts.slice(4).join('::'),
  };
}

/**
 * 计算字段轴 Schema 签名 (用于动态合并规则校验与迁移防串)
 */
export function computeAxisSchemaSignature(params: {
  datasetId?: string | undefined;
  fieldId: string;
  timeBucket?: {
    granularity: string;
    timezone?: string | undefined;
    weekStartsOn?: number | undefined;
  } | undefined;
}): string {
  return JSON.stringify({
    ds: params.datasetId || '',
    f: params.fieldId,
    tb: params.timeBucket
      ? {
          g: params.timeBucket.granularity,
          tz: params.timeBucket.timezone,
          ws: params.timeBucket.weekStartsOn,
        }
      : null,
  });
}
