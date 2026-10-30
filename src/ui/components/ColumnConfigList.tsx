import React, { useState } from 'react';
import {
  Card,
  Button,
  Space,
  Tag,
  Select,
  Input,
  Tooltip,
  Dropdown,
  Typography,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  AppstoreAddOutlined,
  CalculatorOutlined,
  HolderOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import type {
  ColumnConfig,
  FieldMeta,
  AggregationFunction,
  ComputedColumnConfig,
  FixedColumnConfig,
  AggregatedColumnConfig,
} from '../../engine/types.js';
import { metricTemplateRegistry } from '../../engine/template.js';
import { cleanAggregatedLabel, formatAggregatedLabel } from '../../engine/modeAdapter.js';
import { useDynamicDataLocale } from '../../locale/index.js';
import { ReportModal } from './common/ReportModal.js';

const { Text } = Typography;

export interface ColumnConfigListProps {
  readonly columns: readonly ColumnConfig[];
  readonly availableFields: readonly FieldMeta[];
  readonly onChange: (newCols: ColumnConfig[]) => void;
  readonly onOpenFormulaModal: (col?: ComputedColumnConfig | undefined) => void;
  readonly hasDimensions?: boolean | undefined;
  readonly showFieldKeys?: boolean | undefined;
}

export const ColumnConfigList: React.FC<ColumnConfigListProps> = ({
  columns,
  availableFields,
  onChange,
  onOpenFormulaModal,
  hasDimensions = false,
  showFieldKeys = false,
}) => {
  const { t } = useDynamicDataLocale();

  // 行业模板应用弹窗状态
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});

  // 拖拽排序状态
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleRowDrop = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
    const next = [...columns];
    const [movedItem] = next.splice(fromIdx, 1);
    if (movedItem) {
      next.splice(toIdx, 0, movedItem);
      onChange(next);
    }
  };

  const handleAddFixed = (fieldKey: string) => {
    const f = availableFields.find((item) => item.key === fieldKey);
    const newCol: FixedColumnConfig = {
      type: 'fixed',
      field: fieldKey,
      label: f?.label || fieldKey,
    };
    onChange([...columns, newCol]);
  };

  const handleAddAggregated = (fieldKey: string, agg: AggregationFunction = 'sum') => {
    const f = availableFields.find((item) => item.key === fieldKey);
    const rawLabel = f?.label || fieldKey;
    const newCol: AggregatedColumnConfig = {
      type: 'aggregated',
      field: fieldKey,
      agg,
      label: formatAggregatedLabel(rawLabel, agg),
    };
    onChange([...columns, newCol]);
  };

  const handleDelete = (index: number) => {
    const next = [...columns];
    next.splice(index, 1);
    onChange(next);
  };

  const handleDuplicate = (index: number) => {
    const cur = columns[index];
    if (!cur) return;
    const next = [...columns];
    if (cur.type === 'computed') {
      const copyKey = `${cur.name}_copy`;
      const copyCol: ComputedColumnConfig = {
        ...cur,
        name: copyKey,
        label: `${cur.label || cur.name} (副本)`,
      };
      next.splice(index + 1, 0, copyCol);
    } else {
      const copyCol: ColumnConfig = {
        ...cur,
        label: cur.label ? `${cur.label} (副本)` : undefined,
      };
      next.splice(index + 1, 0, copyCol);
    }
    onChange(next);
  };

  const handleUpdateLabel = (index: number, newLabel: string) => {
    const next = [...columns];
    const cur = next[index];
    if (!cur) return;
    next[index] = {
      ...cur,
      label: newLabel,
    };
    onChange(next);
  };

  const handleUpdateAgg = (index: number, agg: AggregationFunction) => {
    const next = [...columns];
    const cur = next[index];
    if (!cur || cur.type !== 'aggregated') return;

    let updatedLabel = cur.label;
    if (cur.label) {
      const prefixes = [
        t('求和'),
        t('平均值'),
        t('最小值'),
        t('最大值'),
        t('计数'),
        'SUM',
        'AVG',
        'MIN',
        'MAX',
        'COUNT',
      ];
      const isPrefixed = prefixes.some((p) => cur.label!.startsWith(`${p}(`));
      if (isPrefixed) {
        const cleaned = cleanAggregatedLabel(cur.label, cur.field);
        updatedLabel = formatAggregatedLabel(cleaned, agg);
      }
    }

    next[index] = {
      ...cur,
      agg,
      label: updatedLabel,
    };
    onChange(next);
  };

  // 应用行业模板
  const handleApplyTemplate = () => {
    if (!selectedTemplateId) return;
    const tmpl = metricTemplateRegistry.get(selectedTemplateId);
    if (!tmpl) return;

    const instantiated = tmpl.createColumns(fieldMapping);
    onChange([...columns, ...instantiated]);
    setTemplateModalOpen(false);
  };

  const activeTemplate = metricTemplateRegistry.get(selectedTemplateId);

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <CalculatorOutlined style={{ color: '#1677ff', fontSize: 15 }} />
          <span style={{ fontWeight: 600 }}>{t('输出分析列配置')}</span>
          <Tag color="blue" style={{ borderRadius: 10, fontSize: 11, margin: 0, padding: '0 8px' }}>
            {columns.length} 列
          </Tag>
        </Space>
      }
      extra={
        <Space size={8} wrap>
          {!hasDimensions ? (
            <Dropdown
              menu={{
                items: availableFields.map((f) => {
                  const isDuplicate = availableFields.filter((other) => other.label === f.label).length > 1;
                  const itemLabel = showFieldKeys || isDuplicate ? `${f.label} (${f.key})` : f.label;
                  return {
                    key: f.key,
                    label: itemLabel,
                    onClick: () => handleAddFixed(f.key),
                  };
                }),
              }}
            >
              <Button size="small" icon={<PlusOutlined />}>
                {t('添加固定列')}
              </Button>
            </Dropdown>
          ) : (
            <Tooltip title={t('已开启维度透视，输出列仅支持聚合指标与计算列；如需按文本维度分组，请在上方“维度分组与交叉透视”中添加')}>
              <Button size="small" icon={<PlusOutlined />} disabled style={{ opacity: 0.6 }}>
                {t('添加固定列')}
              </Button>
            </Tooltip>
          )}

          {hasDimensions ? (
            <Dropdown
              menu={{
                items: availableFields.map((f) => {
                  const isNumber = f.type === 'number';
                  const isRatio =
                    f.key.includes('ratio') ||
                    f.key.includes('rate') ||
                    f.label.includes('%') ||
                    f.label.includes('率');
                  const agg: AggregationFunction = isNumber ? (isRatio ? 'avg' : 'sum') : 'count';
                  const isDuplicate = availableFields.filter((other) => other.label === f.label).length > 1;
                  const itemLabel = showFieldKeys || isDuplicate ? `${f.label} (${f.key})` : f.label;
                  return {
                    key: f.key,
                    label: itemLabel,
                    onClick: () => handleAddAggregated(f.key, agg),
                  };
                }),
              }}
            >
              <Button
                size="small"
                icon={<PlusOutlined />}
                style={{ borderColor: '#87e8de', color: '#08979c', backgroundColor: '#f6ffed' }}
              >
                {t('添加聚合指标')}
              </Button>
            </Dropdown>
          ) : (
            <Tooltip title={t('明细表模式直接展示各行原始记录，如需聚合统计，请在上方“维度分组与交叉透视”中添加维度')}>
              <Button
                size="small"
                icon={<PlusOutlined />}
                disabled
                style={{ opacity: 0.6 }}
              >
                {t('添加聚合指标')}
              </Button>
            </Tooltip>
          )}

          <Button
            size="small"
            icon={<PlusOutlined />}
            style={{ borderColor: '#d3adf7', color: '#722ed1', backgroundColor: '#f9f0ff' }}
            onClick={() => onOpenFormulaModal()}
          >
            {t('添加动态计算列')}
          </Button>

          <Button
            size="small"
            icon={<AppstoreAddOutlined />}
            onClick={() => {
              const list = metricTemplateRegistry.list();
              if (list.length > 0 && list[0]) {
                setSelectedTemplateId(list[0].id);
              }
              setTemplateModalOpen(true);
            }}
          >
            {t('套用行业指标模板')}
          </Button>
        </Space>
      }
      style={{ marginBottom: 10, borderRadius: 8, boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)' }}
      bodyStyle={{ padding: 0 }}
    >
      <div style={{ overflowX: 'auto', width: '100%' }}>
        {columns.length === 0 ? (
          <div style={{ padding: '36px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            {t('暂未配置输出列，请从上方或左侧添加字段')}
          </div>
        ) : (
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              textAlign: 'left',
            }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc', color: '#475569' }}>
                <th style={{ width: 36, textAlign: 'center', padding: '9px 4px' }}></th>
                <th style={{ width: 95, padding: '9px 12px', fontWeight: 600 }}>{t('列类型')}</th>
                <th style={{ padding: '9px 12px', fontWeight: 600 }}>{t('字段 / 表达式')}</th>
                <th style={{ width: 180, padding: '9px 12px', fontWeight: 600 }}>
                  {t('表头显示名称')}
                </th>
                <th style={{ width: 110, textAlign: 'center', padding: '9px 12px', fontWeight: 600 }}>
                  {t('操作')}
                </th>
              </tr>
            </thead>
            <tbody>
              {columns.map((record, idx) => {
                const isDragging = draggedIndex === idx;
                const isOver = dragOverIndex === idx && draggedIndex !== idx;
                const isComputed = record.type === 'computed';
                const displayLabel =
                  record.label ||
                  (record.type === 'fixed' ? record.field : (record as any).name);
                const matchedField =
                  record.type === 'fixed' || record.type === 'aggregated'
                    ? availableFields.find((f) => f.key === record.field)
                    : undefined;
                const sourceFieldLabel =
                  matchedField?.label ||
                  (record.type === 'fixed' || record.type === 'aggregated' ? record.field : '');

                return (
                  <tr
                    key={idx}
                    draggable
                    onDragStart={(e) => {
                      setDraggedIndex(idx);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(idx));
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverIndex !== idx) {
                        setDragOverIndex(idx);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggedIndex !== null && draggedIndex !== idx) {
                        handleRowDrop(draggedIndex, idx);
                      }
                      setDraggedIndex(null);
                      setDragOverIndex(null);
                    }}
                    onDragEnd={() => {
                      setDraggedIndex(null);
                      setDragOverIndex(null);
                    }}
                    style={{
                      cursor: 'move',
                      opacity: isDragging ? 0.35 : 1,
                      backgroundColor: isOver ? '#e6f4ff' : idx % 2 === 1 ? '#fafcff' : '#ffffff',
                      borderBottom: '1px solid #f0f0f0',
                      borderTop:
                        isOver && draggedIndex !== null && draggedIndex > idx
                          ? '2px solid #1677ff'
                          : undefined,
                      borderBottomStyle:
                        isOver && draggedIndex !== null && draggedIndex < idx
                          ? 'solid'
                          : undefined,
                      borderBottomColor:
                        isOver && draggedIndex !== null && draggedIndex < idx
                          ? '#1677ff'
                          : undefined,
                      borderBottomWidth:
                        isOver && draggedIndex !== null && draggedIndex < idx ? '2px' : undefined,
                      transition: 'background-color 0.15s ease, opacity 0.15s ease',
                    }}
                  >
                    <td style={{ textAlign: 'center', padding: '6px 4px' }}>
                      <Tooltip title={t('按住拖拽调整列顺序')}>
                        <HolderOutlined
                          style={{
                            cursor: 'grab',
                            color: '#8c8c8c',
                            fontSize: 15,
                            display: 'inline-block',
                            verticalAlign: 'middle',
                          }}
                        />
                      </Tooltip>
                    </td>
                    <td style={{ padding: '6px 12px' }}>
                      {record.type === 'fixed' && <Tag color="blue">{t('固定原值')}</Tag>}
                      {record.type === 'aggregated' && <Tag color="cyan">{t('聚合指标')}</Tag>}
                      {record.type === 'computed' && <Tag color="purple">{t('动态计算')}</Tag>}
                    </td>
                    <td style={{ padding: '6px 12px' }}>
                      {record.type === 'fixed' && (
                        showFieldKeys ? (
                          <Space size={6}>
                            <span style={{ fontWeight: 500, color: '#1e293b' }}>{sourceFieldLabel}</span>
                            <Text code style={{ fontSize: 11 }}>{record.field}</Text>
                          </Space>
                        ) : (
                          <Tooltip title={matchedField && matchedField.label !== record.field ? `${t('物理键名')}: ${record.field}` : undefined}>
                            <span style={{ fontWeight: 500, color: '#1e293b' }}>{sourceFieldLabel}</span>
                          </Tooltip>
                        )
                      )}
                      {record.type === 'aggregated' && (
                        <div
                          onMouseDown={(e) => e.stopPropagation()}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          <Select
                            size="small"
                            value={record.agg}
                            style={{ width: 125 }}
                            popupMatchSelectWidth={false}
                            onChange={(agg) => handleUpdateAgg(idx, agg)}
                            options={[
                              { value: 'sum', label: `${t('求和')} (SUM)` },
                              { value: 'avg', label: `${t('平均值')} (AVG)` },
                              { value: 'min', label: `${t('最小值')} (MIN)` },
                              { value: 'max', label: `${t('最大值')} (MAX)` },
                              { value: 'count', label: `${t('计数')} (COUNT)` },
                            ]}
                          />
                          {showFieldKeys ? (
                            <Space size={6}>
                              <span style={{ fontWeight: 500, color: '#1e293b' }}>{sourceFieldLabel}</span>
                              <Text code style={{ fontSize: 11 }}>{record.field}</Text>
                            </Space>
                          ) : (
                            <Tooltip title={matchedField && matchedField.label !== record.field ? `${t('物理键名')}: ${record.field}` : undefined}>
                              <span style={{ fontWeight: 500, color: '#1e293b' }}>{sourceFieldLabel}</span>
                            </Tooltip>
                          )}
                        </div>
                      )}
                      {record.type === 'computed' && (
                        <Tooltip title={record.expression}>
                          <Text code style={{ maxWidth: 260 }} ellipsis>
                            {record.expression}
                          </Text>
                        </Tooltip>
                      )}
                    </td>
                    <td style={{ padding: '6px 12px' }}>
                      <div onMouseDown={(e) => e.stopPropagation()}>
                        <Input
                          size="small"
                          value={displayLabel}
                          draggable={false}
                          onChange={(e) => handleUpdateLabel(idx, e.target.value)}
                        />
                      </div>
                    </td>
                    <td style={{ textAlign: 'center', padding: '6px 12px' }}>
                      <div onMouseDown={(e) => e.stopPropagation()}>
                        <Space size={4}>
                          {isComputed && (
                            <Tooltip title={t('编辑公式')}>
                              <Button
                                size="small"
                                type="text"
                                icon={<EditOutlined style={{ color: '#1677ff' }} />}
                                onClick={() => onOpenFormulaModal(record)}
                              />
                            </Tooltip>
                          )}
                          <Tooltip title={t('复制列')}>
                            <Button
                              size="small"
                              type="text"
                              icon={<CopyOutlined style={{ color: '#595959' }} />}
                              onClick={() => handleDuplicate(idx)}
                            />
                          </Tooltip>
                          <Tooltip title={t('删除列')}>
                            <Button
                              size="small"
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => handleDelete(idx)}
                            />
                          </Tooltip>
                        </Space>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 行业指标模板使用统一报表弹窗 */}
      <ReportModal
        title={
          <Space size={6}>
            <AppstoreAddOutlined style={{ color: '#722ed1' }} />
            <span>{t('套用行业预设指标模板')}</span>
          </Space>
        }
        open={templateModalOpen}
        onOk={handleApplyTemplate}
        onCancel={() => setTemplateModalOpen(false)}
        okText={t('一键导入指标列')}
        cancelText={t('取消')}
        destroyOnHidden
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ marginBottom: 6, fontWeight: 500, fontSize: 13 }}>
              {t('选择预设行业指标模板')}
            </div>
            <Select
              value={selectedTemplateId}
              style={{ width: '100%' }}
              onChange={(val) => {
                setSelectedTemplateId(val);
                setFieldMapping({});
              }}
              options={metricTemplateRegistry.list().map((tmpl) => ({
                value: tmpl.id,
                label: `[${tmpl.category}] ${tmpl.name}`,
              }))}
            />
          </div>

          {activeTemplate && (
            <>
              {activeTemplate.description && (
                <div
                  style={{
                    padding: 8,
                    background: '#f5f5f5',
                    borderRadius: 4,
                  }}
                >
                  <Text type="secondary">{activeTemplate.description}</Text>
                </div>
              )}

              <Text strong style={{ display: 'block', marginTop: 4 }}>
                {t('请匹配原数据字段（映射到模板需求）：')}
              </Text>

              {activeTemplate.requires.map((req) => (
                <div key={req.key}>
                  <div style={{ marginBottom: 6, fontWeight: 500, fontSize: 13 }}>
                    <Space size={4}>
                      <span style={{ color: '#ff4d4f' }}>*</span>
                      <span>{req.label}</span>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        ({req.key})
                      </Text>
                      <Tag
                        color={req.type === 'number' ? 'green' : 'blue'}
                        style={{ fontSize: 10 }}
                      >
                        {req.type}
                      </Tag>
                    </Space>
                  </div>
                  <Select<string>
                    style={{ width: '100%' }}
                    placeholder={t('请选择原数据中对应的 {field} 字段', { field: req.label })}
                    value={fieldMapping[req.key] ?? null}
                    onChange={(val) => {
                      if (val) {
                        setFieldMapping((prev) => ({
                          ...prev,
                          [req.key]: val,
                        }));
                      }
                    }}
                    options={availableFields
                      .filter((f) => f.type === req.type || req.type === 'text')
                      .map((f) => {
                        const isDuplicate = availableFields.filter((other) => other.label === f.label).length > 1;
                        const itemLabel = showFieldKeys || isDuplicate ? `${f.label} (${f.key})` : f.label;
                        return {
                          value: f.key,
                          label: itemLabel,
                        };
                      })}
                  />
                </div>
              ))}
            </>
          )}
        </div>
      </ReportModal>
    </Card>
  );
};
