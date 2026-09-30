/**
 * 展示层运行时 X 轴 / 分类轴维度切换器 (DimensionSwitcher)
 * - 针对双时间维度、多离散分类轴或时间+分类混合场景
 * - 允许在展示态无需重新发起计算，零拷贝瞬切 X 轴透视视角
 */
import React from 'react';
import { Space, Typography, Select } from 'antd';
import { CalendarOutlined, AppstoreOutlined, CompassOutlined, PieChartOutlined } from '@ant-design/icons';
import type { DynamicDataViewType, DimensionOption } from '../types.js';
import { useDynamicDataLocale } from '../../../locale/index.js';

const { Text } = Typography;

export interface DimensionSwitcherProps {
  /** 候选维度列表 */
  options: readonly DimensionOption[];
  /** 当前选中的维度字段键名 */
  activeDimension: string;
  /** 切换回调 */
  onChange: (dimension: string) => void;
  /** 尺寸，默认 small */
  size?: 'small' | 'middle' | undefined;
  /** 当前图表视图形态 (如 pie 对应 '分类维度:'，bar/line 对应 'X轴:') */
  viewType?: DynamicDataViewType | undefined;
  /** 自定义标签文案 (最高优先级覆盖默认标签) */
  label?: React.ReactNode | undefined;
}

export const DimensionSwitcher: React.FC<DimensionSwitcherProps> = ({
  options,
  activeDimension,
  onChange,
  size = 'small',
  viewType,
  label,
}) => {
  const t = useDynamicDataLocale();

  if (!options || options.length <= 1) {
    return null;
  }

  const selectOptions = options.map((opt) => {
    const isTime = opt.type === 'time';
    const cleanTitle = opt.title.replace(/\s*\((?:时间|分类|Time|Category)\)$/i, '');
    return {
      value: opt.key,
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, gap: 4 }}>
          {isTime ? (
            <CalendarOutlined style={{ color: '#1677ff' }} />
          ) : (
            <AppstoreOutlined style={{ color: '#52c41a' }} />
          )}
          <span>{cleanTitle}</span>
          <span style={{ fontSize: 10, color: '#8c8c8c', marginLeft: 2 }}>
            ({isTime ? t('时间') : t('分类')})
          </span>
        </span>
      ),
    };
  });

  const isPie = viewType === 'pie';
  const labelContent = label !== undefined ? label : (
    isPie ? (
      <>
        <PieChartOutlined style={{ marginRight: 4, color: '#1677ff' }} />
        {t('扇区维度')}
      </>
    ) : (
      <>
        <CompassOutlined style={{ marginRight: 4 }} />
        {t('X 轴维度')}
      </>
    )
  );

  return (
    <Space size={6} align="center">
      <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
        {labelContent}
      </Text>
      <Select
        size={size}
        value={activeDimension}
        onChange={(val) => onChange(String(val))}
        options={selectOptions}
        style={{ minWidth: 130 }}
        popupMatchSelectWidth={false}
      />
    </Space>
  );
};
