import React from 'react';
import { Card, Row, Col, Select, InputNumber, Space, Typography, Tag, Empty } from 'antd';
import { CalendarOutlined, AppstoreOutlined } from '@ant-design/icons';
import type { DimensionConfig, FieldMeta, TimeGranularity } from '../../engine/types.js';
import { useDynamicDataLocale } from '../../locale/index.js';

const { Text } = Typography;

export interface DimensionConfigProps {
  readonly dimensions?: DimensionConfig | undefined;
  readonly availableFields: readonly FieldMeta[];
  readonly disabled?: boolean | undefined;
  readonly onChange: (newDimensions: DimensionConfig) => void;
}

export const DimensionConfigComponent: React.FC<DimensionConfigProps> = ({
  dimensions,
  availableFields,
  disabled = false,
  onChange,
}) => {
  const { t } = useDynamicDataLocale();
  const currentBucket = dimensions?.timeBucket;
  const currentCategories = dimensions?.categories ?? [];

  const handleTimeFieldChange = (field: string | undefined) => {
    if (!field) {
      const nextDim: DimensionConfig = {
        ...(dimensions?.categories ? { categories: dimensions.categories } : {}),
      };
      onChange(nextDim);
      return;
    }
    onChange({
      ...(dimensions?.categories ? { categories: dimensions.categories } : {}),
      timeBucket: {
        field,
        granularity: currentBucket?.granularity || 'day',
        customIntervalDays: currentBucket?.customIntervalDays || 7,
      },
    });
  };

  const handleGranularityChange = (granularity: TimeGranularity) => {
    if (!currentBucket) return;
    onChange({
      ...dimensions,
      timeBucket: {
        ...currentBucket,
        granularity,
      },
    });
  };

  const handleCustomDaysChange = (days: number | null) => {
    if (!currentBucket) return;
    onChange({
      ...dimensions,
      timeBucket: {
        ...currentBucket,
        customIntervalDays: days || 1,
      },
    });
  };

  const handleCategoriesChange = (categories: string[]) => {
    onChange({
      ...dimensions,
      categories,
    });
  };

  return (
    <Card
      size="small"
      title={
        <Space size={6}>
          <AppstoreOutlined style={{ color: '#1677ff' }} />
          <span>{t('统计分组')}</span>
        </Space>
      }
      extra={
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('明细模式')} / {t('已开启维度透视')}
        </Text>
      }
      style={{ marginBottom: 12 }}
    >
      <Row gutter={[16, 8]}>
        {/* 时间汇总周期 */}
        <Col xs={24} md={12}>
          <Space direction="vertical" style={{ width: '100%' }} size={4}>
            <Space size={4}>
              <CalendarOutlined style={{ color: '#1677ff' }} />
              <Text strong style={{ fontSize: 13 }}>{t('时间汇总周期')}:</Text>
            </Space>
            <Space.Compact block>
              <Select
                placeholder={t('选择时间字段 (可选)')}
                allowClear
                style={{ width: '50%' }}
                value={currentBucket?.field}
                onChange={handleTimeFieldChange}
                options={availableFields.map((f) => ({
                  value: f.key,
                  label: (
                    <span>
                      {f.label !== f.key ? `${f.label} (${f.key})` : f.key} {f.type === 'time' && <Tag color="blue" style={{ fontSize: 10 }}>{t('时间')}</Tag>}
                    </span>
                  ),
                }))}
              />
              <Select
                disabled={!currentBucket?.field}
                style={{ width: '50%' }}
                value={currentBucket?.granularity || 'day'}
                onChange={handleGranularityChange}
                options={[
                  { value: 'hour', label: t('时') },
                  { value: 'day', label: t('日') },
                  { value: 'week', label: t('周') },
                  { value: 'month', label: t('月') },
                  { value: 'quarter', label: t('季') },
                  { value: 'year', label: t('年') },
                  { value: 'custom', label: t('自定义天数') },
                ]}
              />
            </Space.Compact>

            {currentBucket?.granularity === 'custom' && (
              <div style={{ marginTop: 4 }}>
                <Space size={6}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{t('自定义天数')}:</Text>
                  <InputNumber
                    size="small"
                    min={1}
                    max={365}
                    value={currentBucket?.customIntervalDays || 7}
                    onChange={handleCustomDaysChange}
                    addonAfter={t('天')}
                  />
                </Space>
              </div>
            )}
          </Space>
        </Col>

        {/* 文本分类维度 */}
        <Col xs={24} md={12}>
          <Space direction="vertical" style={{ width: '100%' }} size={4}>
            <Space size={4}>
              <AppstoreOutlined style={{ color: '#52c41a' }} />
              <Text strong style={{ fontSize: 13 }}>{t('分类维度')}:</Text>
            </Space>
            <Select
              mode="multiple"
              allowClear
              placeholder={t('选择分类维度字段 (多选)')}
              style={{ width: '100%' }}
              value={[...currentCategories]}
              onChange={handleCategoriesChange}
              options={availableFields.map((f) => ({
                value: f.key,
                label: (
                  <span>
                    {f.label !== f.key ? `${f.label} (${f.key})` : f.key} {f.type === 'text' && <Tag color="orange" style={{ fontSize: 10 }}>{t('文本')}</Tag>}
                  </span>
                ),
              }))}
            />
          </Space>
        </Col>
      </Row>
    </Card>
  );
};
