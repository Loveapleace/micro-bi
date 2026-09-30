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
  size?: 'small' | 'middle';
  availableTypes?: readonly DynamicDataViewType[];
}

export const ViewTypeSwitcher: React.FC<ViewTypeSwitcherProps> = ({
  value,
  onChange,
  size = 'small',
  availableTypes = ['table', 'bar', 'line', 'pie'],
}) => {
  const t = useDynamicDataLocale();

  return (
    <Radio.Group
      size={size}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      buttonStyle="solid"
    >
      {availableTypes.includes('table') && (
        <Tooltip title={t('表格')}>
          <Radio.Button value="table">
            <TableOutlined />
          </Radio.Button>
        </Tooltip>
      )}
      {availableTypes.includes('bar') && (
        <Tooltip title={t('柱状图')}>
          <Radio.Button value="bar">
            <BarChartOutlined />
          </Radio.Button>
        </Tooltip>
      )}
      {availableTypes.includes('line') && (
        <Tooltip title={t('折线图')}>
          <Radio.Button value="line">
            <LineChartOutlined />
          </Radio.Button>
        </Tooltip>
      )}
      {availableTypes.includes('pie') && (
        <Tooltip title={t('饼图')}>
          <Radio.Button value="pie">
            <PieChartOutlined />
          </Radio.Button>
        </Tooltip>
      )}
    </Radio.Group>
  );
};
