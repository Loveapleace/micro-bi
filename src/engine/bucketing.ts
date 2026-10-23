/**
 * 时间分桶器 (Time Bucketer)
 *
 * 依据配置将任意形式的时间转换为聚合分桶 Key。
 */
import dayjs from 'dayjs';
import type { TimeBucketConfig } from './types.js';

/**
 * 将单个时间值格式化为分桶聚合键
 */
export function formatTimeBucket(value: unknown, config: TimeBucketConfig): string {
  if (value === null || value === undefined || value === '') {
    return '(无时间)';
  }

  const normalizedValue =
    typeof value === 'string' && /^\d{10}$/.test(value)
      ? Number(value) * 1000
      : typeof value === 'number' && Math.abs(value) >= 1000000000 && Math.abs(value) < 10000000000
      ? value * 1000
      : value as string | number | Date;
  const d = dayjs(normalizedValue);

  if (!d.isValid()) {
    return '(无效时间)';
  }

  const { granularity, format, weekStartsOn = 1 } = config;

  switch (granularity) {
    case 'hour':
      return format ? d.format(format) : d.format('YYYY-MM-DD HH:00');

    case 'day':
      return format ? d.format(format) : d.format('YYYY-MM-DD');

    case 'week': {
      // 计算周起始日（weekStartsOn = 1: 周一, 0: 周日）
      const currentDay = d.day(); // 0 是周日，1 是周一... 6 是周六
      let diffDays = 0;
      if (weekStartsOn === 1) {
        // 周一为首日
        diffDays = currentDay === 0 ? -6 : 1 - currentDay;
      } else {
        // 周日为首日
        diffDays = -currentDay;
      }
      const startOfWeek = d.add(diffDays, 'day');
      if (format) return startOfWeek.format(format);
      // 正确计算“月内第几周”：以该周起始日所在月份首日的星期偏移对齐后取整
      const firstOfMonth = startOfWeek.startOf('month');
      const weekStart = weekStartsOn === 1 ? 1 : 0;
      const offset = (firstOfMonth.day() - weekStart + 7) % 7;
      const weekOfMonth = Math.ceil((startOfWeek.date() + offset) / 7);
      return `${startOfWeek.format('YYYY-MM-DD')} (第${weekOfMonth}周)`;
    }

    case 'month':
      return format ? d.format(format) : d.format('YYYY-MM');

    case 'quarter': {
      const month = d.month(); // 0 - 11
      const q = Math.floor(month / 3) + 1;
      return format ? d.format(format) : `${d.year()}-Q${q}`;
    }

    case 'year':
      return format ? d.format(format) : d.format('YYYY');

    case 'custom': {
      const daysInterval = Math.max(1, config.customIntervalDays ?? 1);
      // 以本地时区 2000-01-01 00:00 为基准、按本地自然日切分，
      // 避免 UTC 毫秒基准与本地时区格式化不一致导致桶边界在非 UTC 时区漂移。
      const baseMs = dayjs('2000-01-01').valueOf();
      const oneDayMs = 86400000;
      const dayStartMs = d.startOf('day').valueOf();
      const diffDays = Math.round((dayStartMs - baseMs) / oneDayMs);
      const bucketIndex = Math.floor(diffDays / daysInterval);
      const startMs = baseMs + bucketIndex * daysInterval * oneDayMs;
      const endMs = startMs + (daysInterval - 1) * oneDayMs;
      const startStr = dayjs(startMs).format('YYYY-MM-DD');
      const endStr = dayjs(endMs).format('YYYY-MM-DD');
      return daysInterval === 1 ? startStr : `${startStr} ~ ${endStr}`;
    }

    default:
      return d.format('YYYY-MM-DD');
  }
}
