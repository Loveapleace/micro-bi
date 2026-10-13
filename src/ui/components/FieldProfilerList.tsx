import React, { useState, useMemo } from 'react';
import { Card, Input, List, Tag, Select, Tooltip, Button, Space, Typography, Segmented } from 'antd';
import {
  CalendarOutlined,
  CalculatorOutlined,
  FontSizeOutlined,
  SearchOutlined,
  PlusOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import type { FieldDataType, FieldMeta } from '../../engine/types.js';
import { useDynamicDataLocale } from '../../locale/index.js';

const { Text } = Typography;

export interface FieldProfilerListProps {
  readonly fields: readonly FieldMeta[];
  readonly onFieldTypeChange: (fieldKey: string, newType: FieldDataType) => void;
  readonly onQuickAddColumn: (fieldMeta: FieldMeta) => void;
  readonly showFieldKeys?: boolean | undefined;
}

export const FieldProfilerList: React.FC<FieldProfilerListProps> = ({
  fields,
  onFieldTypeChange,
  onQuickAddColumn,
  showFieldKeys = false,
}) => {
  const { t } = useDynamicDataLocale();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'time' | 'text' | 'number'>('all');

  // 统计各类型数量
  const counts = useMemo(() => {
    let timeCount = 0;
    let textCount = 0;
    let numCount = 0;
    for (const f of fields) {
      if (f.type === 'time') timeCount++;
      else if (f.type === 'number') numCount++;
      else textCount++;
    }
    return { all: fields.length, time: timeCount, text: textCount, number: numCount };
  }, [fields]);

  const filteredFields = useMemo(() => {
    return fields.filter((f) => {
      // 1. 类型筛选
      if (typeFilter !== 'all' && f.type !== typeFilter) return false;
      // 2. 搜索词筛选
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return f.key.toLowerCase().includes(q) || f.label.toLowerCase().includes(q);
    });
  }, [fields, typeFilter, search]);

  const renderTypePill = (type: FieldDataType) => {
    switch (type) {
      case 'time':
        return (
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 4,
              backgroundColor: '#e6f4ff',
              border: '1px solid #adc6ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <CalendarOutlined style={{ color: '#1677ff', fontSize: 11 }} />
          </div>
        );
      case 'number':
        return (
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 4,
              backgroundColor: '#f6ffed',
              border: '1px solid #b7eb8f',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <CalculatorOutlined style={{ color: '#52c41a', fontSize: 11 }} />
          </div>
        );
      case 'text':
      default:
        return (
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 4,
              backgroundColor: '#fff7e6',
              border: '1px solid #ffd591',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <FontSizeOutlined style={{ color: '#fa8c16', fontSize: 11 }} />
          </div>
        );
    }
  };

  return (
    <Card
      title={
        <Space size={6}>
          <DatabaseOutlined style={{ color: '#1677ff' }} />
          <span style={{ fontWeight: 600 }}>{t('字段探查')}</span>
          <Tag
            color="processing"
            style={{
              borderRadius: 10,
              fontSize: 11,
              padding: '0 6px',
              lineHeight: '18px',
              border: 'none',
              backgroundColor: '#e6f4ff',
              color: '#0958d9',
            }}
          >
            {fields.length}
          </Tag>
        </Space>
      }
      size="small"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 8,
        border: '1px solid #e8ecf2',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
      }}
      bodyStyle={{
        flex: 1,
        overflowY: 'auto',
        padding: '10px 8px',
        backgroundColor: '#fafbfc',
      }}
      extra={
        <Tooltip title={t('基于样本数据自动识别时间/数值/文本类型，可手动切换修正')}>
          <Text type="secondary" style={{ fontSize: 12, cursor: 'help' }}>
            {t('说明')}
          </Text>
        </Tooltip>
      }
    >
      {/* 快捷类型切换分段器 */}
      <div style={{ marginBottom: 8 }}>
        <Segmented
          size="small"
          block
          value={typeFilter}
          onChange={(val) => setTypeFilter(val as 'all' | 'time' | 'text' | 'number')}
          options={[
            { label: `${t('全部')} ${counts.all}`, value: 'all' },
            { label: `${t('时间')} ${counts.time}`, value: 'time' },
            { label: `${t('分类')} ${counts.text}`, value: 'text' },
            { label: `${t('数值')} ${counts.number}`, value: 'number' },
          ]}
        />
      </div>

      {/* 搜索框 */}
      <Input
        placeholder={t('搜索字段...')}
        prefix={<SearchOutlined style={{ color: '#bfbfbf', fontSize: 12 }} />}
        allowClear
        size="small"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          marginBottom: 8,
          borderRadius: 4,
          backgroundColor: '#ffffff',
          borderColor: '#e2e8f0',
        }}
      />

      {/* 字段列表卡片项 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filteredFields.map((item) => (
          <div
            key={item.key}
            style={{
              padding: '6px 8px',
              backgroundColor: '#ffffff',
              borderRadius: 6,
              border: '1px solid #eef2f6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
              transition: 'all 0.18s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#91caff';
              e.currentTarget.style.boxShadow = '0 2px 6px rgba(22, 119, 255, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#eef2f6';
              e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.02)';
            }}
          >
            {/* 左侧：类型图标与字段名 */}
            <Tooltip
              title={
                <div>
                  <div>{t('业务名称')}: <b>{item.label}</b></div>
                  {item.label !== item.key && (
                    <div>{t('物理键名')}: <code>{item.key}</code></div>
                  )}
                  <div style={{ color: '#8c8c8c' }}>{t('探测类型')}: {item.detectedType}</div>
                  {item.sampleValues && item.sampleValues.length > 0 && (
                    <div style={{ marginTop: 4, color: '#faad14' }}>
                      {t('样本数据')}: {item.sampleValues.map((v) => String(v)).join(', ')}
                    </div>
                  )}
                </div>
              }
              placement="right"
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flex: 1,
                  minWidth: 0,
                  cursor: 'pointer',
                  marginRight: 4,
                }}
                onClick={() => onQuickAddColumn(item)}
              >
                {renderTypePill(item.type)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#1e293b',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={item.label}
                  >
                    {item.label}
                  </div>
                  {showFieldKeys && (
                    <div
                      style={{
                        fontSize: 10,
                        color: '#8c8c8c',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.key}
                    </div>
                  )}
                </div>
              </div>
            </Tooltip>

            {/* 右侧：类型微调下拉与快速加入按钮 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Select
                size="small"
                value={item.type}
                onChange={(val) => onFieldTypeChange(item.key, val as FieldDataType)}
                style={{ width: 68 }}
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
                  icon={<PlusOutlined style={{ fontSize: 11 }} />}
                  style={{
                    width: 22,
                    height: 22,
                    padding: 0,
                    borderRadius: 4,
                    color: '#1677ff',
                  }}
                  onClick={() => onQuickAddColumn(item)}
                />
              </Tooltip>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};
