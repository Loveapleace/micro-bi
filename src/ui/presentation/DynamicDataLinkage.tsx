/**
 * 展示层同源数据联动总线与 Context (严格显式契约 datasetId)
 */
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from 'react';
import dayjs from 'dayjs';
import type { LinkageEvent, LinkageFilterSlice } from './types.js';

type LinkageListener = (event: LinkageEvent | null) => void;

/**
 * 健壮地从数据行中获取对应字段的值
 * 支持物理字段名（如 plan_start_time）与表头别名（如 计划投产时间）的双向映射
 */
export function getRowFieldValue(
  row: Record<string, any> | null | undefined,
  field: string,
  headers?: Record<string, string>
): unknown {
  if (!row || typeof row !== 'object' || !field) {
    return undefined;
  }

  // 1. 直接命中属性
  if (field in row) {
    return row[field];
  }

  // 2. 结合 headers 字典进行双向查找
  if (headers) {
    // 2.1 若 field 是表头中文别名 (例如 '计划投产时间')，查找对应的底层物理 key (例如 'plan_start_time')
    for (const [rawKey, label] of Object.entries(headers)) {
      if (label === field && rawKey in row) {
        return row[rawKey];
      }
    }
    // 2.2 若 field 是底层物理 key (例如 'plan_start_time')，但 row 上挂载了中文别名
    const label = headers[field];
    if (label && label in row) {
      return row[label];
    }
  }

  // 3. 不区分大小写的安全兜底
  const lowerField = field.toLowerCase();
  for (const k of Object.keys(row)) {
    if (k.toLowerCase() === lowerField) {
      return row[k];
    }
  }

  return undefined;
}

/**
 * 跨维度/时间分桶的高保真切片值匹配器 (Smart Slice Matcher)
 * 支持：
 * 1. 严格全等 (离散字符串/数值)
 * 2. 数值等价性 (如 100 === '100')
 * 3. 时间分桶的多级匹配：
 *    - 日期前缀对齐: '2026-08-01 08:30:00' 匹配 '2026-08-01' 或 '2026-08' 或 '2026'
 *    - 时间粒度对齐 (Dayjs):
 *      - 天 (YYYY-MM-DD)
 *      - 月 (YYYY-MM)
 *      - 年 (YYYY)
 *      - 小时 (YYYY-MM-DD HH:00 或 YYYY-MM-DD HH)
 *      - 季度 (YYYY-Q1 ~ YYYY-Q4)
 *      - 周区间或自定义天数范围 ('YYYY-MM-DD ~ YYYY-MM-DD')
 *      - 时间戳 (10位或13位数值)
 */
