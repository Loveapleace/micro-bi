/**
 * 展示形态切换按钮组 (ViewTypeSwitcher)
 */
import React from 'react';
import { Radio, Tooltip } from 'antd';
import {
  TableOutlined,
  LineChartOutlined,
  BarChartOutlined,
  PieChartOutlined,
} from '@ant-design/icons';
import type { DynamicDataViewType } from '../types.js';
import { useDynamicDataLocale } from '../../../locale/index.js';

export interface ViewTypeSwitcherProps {
  value: DynamicDataViewType;
  onChange: (type: DynamicDataViewType) => void;
  size?: 'small' | 'middle' | undefined;
  availableTypes?: readonly DynamicDataViewType[] | undefined;
  disabledTypes?: readonly DynamicDataViewType[] | undefined;
  disabledTooltip?: string | undefined;
}

export const ViewTypeSwitcher: React.FC<ViewTypeSwitcherProps> = ({
  value,
  onChange,
  size = 'small',
  availableTypes = ['table', 'bar', 'line', 'pie'],
  disabledTypes = [],
  disabledTooltip,
}) => {
  const t = useDynamicDataLocale();

  const renderItem = (type: DynamicDataViewType, icon: React.ReactNode, title: string) => {
    if (!availableTypes.includes(type)) return null;
    const isDisabled = disabledTypes.includes(type);
    const tooltipText = isDisabled
      ? (disabledTooltip || t('双向交叉透视仅支持表格视图，图表适用于单向分组模式'))
      : title;

    return (
      <Tooltip key={type} title={tooltipText}>
        <Radio.Button value={type} disabled={isDisabled}>
          {icon}
        </Radio.Button>
      </Tooltip>
    );
  };

  return (
    <Radio.Group
      size={size}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      buttonStyle="solid"
    >
      {renderItem('table', <TableOutlined />, t('表格'))}
      {renderItem('bar', <BarChartOutlined />, t('柱状图'))}
      {renderItem('line', <LineChartOutlined />, t('折线图'))}
      {renderItem('pie', <PieChartOutlined />, t('饼图'))}
    </Radio.Group>
  );
};
