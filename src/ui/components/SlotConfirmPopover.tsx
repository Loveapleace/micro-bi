import React, { useState, useEffect } from 'react';
import { Popover, Button, Space, Typography, Tag, Select, Radio, Alert } from 'antd';
import { CheckCircleOutlined, ThunderboltOutlined, SettingOutlined } from '@ant-design/icons';
import type { FieldMeta, DynamicTransformConfig, TimeGranularity } from '../../engine/types.js';
import {
  inferSlotsForTemplate,
  buildTransformConfigFromSlots,
  type SemanticTemplateMeta,
} from '../../engine/slotMatcher.js';
import { useDynamicDataLocale } from '../../locale/index.js';

const { Text } = Typography;

export interface SlotConfirmPopoverProps {
  readonly template: SemanticTemplateMeta;
  readonly fields: readonly FieldMeta[];
  readonly onApplyConfig: (config: DynamicTransformConfig) => void;
  readonly children: React.ReactNode;
}

/**
 * 语义槽位智能确认气泡 (SlotConfirmPopover)
 *
 * 结合启发式置信度推荐，在用户点击一键模板时展示轻量下拉气泡：
 * - 自动预选最高置信度字段，90% 场景下直接点击【立即套用】(0秒操作成本)
 * - 10% 复杂场景（如多个时间或多个分类）下，用户可在下拉框中自由微调纠偏
 */