export function matchSliceValue(rawVal: unknown, sliceVal: unknown): boolean {
  if (rawVal === undefined || rawVal === null) {
    return sliceVal === undefined || sliceVal === null || sliceVal === '';
  }
  if (sliceVal === undefined || sliceVal === null) {
    return false;
  }

  const strRaw = String(rawVal).trim();
  const strSlice = String(sliceVal).trim();

  // 1. 离散字符串严格匹配 (极速通道)
  if (strRaw === strSlice) {
    return true;
  }

  // 2. 数值等价比对
  if (typeof rawVal === 'number' || typeof sliceVal === 'number') {
    const numRaw = Number(rawVal);
    const numSlice = Number(sliceVal);
    if (!Number.isNaN(numRaw) && !Number.isNaN(numSlice) && numRaw === numSlice) {
      return true;
    }
  }

  // 3. 常见时间字符串的前缀比对 (快速通道：'2026-08-01 08:30:00' 匹配 '2026-08-01' / '2026-08' / '2026')
  if (strRaw.startsWith(strSlice)) {
    const nextChar = strRaw.charAt(strSlice.length);
    if (['', ' ', 'T', '-', ':', '.'].includes(nextChar)) {
      return true;
    }
  }

  // 4. 时间分桶与跨粒度时间深度对齐
  let dRaw = dayjs(rawVal as any);
  if (!dRaw.isValid()) {
    if (typeof rawVal === 'string' && /^\d{10}$/.test(rawVal)) {
      dRaw = dayjs(Number(rawVal) * 1000);
    } else if (typeof rawVal === 'number' && rawVal < 10000000000) {
      dRaw = dayjs(rawVal * 1000);
    }
  }

  if (dRaw.isValid()) {
    // 4.1 天级别 YYYY-MM-DD
    if (dRaw.format('YYYY-MM-DD') === strSlice) return true;
    // 4.2 月级别 YYYY-MM
    if (dRaw.format('YYYY-MM') === strSlice) return true;
    // 4.3 年级别 YYYY
    if (dRaw.format('YYYY') === strSlice) return true;
    // 4.4 小时级别 YYYY-MM-DD HH:00 或 YYYY-MM-DD HH
    if (dRaw.format('YYYY-MM-DD HH:00') === strSlice || dRaw.format('YYYY-MM-DD HH') === strSlice) return true;
    // 4.5 季度级别 YYYY-Q[1-4]
    const q = Math.floor(dRaw.month() / 3) + 1;
    if (`${dRaw.year()}-Q${q}` === strSlice) return true;
    // 4.6 周级别
    if (strSlice.includes('(第') && strSlice.includes('周)')) {
      const currentDay = dRaw.day();
      const diffDays = currentDay === 0 ? -6 : 1 - currentDay;
      const startOfWeek = dRaw.add(diffDays, 'day');
      const weekPattern = `${startOfWeek.format('YYYY-MM-DD')} (第${Math.ceil(dRaw.date() / 7)}周)`;
      if (strSlice === weekPattern || strSlice.startsWith(startOfWeek.format('YYYY-MM-DD'))) return true;
    }
    // 4.7 范围区间 'YYYY-MM-DD ~ YYYY-MM-DD'
    if (strSlice.includes(' ~ ')) {
      const [startPart, endPart] = strSlice.split(' ~ ').map((s) => s.trim());
      const dStart = dayjs(startPart);
      const dEnd = dayjs(endPart);
      if (dStart.isValid() && dEnd.isValid()) {
        const rawMs = dRaw.valueOf();
        const startMs = dStart.startOf('day').valueOf();
        const endMs = dEnd.endOf('day').valueOf();
        if (rawMs >= startMs && rawMs <= endMs) return true;
      }
    }
    // 4.8 尝试将 slice 解析为有效日期对比
    const dSlice = dayjs(strSlice);
    if (dSlice.isValid()) {
      if (strSlice.length === 10 && dRaw.isSame(dSlice, 'day')) return true;
      if (strSlice.length === 7 && dRaw.isSame(dSlice, 'month')) return true;
      if (strSlice.length === 4 && dRaw.isSame(dSlice, 'year')) return true;
    }
  }

  return false;
}

/** 全局轻量事件总线（按 datasetId 隔离切片池与订阅分发） */
export class LinkageBus {
  private listeners = new Map<string, Set<LinkageListener>>();
  // 维护每个 datasetId 下当前已激活的切片池: Map<field, LinkageFilterSlice>
  private activeSlices = new Map<string, Map<string, LinkageFilterSlice>>();

  public getSlices(datasetId: string): LinkageFilterSlice[] {
    if (!datasetId) return [];
    const map = this.activeSlices.get(datasetId);
    return map ? Array.from(map.values()) : [];
  }

