import React from 'react';
import { Card, Row, Col, Select, InputNumber, Space, Typography, Tag, Radio } from 'antd';
import {
  CalendarOutlined,
  AppstoreOutlined,
  TableOutlined,
  ColumnWidthOutlined,
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

  const isCrossTab = Boolean(
    (currentColumnCategories && currentColumnCategories.length > 0) ||
    currentColumnBucket?.field
  );

  // 仅筛选物理类型或探测类型为时间型的字段 (f.type === 'time')
  const timeFields = React.useMemo(() => {
    return availableFields.filter((f) => f.type === 'time');
  }, [availableFields]);

  // 行时间周期下拉选项：仅时间字段；若已配置字段因边界情况不在列表中则兜底追加
  const rowTimeOptions = React.useMemo(() => {
    const list = [...timeFields];
    if (currentBucket?.field && !list.some((f) => f.key === currentBucket.field)) {
      const match = availableFields.find((f) => f.key === currentBucket.field);
      list.push(
        match ?? {
          key: currentBucket.field,
          label: headers?.[currentBucket.field] || currentBucket.field,
          type: 'time',
          detectedType: 'time',
        }
      );
    }
    return list.map((f) => ({
      value: f.key,
      label: (
        <span>
          {f.label !== f.key ? `${f.label} (${f.key})` : f.key}{' '}
          <Tag color="blue" style={{ fontSize: 10 }}>{t('时间')}</Tag>
        </span>
      ),
    }));
  }, [timeFields, currentBucket?.field, availableFields, headers, t]);

  // 列时间周期下拉选项：仅时间字段；若已配置字段因边界情况不在列表中则兜底追加
  const colTimeOptions = React.useMemo(() => {
    const list = [...timeFields];
    if (currentColumnBucket?.field && !list.some((f) => f.key === currentColumnBucket.field)) {
      const match = availableFields.find((f) => f.key === currentColumnBucket.field);
      list.push(
        match ?? {
          key: currentColumnBucket.field,
          label: headers?.[currentColumnBucket.field] || currentColumnBucket.field,
          type: 'time',
          detectedType: 'time',
        }
      );
    }
    return list.map((f) => ({
      value: f.key,
      label: (
        <span>
          {f.label !== f.key ? `${f.label} (${f.key})` : f.key}{' '}
          <Tag color="purple" style={{ fontSize: 10 }}>{t('时间')}</Tag>
        </span>
      ),
    }));
  }, [timeFields, currentColumnBucket?.field, availableFields, headers, t]);

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
  // 交叉透视模式下默认开启行总计与列总计
  const ensureDefaultTotals = (dims: DimensionConfig): DimensionConfig => ({
    ...dims,
    rowTotals: {
      showGrandTotals: true,
      grandTotalLabel: dims.rowTotals?.grandTotalLabel || t('行总计'),
      ...(dims.rowTotals || {}),
    },
    columnTotals: {
      showGrandTotals: true,
      grandTotalLabel: dims.columnTotals?.grandTotalLabel || t('列总计'),
      ...(dims.columnTotals || {}),
    },
  });

  // --- 列维度处理函数 ---
  const handleColumnTimeFieldChange = (field: string | undefined) => {
    if (!field) {
      const { columnTimeBucket, ...rest } = dimensions || {};
      onChange(rest);
      return;
    }
    onChange(
      ensureDefaultTotals({
        ...dimensions,
        columnTimeBucket: {
          field,
          granularity: currentColumnBucket?.granularity || 'month',
          customIntervalDays: currentColumnBucket?.customIntervalDays || 30,
        },
      })
    );
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
    if (columnCategories.length === 0) {
      const { columnCategories: _, ...rest } = dimensions || {};
      onChange(rest);
      return;
    }
    onChange(
      ensureDefaultTotals({
        ...dimensions,
        columnCategories,
      })
    );
  };

  // --- 透视高级选项处理函数 ---
  const handleIndicatorsAsColChange = (asCol: boolean) => {
    onChange(
      ensureDefaultTotals({
        ...dimensions,
        indicatorsAsCol: asCol,
      })
    );
  };


  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <TableOutlined style={{ color: '#1677ff', fontSize: 15 }} />
          <span style={{ fontWeight: 600 }}>{t('维度分组与交叉透视')}</span>
          {isCrossTab && (
            <Tag color="purple" style={{ fontSize: 11, margin: 0, borderRadius: 10, padding: '0 8px' }}>
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
      style={{ marginBottom: 10, borderRadius: 8, boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)' }}
    >
      <Row gutter={[16, 12]} align="top">
        {/* 左侧：维度与透视配置表单 */}
        <Col xs={24} xl={15}>
          {/* 模块 1: 行维度 (纵向向下展开) */}
          <div
            style={{
              backgroundColor: '#f8faff',
              border: '1px solid #d6e4ff',
              borderRadius: 8,
              padding: '10px 12px',
              marginBottom: 10,
            }}
          >
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Space size={6}>
                <Tag
                  style={{
                    margin: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: '#e6f4ff',
                    color: '#0958d9',
                    border: '1px solid #91caff',
                    borderRadius: 4,
                    padding: '1px 8px',
                  }}
                >
                  {t('行维度 (纵向展开)')}
                </Tag>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {t('数据将作为表格行沿纵向向下排布')}
                </Text>
              </Space>
            </div>
            <Row gutter={[12, 8]}>
              {/* 行时间汇总周期 */}
              <Col xs={24} md={12}>
                <Space direction="vertical" style={{ width: '100%' }} size={4}>
                  <Space size={4}>
                    <CalendarOutlined style={{ color: '#1677ff' }} />
                    <Text strong style={{ fontSize: 13 }}>{t('行时间周期')}:</Text>
                  </Space>
                  <Space.Compact block>
                    <Select
                      placeholder={timeFields.length > 0 ? t('选择时间字段 (可选)') : t('暂无时间类型字段')}
                      notFoundContent={t('暂无时间类型字段')}
                      allowClear
                      disabled={disabled || (timeFields.length === 0 && !currentBucket?.field)}
                      style={{ width: '50%' }}
                      value={currentBucket?.field}
                      onChange={handleTimeFieldChange}
                      options={rowTimeOptions}
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
                  <Space size={6} wrap>
                    <AppstoreOutlined style={{ color: '#1677ff' }} />
                    <Text strong style={{ fontSize: 13 }}>{t('行分类维度')}:</Text>
                  </Space>
                  <Select
                    mode="multiple"
                    allowClear
                    maxTagCount="responsive"
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
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {t('(支持多选，按所选顺序逐层向下嵌套分组)')}
                  </Text>
                </Space>
              </Col>
            </Row>
          </div>

          {/* 模块 2: 透视列维度 (横向向右展开) */}
          <div
            style={{
              backgroundColor: '#faf8fe',
              border: '1px solid #efdbff',
              borderRadius: 8,
              padding: '10px 12px',
              marginBottom: 0,
            }}
          >
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Space size={6}>
                <Tag
                  style={{
                    margin: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: '#f9f0ff',
                    color: '#531dab',
                    border: '1px solid #d3adf7',
                    borderRadius: 4,
                    padding: '1px 8px',
                  }}
                >
                  {t('透视列维度 (横向展开)')}
                </Tag>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {t('配置后将自动开启双向交叉多维透视表，列头按该维度横向矩阵展开')}
                </Text>
              </Space>
            </div>
            <Row gutter={[12, 8]}>
              {/* 列时间汇总周期 */}
              <Col xs={24} md={12}>
                <Space direction="vertical" style={{ width: '100%' }} size={4}>
                  <Space size={4}>
                    <CalendarOutlined style={{ color: '#722ed1' }} />
                    <Text strong style={{ fontSize: 13 }}>{t('列时间周期')}:</Text>
                  </Space>
                  <Space.Compact block>
                    <Select
                      placeholder={timeFields.length > 0 ? t('选择透视时间字段 (如计划投产时间)') : t('暂无时间类型字段')}
                      notFoundContent={t('暂无时间类型字段')}
                      allowClear
                      disabled={disabled || (timeFields.length === 0 && !currentColumnBucket?.field)}
                      style={{ width: '50%' }}
                      value={currentColumnBucket?.field}
                      onChange={handleColumnTimeFieldChange}
                      options={colTimeOptions}
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
                  <Space size={6} wrap>
                    <AppstoreOutlined style={{ color: '#722ed1' }} />
                    <Text strong style={{ fontSize: 13 }}>{t('列分类维度')}:</Text>
                  </Space>
                  <Select
                    mode="multiple"
                    allowClear
                    maxTagCount="responsive"
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
                  {(currentColumnBucket?.field ? 1 : 0) + currentColumnCategories.length > 2 ? (
                    <Text type="warning" style={{ fontSize: 11 }}>
                      {t('⚠️ 已配置多个列透视维度，横向交叉展开列数较多，建议精简以提升阅读体验')}
                    </Text>
                  ) : (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {t('(支持多选；建议1~2个以防横向列数过度膨胀)')}
                    </Text>
                  )}
                </Space>
              </Col>
            </Row>

            {/* 指标排布方向 (双向交叉透视时展示) */}
            {isCrossTab && (
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 8,
                  borderTop: '1px dashed #d3adf7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <Space size={8} align="center">
                  <ColumnWidthOutlined style={{ color: '#722ed1', fontSize: 13 }} />
                  <Text strong style={{ fontSize: 12, color: '#531dab' }}>
                    {t('指标排布方向')}:
                  </Text>
                  <Radio.Group
                    size="small"
                    disabled={disabled}
                    value={indicatorsAsCol}
                    onChange={(e) => handleIndicatorsAsColChange(e.target.value)}
                    buttonStyle="solid"
                  >
                    <Radio.Button value={true}>{t('横向列展开')}</Radio.Button>
                    <Radio.Button value={false}>{t('纵向行展开')}</Radio.Button>
                  </Radio.Group>
                </Space>
                <Space size={6}>
                  <Tag
                    style={{
                      margin: 0,
                      fontSize: 11,
                      borderRadius: 10,
                      padding: '0 8px',
                      backgroundColor: '#f9f0ff',
                      borderColor: '#d3adf7',
                      color: '#722ed1',
                    }}
                  >
                    {t('行列总计默认开启')}
                  </Tag>
                </Space>
              </div>
            )}
          </div>

        </Col>

        {/* 右侧：透视骨架示意线框图 */}
        <Col xs={24} xl={9} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <PivotSkeletonWireframe
            dimensions={dimensions}
            headers={headers}
            style={{ width: '100%', maxWidth: '100%' }}
          />
        </Col>
      </Row>
    </Card>
  );
};
