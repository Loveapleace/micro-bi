import React, { useState, useMemo } from 'react';
import { Card, Input, List, Tag, Select, Tooltip, Button, Space, Typography } from 'antd';
import {
  CalendarOutlined,
  CalculatorOutlined,
  FontSizeOutlined,
  SearchOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import type { FieldDataType, FieldMeta } from '../../engine/types.js';
import { useDynamicDataLocale } from '../../locale/index.js';

const { Text } = Typography;

export interface FieldProfilerListProps {
  readonly fields: readonly FieldMeta[];
  readonly onFieldTypeChange: (fieldKey: string, newType: FieldDataType) => void;
  readonly onQuickAddColumn: (fieldMeta: FieldMeta) => void;
}

export const FieldProfilerList: React.FC<FieldProfilerListProps> = ({
  fields,
  onFieldTypeChange,
  onQuickAddColumn,
}) => {
  const { t } = useDynamicDataLocale();
  const [search, setSearch] = useState('');

  const filteredFields = useMemo(() => {
    if (!search.trim()) return fields;
    const q = search.trim().toLowerCase();
    return fields.filter(
      (f) => f.key.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)
    );
  }, [fields, search]);

  const renderTypeIcon = (type: FieldDataType) => {
    switch (type) {
      case 'time':
        return <CalendarOutlined style={{ color: '#1677ff' }} />;
      case 'number':
        return <CalculatorOutlined style={{ color: '#52c41a' }} />;
      case 'text':
      default:
        return <FontSizeOutlined style={{ color: '#fa8c16' }} />;
    }
  };

  return (
    <Card
      title={
        <Space size={6}>
          <span>{t('字段探查')}</span>
          <Tag color="blue">{fields.length}</Tag>
        </Space>
      }
      size="small"
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      bodyStyle={{ flex: 1, overflowY: 'auto', padding: '8px' }}
      extra={
        <Tooltip title={t('基于样本数据自动识别时间/数值/文本类型，可手动切换修正')}>
          <Text type="secondary" style={{ fontSize: 12, cursor: 'help' }}>{t('说明')}</Text>
        </Tooltip>
      }
    >
      <Input
        placeholder={t('搜索字段...')}
        prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
        allowClear
        size="small"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 8 }}
      />

      <List
        size="small"
        dataSource={[...filteredFields]}
        renderItem={(item) => (
          <List.Item
            key={item.key}
            style={{
              padding: '6px 8px',
              borderBottom: '1px solid #f0f0f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Space size={6} style={{ flex: 1, minWidth: 0, marginRight: 4 }}>
              <Tooltip title={`探测类型: ${item.detectedType}`}>
                {renderTypeIcon(item.type)}
              </Tooltip>
              <Tooltip
                title={
                  <div>
                    <div>表头显示: <b>{item.label}</b></div>
                    <div>字段键名: <code>{item.key}</code></div>
                    {item.sampleValues && item.sampleValues.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        样本: {item.sampleValues.map((v) => String(v)).join(', ')}
                      </div>
                    )}
                  </div>
                }
              >
                <div
                  style={{
                    maxWidth: 120,
                    cursor: 'pointer',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  onClick={() => onQuickAddColumn(item)}
                >
                  <span style={{ fontWeight: 500 }}>{item.label}</span>
                  {item.label !== item.key && (
                    <span style={{ color: '#8c8c8c', fontSize: 11, marginLeft: 4 }}>
                      ({item.key})
                    </span>
                  )}
                </div>
              </Tooltip>
            </Space>

            <Space size={4}>
              <Select
                size="small"
                value={item.type}
                onChange={(val) => onFieldTypeChange(item.key, val as FieldDataType)}
                style={{ width: 72 }}
                options={[
                  { value: 'time', label: t('时间') },
                  { value: 'number', label: t('数值') },
                  { value: 'text', label: t('文本') },
                ]}
              />
              <Tooltip title={t('快捷加入分析列')}>
                <Button
                  size="small"
                  type="text"
                  icon={<PlusOutlined />}
                  onClick={() => onQuickAddColumn(item)}
                />
              </Tooltip>
            </Space>
          </List.Item>
        )}
      />
    </Card>
  );
};