  public subscribe(datasetId: string, listener: LinkageListener): () => void {
    if (!datasetId) return () => {};
    if (!this.listeners.has(datasetId)) {
      this.listeners.set(datasetId, new Set());
    }
    const set = this.listeners.get(datasetId)!;
    set.add(listener);

    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(datasetId);
      }
    };
  }

  /**
   * 触发交互切片过滤：
   * - 若相同 field 且相同 value 已存在 -> 视为取消选择 (Toggle Off)
   * - 否则激活或覆盖该维度的切片
   */
  public toggleSlice(datasetId: string, slice: LinkageFilterSlice): void {
    if (!datasetId || !slice.field) return;
    if (!this.activeSlices.has(datasetId)) {
      this.activeSlices.set(datasetId, new Map());
    }
    const map = this.activeSlices.get(datasetId)!;
    const existing = map.get(slice.field);

    if (existing && (String(existing.value) === String(slice.value) || matchSliceValue(existing.value, slice.value))) {
      map.delete(slice.field);
    } else {
      map.set(slice.field, slice);
    }

    this.broadcast(datasetId, slice.sourceViewId);
  }

  /**
   * 移除指定维度的切片过滤条件
   */
  public removeSlice(datasetId: string, field: string): void {
    if (!datasetId || !field) return;
    const map = this.activeSlices.get(datasetId);
    if (!map) return;
    map.delete(field);
    this.broadcast(datasetId, '');
  }

  /**
   * 一键清空所有切片过滤条件
   */
  public clearAll(datasetId: string): void {
    if (!datasetId) return;
    this.activeSlices.delete(datasetId);
    this.broadcast(datasetId, '');
  }

  /**
   * 广播联动事件给所有订阅者
   */
  public broadcast(datasetId: string, sourceViewId: string = ''): void {
    if (!datasetId) return;
    const set = this.listeners.get(datasetId);
    if (!set) return;

    const slices = this.getSlices(datasetId);
    const lastSlice = slices[slices.length - 1];

    const event: LinkageEvent | null =
      slices.length === 0
        ? null
        : {
            datasetId,
            sourceViewId,
            dimensionField: lastSlice?.field,
            dimensionTitle: lastSlice?.fieldTitle,
            dimensionValue: lastSlice?.value,
            record: lastSlice?.record,
            activeSlices: slices,
          };

    for (const listener of set) {
      try {
        listener(event);
      } catch (err) {
        console.error('[LinkageBus] Error in listener callback:', err);
      }
    }
  }

  /**
   * 兼容旧版单一事件发送（如需直接抛出）
   */
  public emit(datasetId: string, event: LinkageEvent | null): void {
    if (!datasetId) return;
    if (!event) {
      this.clearAll(datasetId);
      return;
    }
    if (event.dimensionField && event.dimensionValue !== undefined && event.dimensionValue !== null) {
      this.toggleSlice(datasetId, {
        datasetId,
        sourceViewId: event.sourceViewId,
        field: event.dimensionField,
        fieldTitle: event.dimensionTitle,
        value: event.dimensionValue,
        record: event.record,
      });
    } else {
      // 直接分发通知
      const set = this.listeners.get(datasetId);
      if (!set) return;
      for (const listener of set) {
        try {
          listener(event);
        } catch (err) {
          console.error('[LinkageBus] Error in listener callback:', err);
        }
      }
    }
  }
}

export const globalLinkageBus = new LinkageBus();

interface LinkageContextValue {
  /** 当前 Provider 绑定的显式 datasetId */
  datasetId?: string | undefined;
  /** 当前激活的联动事件 */
  currentEvent: LinkageEvent | null;
  /** 当前激活的切片池 */
  activeSlices: readonly LinkageFilterSlice[];
  /** 触发或切换切片 */
  toggleSlice: (slice: Omit<LinkageFilterSlice, 'datasetId'>) => void;
  /** 移除特定维度切片 */
  removeSlice: (field: string) => void;
  /** 清空所有切片 */
  clearSlices: () => void;
}

const DynamicDataLinkageContext = createContext<LinkageContextValue>({
  datasetId: undefined,
  currentEvent: null,
  activeSlices: [],
  toggleSlice: () => {},
  removeSlice: () => {},
  clearSlices: () => {},
});

export interface DynamicDataLinkageProviderProps {
  /** 显式数据集唯一契约 ID（必填，同源联动必须相同） */
  datasetId: string;
  children: ReactNode;
}

/**
 * 显式同源数据联动 Provider 容器
 * 适用于将多个展示图表/表格包裹在同一个作用域中共享联动状态
 */
export const DynamicDataLinkageProvider: React.FC<DynamicDataLinkageProviderProps> = ({
  datasetId,
  children,
}) => {
  const [currentEvent, setCurrentEvent] = useState<LinkageEvent | null>(() => {
    if (!datasetId) return null;
    const slices = globalLinkageBus.getSlices(datasetId);
    if (slices.length === 0) return null;
    const last = slices[slices.length - 1];
    return {
      datasetId,
      sourceViewId: last?.sourceViewId || '',
      dimensionField: last?.field,
      dimensionTitle: last?.fieldTitle,
      dimensionValue: last?.value,
      record: last?.record,
      activeSlices: slices,
    };
  });

  // 监听全局总线对应 datasetId 的广播，保持同步；当 Provider 容器卸载时自动清理残留切片，杜绝跨生命周期污染与内存泄漏
  useEffect(() => {
    if (!datasetId) return;
    const unsubscribe = globalLinkageBus.subscribe(datasetId, (event) => {
      setCurrentEvent(event);
    });
    return () => {
      unsubscribe();
      globalLinkageBus.clearAll(datasetId);
    };
  }, [datasetId]);

  const toggleSlice = useCallback(
    (slice: Omit<LinkageFilterSlice, 'datasetId'>) => {
      if (!datasetId) return;
      globalLinkageBus.toggleSlice(datasetId, {
        ...slice,
        datasetId,
      });
    },
    [datasetId]
  );

  const removeSlice = useCallback(
    (field: string) => {
      if (!datasetId) return;
      globalLinkageBus.removeSlice(datasetId, field);
    },
    [datasetId]
  );

  const clearSlices = useCallback(() => {
    if (!datasetId) return;
    globalLinkageBus.clearAll(datasetId);
  }, [datasetId]);

  return (
    <DynamicDataLinkageContext.Provider
      value={{
        datasetId,
        currentEvent,
        activeSlices: currentEvent?.activeSlices || [],
        toggleSlice,
        removeSlice,
        clearSlices,
      }}
    >
      {children}
    </DynamicDataLinkageContext.Provider>
  );
};

