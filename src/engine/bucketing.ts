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

  let d = dayjs(value as string | number | Date);
  if (!d.isValid()) {
    // 尝试转数字时间戳（如 10 位秒时间戳）
    if (typeof value === 'string' && /^\d{10}$/.test(value)) {
      d = dayjs(Number(value) * 1000);
    } else if (typeof value === 'number' && value < 10000000000) {
      d = dayjs(value * 1000);
    }
  }

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
      return format ? startOfWeek.format(format) : `${startOfWeek.format('YYYY-MM-DD')} (第${Math.ceil(d.date() / 7)}周)`;
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
      // 以 2000-01-01 为相对基准计算天数分片
      const baseMs = 946684800000; // 2000-01-01T00:00:00Z
      const oneDayMs = 86400000;
      const targetMs = d.valueOf();
      const diffDays = Math.floor((targetMs - baseMs) / oneDayMs);
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
