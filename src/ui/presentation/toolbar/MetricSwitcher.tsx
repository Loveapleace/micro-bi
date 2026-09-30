/**
 * 展示层运行时二次指标切换器 (MetricSwitcher)
 * - 基于已处理完成的 TransformResult 快速切换
 * - 支持单选 (Segmented) 与多选 (Checkbox/Tag) 模式
 */
import React, { useMemo } from 'react';
import { Space, Typography, Tag, Segmented, Tooltip } from 'antd';
import { BarChartOutlined, CheckOutlined, PieChartOutlined } from '@ant-design/icons';
import type { DynamicDataViewType, MetricOption } from '../types.js';
import { useDynamicDataLocale } from '../../../locale/index.js';

const { Text } = Typography;

export interface MetricSwitcherProps {
  /** 候选度量指标列表 */
  options: readonly MetricOption[];
  /** 当前选中的指标键名列表 */
  activeMetrics: readonly string[];
  /** 切换回调 */
  onChange: (metrics: string[]) => void;
  /** 选择模式：单选聚焦或多选对比 */
  mode?: ('single' | 'multiple') | undefined;
  /** 主题色 */
  colorPrimary?: string | undefined;
  /** 紧凑尺寸 */
  size?: ('small' | 'middle') | undefined;
  /** 当前视图形态 (如 pie, bar, line) */
  viewType?: DynamicDataViewType | undefined;
}

export const MetricSwitcher: React.FC<MetricSwitcherProps> = ({
  options,
  activeMetrics,
  onChange,
  mode = 'single',
  colorPrimary = '#1677ff',
  size = 'small',
  viewType,
}) => {
  const t = useDynamicDataLocale();

  if (!options || options.length === 0) {
    return null;
  }

  const isPie = viewType === 'pie';

  // 单选模式：使用 Segmented
  if (mode === 'single') {
    const segmentedOptions = options.map((opt) => ({
      label: (
        <span style={{ fontSize: 12, padding: '0 4px' }} title={opt.title}>
          {opt.title}
        </span>
      ),
      value: opt.key,
    }));

    const currentValue = activeMetrics[0] || options[0]?.key;

    return (
      <Space size={8} align="center">
        <Text type="secondary" style={{ fontSize: 12 }}>
          {isPie ? (
            <PieChartOutlined style={{ marginRight: 4, color: '#1677ff' }} />
          ) : (
            <BarChartOutlined style={{ marginRight: 4 }} />
          )}
          {t('指标')}
        </Text>
        <Segmented
          size={size}
          options={segmentedOptions}
          value={currentValue}
          onChange={(val) => {
            onChange([String(val)]);
          }}
        />
      </Space>
    );
  }

  // 多选模式：使用 Tag 标签组
  return (
    <Space size={6} align="center" wrap>
      <Text type="secondary" style={{ fontSize: 12 }}>
        <BarChartOutlined style={{ marginRight: 4 }} />
        {t('指标对比')}
      </Text>
      {options.map((opt) => {
        const isSelected = activeMetrics.includes(opt.key);
        return (
          <Tag.CheckableTag
            key={opt.key}
            checked={isSelected}
            onChange={(checked) => {
              if (checked) {
                onChange([...activeMetrics, opt.key]);
              } else {
                // 至少保留一个选中项，避免图表空选
                if (activeMetrics.length > 1) {
                  onChange(activeMetrics.filter((k) => k !== opt.key));
                }
              }
            }}
            style={{
              fontSize: 12,
              padding: '2px 8px',
              borderRadius: 4,
              cursor: 'pointer',
              border: isSelected ? `1px solid ${colorPrimary}` : '1px dashed #d9d9d9',
            }}
          >
            {opt.title}
          </Tag.CheckableTag>
        );
      })}
    </Space>
  );
};