/**
 * 显式同源数据联动 Hook
 * @param explicitDatasetId 组件显式传入的 datasetId
 * @param viewId 组件唯一标识（防止接收自身事件死循环）
 * @param enabled 是否开启联动
 */
export function useDynamicDataLinkage(
  explicitDatasetId: string | undefined,
  viewId: string,
  enabled: boolean = true
) {
  const context = useContext(DynamicDataLinkageContext);
  // 显式契约优先级：组件自身显式传入的 datasetId 优先于 Provider
  const effectiveDatasetId = explicitDatasetId || context.datasetId;

  const [activeEvent, setActiveEvent] = useState<LinkageEvent | null>(() => {
    if (!effectiveDatasetId || !enabled) return null;
    const slices = globalLinkageBus.getSlices(effectiveDatasetId);
    if (slices.length === 0) return null;
    const last = slices[slices.length - 1];
    return {
      datasetId: effectiveDatasetId,
      sourceViewId: last?.sourceViewId || '',
      dimensionField: last?.field,
      dimensionTitle: last?.fieldTitle,
      dimensionValue: last?.value,
      record: last?.record,
      activeSlices: slices,
    };
  });

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // 订阅广播：只有具备有效 datasetId 且开启 linkage 时才订阅
  useEffect(() => {
    if (!enabled || !effectiveDatasetId) {
      setActiveEvent(null);
      return;
    }

    const unsubscribe = globalLinkageBus.subscribe(effectiveDatasetId, (event) => {
      if (!isMountedRef.current) return;
      setActiveEvent(event);
    });

    return unsubscribe;
  }, [effectiveDatasetId, viewId, enabled]);

  // 触发/切换切片
  const toggleSlice = useCallback(
    (slice: Omit<LinkageFilterSlice, 'datasetId' | 'sourceViewId'>) => {
      if (!enabled || !effectiveDatasetId) return;
      globalLinkageBus.toggleSlice(effectiveDatasetId, {
        ...slice,
        datasetId: effectiveDatasetId,
        sourceViewId: viewId,
      });
    },
    [effectiveDatasetId, viewId, enabled]
  );

  // 移除单个切片
  const removeSlice = useCallback(
    (field: string) => {
      if (!enabled || !effectiveDatasetId) return;
      globalLinkageBus.removeSlice(effectiveDatasetId, field);
    },
    [effectiveDatasetId, enabled]
  );

  // 一键重置清空全部切片
  const clearSlices = useCallback(() => {
    if (!enabled || !effectiveDatasetId) return;
    globalLinkageBus.clearAll(effectiveDatasetId);
  }, [effectiveDatasetId, enabled]);

  // 兼容旧接口 emitLinkage
  const emitLinkage = useCallback(
    (payload: Omit<LinkageEvent, 'datasetId' | 'sourceViewId'> | null) => {
      if (!enabled || !effectiveDatasetId) return;
      if (!payload) {
        clearSlices();
        return;
      }
      if (payload.dimensionField && payload.dimensionValue !== undefined && payload.dimensionValue !== null) {
        toggleSlice({
          field: payload.dimensionField,
          fieldTitle: payload.dimensionTitle,
          value: payload.dimensionValue,
          record: payload.record,
        });
      } else {
        const fullEvent: LinkageEvent = {
          ...payload,
          datasetId: effectiveDatasetId,
          sourceViewId: viewId,
        };
        setActiveEvent(fullEvent);
        globalLinkageBus.emit(effectiveDatasetId, fullEvent);
      }
    },
    [effectiveDatasetId, viewId, enabled, toggleSlice, clearSlices]
  );

  const activeSlices = activeEvent?.activeSlices || [];

  return {
    datasetId: effectiveDatasetId,
    activeEvent,
    activeSlices,
    toggleSlice,
    removeSlice,
    clearSlices,
    emitLinkage,
    isLinked: Boolean(enabled && effectiveDatasetId),
  };
}
