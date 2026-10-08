import React from 'react';
import { Card, Row, Col, Select, InputNumber, Space, Typography, Tag, Switch, Radio, Divider } from 'antd';
import {
  CalendarOutlined,
  AppstoreOutlined,
  TableOutlined,
  ColumnWidthOutlined,
  CalculatorOutlined,
} from '@ant-design/icons';
import type { DimensionConfig, FieldMeta, TimeGranularity } from '../../engine/types.js';
import { useDynamicDataLocale } from '../../locale/index.js';
import { PivotSkeletonWireframe } from './PivotSkeletonWireframe.js';

const { Text } = Typography;

export interface DimensionConfigProps {
  readonly dimensions?: DimensionConfig | undefined;
  readonly availableFields: readonly FieldMeta[];
  readonly disabled?: boolean | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly onChange: (newDimensions: DimensionConfig) => void;
}

export const DimensionConfigComponent: React.FC<DimensionConfigProps> = ({
  dimensions,
  availableFields,
  disabled = false,
  headers,
  onChange,
}) => {
  const { t } = useDynamicDataLocale();

  // 行维度
  const currentBucket = dimensions?.timeBucket;
  const currentCategories = dimensions?.categories ?? [];

  // 列维度
  const currentColumnBucket = dimensions?.columnTimeBucket;
  const currentColumnCategories = dimensions?.columnCategories ?? [];

  // 透视选项
  const indicatorsAsCol = dimensions?.indicatorsAsCol !== false;
  const showRowGrandTotals = dimensions?.rowTotals?.showGrandTotals !== false;
  const showColGrandTotals = dimensions?.columnTotals?.showGrandTotals !== false;

  const isCrossTab = Boolean(
    (currentColumnCategories && currentColumnCategories.length > 0) ||
    currentColumnBucket?.field
  );

  // --- 行维度处理函数 ---
  const handleTimeFieldChange = (field: string | undefined) => {
    if (!field) {
      const { timeBucket, ...rest } = dimensions || {};
      onChange(rest);
      return;
    }
    onChange({
      ...dimensions,
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

  // --- 列维度处理函数 ---
  const handleColumnTimeFieldChange = (field: string | undefined) => {
    if (!field) {
      const { columnTimeBucket, ...rest } = dimensions || {};
      onChange(rest);
      return;
    }
    onChange({
      ...dimensions,
      columnTimeBucket: {
        field,
        granularity: currentColumnBucket?.granularity || 'month',
        customIntervalDays: currentColumnBucket?.customIntervalDays || 30,
      },
    });
  };

  const handleColumnGranularityChange = (granularity: TimeGranularity) => {
    if (!currentColumnBucket) return;
    onChange({
      ...dimensions,
      columnTimeBucket: {
        ...currentColumnBucket,
        granularity,
      },
    });
  };

  const handleColumnCategoriesChange = (columnCategories: string[]) => {
    onChange({
      ...dimensions,
      columnCategories,
    });
  };

  // --- 透视高级选项处理函数 ---
  const handleIndicatorsAsColChange = (asCol: boolean) => {
    onChange({
      ...dimensions,
      indicatorsAsCol: asCol,
    });
  };

  const handleRowGrandTotalsChange = (show: boolean) => {
    onChange({
      ...dimensions,
      rowTotals: {
        ...dimensions?.rowTotals,
        showGrandTotals: show,
      },
    });
  };

  const handleColGrandTotalsChange = (show: boolean) => {
    onChange({
      ...dimensions,
      columnTotals: {
        ...dimensions?.columnTotals,
        showGrandTotals: show,
      },
    });
  };

  return (
    <Card
      size="small"
      title={
        <Space size={6}>
          <TableOutlined style={{ color: '#1677ff' }} />
          <span>{t('维度分组与交叉透视')}</span>
          {isCrossTab && (
            <Tag color="purple" style={{ fontSize: 11, margin: 0 }}>
              {t('双向多维交叉透视')}
            </Tag>
          )}
        </Space>
      }
      extra={
        <Text type="secondary" style={{ fontSize: 12 }}>
          {isCrossTab ? t('已开启双向交叉透视') : currentBucket?.field || currentCategories.length > 0 ? t('单向行分组透视') : t('明细增强模式')}
        </Text>
      }
      style={{ marginBottom: 12 }}
    >
      <Row gutter={[16, 12]} align="top">
        {/* 左侧：维度与透视配置表单 */}
        <Col xs={24} xl={16}>
          {/* 模块 1: 行维度 (纵向向下展开) */}
          <div style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tag color="blue" style={{ margin: 0, fontSize: 11, fontWeight: 600 }}>
            {t('行维度 (纵向展开)')}
          </Tag>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('数据将作为表格行沿纵向向下排布')}
          </Text>
        </div>
        <Row gutter={[16, 8]}>
          {/* 行时间汇总周期 */}
          <Col xs={24} md={12}>
            <Space direction="vertical" style={{ width: '100%' }} size={4}>
              <Space size={4}>
                <CalendarOutlined style={{ color: '#1677ff' }} />
                <Text strong style={{ fontSize: 13 }}>{t('行时间周期')}:</Text>
              </Space>
              <Space.Compact block>
                <Select
                  placeholder={t('选择时间字段 (可选)')}
                  allowClear
                  disabled={disabled}
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
                  disabled={disabled || !currentBucket?.field}
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
                      disabled={disabled}
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

          {/* 行文本分类维度 */}
          <Col xs={24} md={12}>
            <Space direction="vertical" style={{ width: '100%' }} size={4}>
              <Space size={4}>
                <AppstoreOutlined style={{ color: '#1677ff' }} />
                <Text strong style={{ fontSize: 13 }}>{t('行分类维度')}:</Text>
              </Space>
              <Select
                mode="multiple"
                allowClear
                disabled={disabled}
                placeholder={t('选择行分组分类字段 (如承制车间)')}
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
      </div>

      <Divider style={{ margin: '10px 0' }} />

      {/* 模块 2: 透视列维度 (横向向右展开) */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tag color="purple" style={{ margin: 0, fontSize: 11, fontWeight: 600 }}>
            {t('透视列维度 (横向展开)')}
          </Tag>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('配置后将自动开启双向交叉多维透视表，列头按该维度横向矩阵展开')}
          </Text>
        </div>
        <Row gutter={[16, 8]}>
          {/* 列时间汇总周期 */}
          <Col xs={24} md={12}>
            <Space direction="vertical" style={{ width: '100%' }} size={4}>
              <Space size={4}>
                <CalendarOutlined style={{ color: '#722ed1' }} />
                <Text strong style={{ fontSize: 13 }}>{t('列时间周期')}:</Text>
              </Space>
              <Space.Compact block>
                <Select
                  placeholder={t('选择透视时间字段 (如计划投产时间)')}
                  allowClear
                  disabled={disabled}
                  style={{ width: '50%' }}
                  value={currentColumnBucket?.field}
                  onChange={handleColumnTimeFieldChange}
                  options={availableFields.map((f) => ({
                    value: f.key,
                    label: (
                      <span>
                        {f.label !== f.key ? `${f.label} (${f.key})` : f.key} {f.type === 'time' && <Tag color="purple" style={{ fontSize: 10 }}>{t('时间')}</Tag>}
                      </span>
                    ),
                  }))}
                />
                <Select
                  disabled={disabled || !currentColumnBucket?.field}
                  style={{ width: '50%' }}
                  value={currentColumnBucket?.granularity || 'month'}
                  onChange={handleColumnGranularityChange}
                  options={[
                    { value: 'hour', label: t('时') },
                    { value: 'day', label: t('日') },
                    { value: 'week', label: t('周') },
                    { value: 'month', label: t('月') },
                    { value: 'quarter', label: t('季') },
                    { value: 'year', label: t('年') },
                  ]}
                />
              </Space.Compact>
            </Space>
          </Col>

          {/* 列文本分类维度 */}
          <Col xs={24} md={12}>
            <Space direction="vertical" style={{ width: '100%' }} size={4}>
              <Space size={4}>
                <AppstoreOutlined style={{ color: '#722ed1' }} />
                <Text strong style={{ fontSize: 13 }}>{t('列分类维度')}:</Text>
              </Space>
              <Select
                mode="multiple"
                allowClear
                disabled={disabled}
                placeholder={t('选择列透视分类字段 (如产品类型/状态)')}
                style={{ width: '100%' }}
                value={[...currentColumnCategories]}
                onChange={handleColumnCategoriesChange}
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
      </div>

      {/* 模块 3: 透视表高级选项 (仅在开启交叉透视时展示) */}
      {isCrossTab && (
        <>
          <Divider style={{ margin: '10px 0' }} />
          <div style={{ backgroundColor: '#fafafa', padding: '8px 12px', borderRadius: 6 }}>
            <Row gutter={[16, 8]} align="middle">
              <Col xs={24} sm={10}>
                <Space size={6} align="center">
                  <ColumnWidthOutlined style={{ color: '#1677ff' }} />
                  <Text strong style={{ fontSize: 12 }}>{t('指标排布方向')}:</Text>
                  <Radio.Group
                    size="small"
                    disabled={disabled}
                    value={indicatorsAsCol}
                    onChange={(e) => handleIndicatorsAsColChange(e.target.value)}
                  >
                    <Radio.Button value={true}>{t('横向列展开')}</Radio.Button>
                    <Radio.Button value={false}>{t('纵向行展开')}</Radio.Button>
                  </Radio.Group>
                </Space>
              </Col>
              <Col xs={12} sm={7}>
                <Space size={6} align="center">
                  <CalculatorOutlined style={{ color: '#52c41a' }} />
                  <Text style={{ fontSize: 12 }}>{t('行总计')}:</Text>
                  <Switch
                    size="small"
                    disabled={disabled}
                    checked={showRowGrandTotals}
                    onChange={handleRowGrandTotalsChange}
                  />
                </Space>
              </Col>
              <Col xs={12} sm={7}>
                <Space size={6} align="center">
                  <CalculatorOutlined style={{ color: '#52c41a' }} />
                  <Text style={{ fontSize: 12 }}>{t('列总计')}:</Text>
                  <Switch
                    size="small"
                    disabled={disabled}
                    checked={showColGrandTotals}
                    onChange={handleColGrandTotalsChange}
                  />
                </Space>
              </Col>
            </Row>
          </div>
        </>
      )}
        </Col>

        {/* 右侧：透视骨架示意线框图 */}
        <Col xs={24} xl={8} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <PivotSkeletonWireframe
            dimensions={dimensions}
            headers={headers}
          />
        </Col>
      </Row>
    </Card>
  );
};