export const SlotConfirmPopover: React.FC<SlotConfirmPopoverProps> = ({
  template,
  fields,
  onApplyConfig,
  children,
}) => {
  const { t } = useDynamicDataLocale();
  const [open, setOpen] = useState(false);

  // 槽位状态
  const [rowEntityKey, setRowEntityKey] = useState<string | undefined>();
  const [colTimeKey, setColTimeKey] = useState<string | undefined>();
  const [colTimeGranularity, setColTimeGranularity] = useState<TimeGranularity>('month');
  const [metricKeys, setMetricKeys] = useState<string[]>([]);
  const [indicatorsAsCol, setIndicatorsAsCol] = useState<boolean>(template.indicatorsAsCol);
  const [confidence, setConfidence] = useState<number>(85);

  // 当气泡打开时，执行槽位智能推断
  useEffect(() => {
    if (open && fields.length > 0) {
      const inferred = inferSlotsForTemplate(template.id, fields);
      setRowEntityKey(inferred.rowEntitySlot.matchedField);
      setColTimeKey(inferred.colTimeSlot.matchedField);
      setColTimeGranularity('month');
      setIndicatorsAsCol(template.indicatorsAsCol);

      const matchedMetrics = inferred.metricsSlots
        .map((s) => s.matchedField)
        .filter((k): k is string => Boolean(k));
      setMetricKeys(matchedMetrics);

      const avgConfidence = Math.round(
        (inferred.rowEntitySlot.confidence + inferred.colTimeSlot.confidence) / 2
      );
      setConfidence(avgConfidence);
    }
  }, [open, template, fields]);

  // 确认套用处理
  const handleConfirm = () => {
    const config = buildTransformConfigFromSlots(
      template.id,
      {
        rowEntityKey,
        colTimeKey,
        colTimeGranularity,
        metricKeys,
        indicatorsAsCol,
      },
      fields
    );
    onApplyConfig(config);
    setOpen(false);
  };

  const textFields = fields.filter((f) => f.type === 'text');
  const timeFields = fields.filter((f) => f.type === 'time');
  const numberFields = fields.filter((f) => f.type === 'number');

  const content = (
    <div style={{ width: 340, padding: '4px 2px' }}>
      {/* 头部标题与置信度 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Space size={4}>
          <Text strong style={{ fontSize: 13 }}>
            {template.name}
          </Text>
          <Tag color="purple" style={{ margin: 0, fontSize: 10 }}>
            {template.badge || t('交叉透视')}
          </Tag>
        </Space>
        <Tag color={confidence >= 75 ? 'success' : 'warning'} icon={<ThunderboltOutlined />} style={{ margin: 0, fontSize: 10 }}>
          {t('置信度 {score}%', { score: confidence })}
        </Tag>
      </div>

      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 10, lineHeight: 1.4 }}>
        {template.description}
      </Text>

      {/* 槽位选择表单 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* 槽位 1: 分析主体 (行维度) */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <Text style={{ fontSize: 12, fontWeight: 500 }}>
              🟣 {t('分析主体 (行维度)')}:
            </Text>
            <Text type="secondary" style={{ fontSize: 10 }}>
              {t('建议分类字段')}
            </Text>
          </div>
          <Select
            size="small"
            style={{ width: '100%' }}
            value={rowEntityKey}
            onChange={setRowEntityKey}
            placeholder={t('选择主体分类 (如车间)')}
            options={textFields.map((f) => ({
              value: f.key,
              label: f.label !== f.key ? `${f.label} (${f.key})` : f.key,
            }))}
          />
        </div>

        {/* 槽位 2: 时间周期 (列维度) */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <Text style={{ fontSize: 12, fontWeight: 500 }}>
              🔵 {t('时间周期 (列维度)')}:
            </Text>
            <Text type="secondary" style={{ fontSize: 10 }}>
              {t('横向矩阵展开')}
            </Text>
          </div>
          <Space.Compact block size="small">
            <Select
              style={{ width: '68%' }}
              value={colTimeKey}
              onChange={setColTimeKey}
              placeholder={t('选择时间字段')}
              options={timeFields.map((f) => ({
                value: f.key,
                label: f.label !== f.key ? `${f.label} (${f.key})` : f.key,
              }))}
            />
            <Select
              style={{ width: '32%' }}
              value={colTimeGranularity}
              onChange={setColTimeGranularity}
              options={[
                { value: 'month', label: t('按月') },
                { value: 'quarter', label: t('按季') },
                { value: 'day', label: t('按日') },
              ]}
            />
          </Space.Compact>
        </div>

        {/* 槽位 3: 核心指标 */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <Text style={{ fontSize: 12, fontWeight: 500 }}>
              🟢 {t('分析指标 (多选)')}:
            </Text>
            <Text type="secondary" style={{ fontSize: 10 }}>
              {t('已选 {count} 项', { count: metricKeys.length })}
            </Text>
          </div>
          <Select
            mode="multiple"
            size="small"
            style={{ width: '100%' }}
            value={metricKeys}
            onChange={setMetricKeys}
            placeholder={t('选择度量指标')}
            maxTagCount="responsive"
            options={numberFields.map((f) => ({
              value: f.key,
              label: f.label !== f.key ? `${f.label} (${f.key})` : f.key,
            }))}
          />
        </div>

        {/* 指标排布方向 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 11, color: '#595959' }}>
            {t('指标排布方向')}:
          </Text>
          <Radio.Group
            size="small"
            value={indicatorsAsCol ? 'col' : 'row'}
            onChange={(e) => setIndicatorsAsCol(e.target.value === 'col')}
          >
            <Radio.Button value="col" style={{ fontSize: 11 }}>{t('横向列展开')}</Radio.Button>
            <Radio.Button value="row" style={{ fontSize: 11 }}>{t('纵向行展开')}</Radio.Button>
          </Radio.Group>
        </div>
      </div>

      {/* 底部按钮栏 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          marginTop: 12,
          paddingTop: 8,
          borderTop: '1px solid #f0f0f0',
        }}
      >
        <Button size="small" onClick={() => setOpen(false)}>
          {t('取消')}
        </Button>
        <Button
          type="primary"
          size="small"
          icon={<CheckCircleOutlined />}
          onClick={handleConfirm}
        >
          {t('确认应用')}
        </Button>
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomLeft"
    >
      {children}
    </Popover>
  );
};
