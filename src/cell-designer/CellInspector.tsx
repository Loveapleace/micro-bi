import React, { useRef, useEffect, useState } from 'react';
import { Card, Form, Select, Input, Radio, Button, Space, Typography, Tag, Divider, Collapse, Tooltip } from 'antd';
import {
  SettingOutlined,
  DeleteOutlined,
  AppstoreOutlined,
  CheckCircleOutlined,
  AlignLeftOutlined,
  AlignCenterOutlined,
  AlignRightOutlined,
  BoldOutlined,
  BgColorsOutlined,
} from '@ant-design/icons';
import type {
  CellDefinition,
  CellBusinessRole,
  CellDataOperation,
  CellExpandDirection,
  CellTimeGranularity,
  DynamicMergePolicy,
  FieldCellContent,
  BusinessFormulaCellContent,
} from '../report-template/types.js';
import { resolveFieldId } from '../report-template/identity.js';

const { Text } = Typography;

export interface FieldItem {
  key: string;
  label: string;
  type?: string;
  sample?: any;
}

export interface CellInspectorProps {
  cell: CellDefinition | null;
  allCells?: CellDefinition[] | undefined;
  fields: FieldItem[];
  defaultRegionId?: string | undefined;
  datasetName?: string | undefined;
  mergePolicy?: DynamicMergePolicy | null | undefined;
  draftDirty?: boolean | undefined;
  onUpdateContent: (content: any) => void;
  onUpdateParents?: ((parents: { row: string | null; column: string | null }) => void) | undefined;
  onUpdateStyle?: ((style: Record<string, any>) => void) | undefined;
  onUpdateMergePolicy?: ((policy: DynamicMergePolicy | null) => void) | undefined;
  onApply?: (() => void) | undefined;
  onRevert?: (() => void) | undefined;
  onDelete: () => void;
  onOpenAdvanced: () => void;
}

export const CellInspector: React.FC<CellInspectorProps> = ({
  cell,
  allCells = [],
  fields,
  defaultRegionId,
  datasetName = '默认数据集',
  mergePolicy,
  onUpdateContent,
  onUpdateParents,
  onUpdateStyle,
  onUpdateMergePolicy,
  onDelete,
  onOpenAdvanced,
}) => {
  if (!cell) {
    return (
      <Card size="small" style={{ height: '100%' }}>
        <Text type="secondary">请在画布中选中单元格进行属性配置</Text>
      </Card>
    );
  }

  const effectiveRegionId = cell.regionId || defaultRegionId || allCells.find((c) => c.regionId)?.regionId || 'region-1';

  const content = cell.content;
  const isField = content.kind === 'field';
  const isFormula = content.kind === 'business-formula';
  const isLiteral = content.kind === 'literal';

  // 候选行父格与列父格 (供父格依赖选择)
  const candidateRowParents = (allCells || []).filter(
    (c) => c.id !== cell.id && c.content.kind === 'field' && (c.content.role === 'row-dimension' || c.content.expand === 'down')
  );
  const candidateColParents = (allCells || []).filter(
    (c) => c.id !== cell.id && c.content.kind === 'field' && (c.content.role === 'column-dimension' || c.content.expand === 'right')
  );

  // 本地文本缓冲，保障键盘打字流畅并在失焦/回车时即时提交
  const [localLiteral, setLocalLiteral] = useState(content.kind === 'literal' ? (content.value ?? '') : '');
  const [localDisplayName, setLocalDisplayName] = useState((content as any).displayName ?? '');
  const [localExpression, setLocalExpression] = useState((content as any).expression ?? '');

  // 记住各类型的内容记忆，避免切换类型时数据丢失
  const memoryRef = useRef<{
    literalValue?: any;
    fieldContent?: Partial<FieldCellContent> | undefined;
    formulaContent?: Partial<BusinessFormulaCellContent> | undefined;
    lastCellKey?: string | undefined;
  }>({});

  const currentCellKey = `${cell.sheetId}::${cell.position.row},${cell.position.column}::${cell.id}`;

  useEffect(() => {
    if (content.kind === 'literal') {
      setLocalLiteral(content.value ?? '');
    } else {
      setLocalDisplayName((content as any).displayName ?? '');
      if (content.kind === 'business-formula') {
        setLocalExpression((content as any).expression ?? '');
      }
    }

    if (memoryRef.current.lastCellKey !== currentCellKey) {
      memoryRef.current = {
        lastCellKey: currentCellKey,
        literalValue: cell.content.kind === 'literal' ? cell.content.value : undefined,
        fieldContent: cell.content.kind === 'field' ? { ...cell.content } : undefined,
        formulaContent: cell.content.kind === 'business-formula' ? { ...cell.content } : undefined,
      };
    } else {
      if (cell.content.kind === 'literal' && cell.content.value !== undefined) {
        memoryRef.current.literalValue = cell.content.value;
      } else if (cell.content.kind === 'field') {
        memoryRef.current.fieldContent = { ...cell.content };
      } else if (cell.content.kind === 'business-formula') {
        memoryRef.current.formulaContent = { ...cell.content };
      }
    }
  }, [currentCellKey, cell, content]);

  const handleKindChange = (kind: 'field' | 'literal' | 'business-formula') => {
    if (kind === 'field') {
      if (memoryRef.current.fieldContent?.fieldKey) {
        onUpdateContent({
          ...memoryRef.current.fieldContent,
          kind: 'field',
        });
        return;
      }
      // 智能匹配：如果当前单元格有文本，尝试匹配对应字段（例如文本为“交付件数”匹配 output_qty）
      const currentText = String(
        localLiteral !== undefined && localLiteral !== ''
          ? localLiteral
          : (memoryRef.current.literalValue !== undefined
              ? memoryRef.current.literalValue
              : (content.kind === 'literal' ? content.value : ''))
      ).trim();

      const matched = fields.find((f) => f.label === currentText || f.key === currentText);
      const chosen = matched || fields[0];
      const chosenKey = chosen?.key || 'field_1';

      const isNum = chosen?.type === 'number';
      const isDate = chosen?.type === 'date';

      let role: CellBusinessRole = 'measure';
      let op: CellDataOperation = 'sum';
      let expand: CellExpandDirection = 'inherit';

      if (isDate) {
        role = 'column-dimension';
        op = 'group';
        expand = 'right';
      } else if (!isNum) {
        role = 'row-dimension';
        op = 'group';
        expand = 'down';
        if (!mergePolicy && onUpdateMergePolicy) {
          onUpdateMergePolicy({
            id: `merge-${cell.id}`,
            sheetId: cell.sheetId,
            regionId: effectiveRegionId,
            target: {
              kind: 'template-cell',
              templateCellId: cell.id,
              subject: 'row-member-label',
            },
            kind: 'group-span',
            direction: 'vertical',
            enabled: true,
            boundary: 'parent-group',
            source: 'user',
            sequence: 10,
          });
        }
      }

      if (!cell.parents || cell.parents.row === null) {
        onUpdateParents?.({
          row: 'default',
          column: 'default',
        });
      }

      onUpdateContent({
        kind: 'field',
        fieldId: resolveFieldId(chosenKey),
        fieldKey: chosenKey,
        role,
        operation: op,
        expand,
        displayName: chosen?.label || chosenKey,
      });
    } else if (kind === 'business-formula') {
      if (memoryRef.current.formulaContent?.expression) {
        onUpdateContent({
          ...memoryRef.current.formulaContent,
          kind: 'business-formula',
        });
        return;
      }
      onUpdateContent({
        kind: 'business-formula',
        metricId: 'calc_1',
        expression: '[field_1] * 1.0',
        scope: 'summary',
        precision: 2,
        displayName: '计算指标',
      });
    } else {
      // 切换为静态内容：优先恢复之前保存的 literal 文本，绝不强制置空！
      const restoredValue =
        memoryRef.current.literalValue !== undefined
          ? memoryRef.current.literalValue
          : (content as any).displayName || (content as any).value || (content as any).fieldKey || '';

      memoryRef.current.literalValue = restoredValue;
      setLocalLiteral(restoredValue);
      onUpdateContent({
        kind: 'literal',
        value: restoredValue,
      });
    }
  };

  return (
    <Card
      size="small"
      title={
        <Space size={6}>
          <AppstoreOutlined style={{ color: '#1677ff' }} />
          <span>单元格属性</span>
          <Tag color="blue">
            R{cell.position.row + 1}C{cell.position.column + 1}
          </Tag>
        </Space>
      }
      extra={
        <Button
          size="small"
          type="link"
          icon={<SettingOutlined />}
          onClick={onOpenAdvanced}
        >
          高级
        </Button>
      }
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      styles={{ body: { flex: 1, overflow: 'hidden', padding: '12px', display: 'flex', flexDirection: 'column' } }}
    >
      <Form layout="vertical" size="small" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
          {/* 1. 内容类型 */}
          <Form.Item label="内容类型" style={{ marginBottom: 12 }}>
            <Radio.Group
              value={content.kind}
              onChange={(e) => handleKindChange(e.target.value)}
              buttonStyle="solid"
            >
              <Radio.Button value="field">数据字段</Radio.Button>
              <Radio.Button value="literal">静态内容</Radio.Button>
              <Radio.Button value="business-formula">业务公式</Radio.Button>
            </Radio.Group>
          </Form.Item>

          {/* 2. 字段绑定配置 (极简高效布局) */}
          {isField && (
            <>
              <Form.Item label="绑定字段" style={{ marginBottom: 10 }}>
                <Select
                  showSearch
                  value={content.fieldKey}
                  onChange={(val) => {
                    const matched = fields.find((f) => f.key === val);
                    const isNum = matched?.type === 'number';
                    const isDate = matched?.type === 'date';

                    let role: CellBusinessRole = content.role;
                    let operation: CellDataOperation = content.operation;
                    let expand: CellExpandDirection = content.expand;

                    // 切换字段时智能推导角色
                    if (isDate) {
                      role = 'column-dimension';
                      operation = 'group';
                      expand = 'right';
                    } else if (isNum) {
                      role = 'measure';
                      operation = 'sum';
                      expand = 'inherit';
                    } else {
                      role = 'row-dimension';
                      operation = 'group';
                      expand = 'down';
                    }

                    if (!cell.parents || cell.parents.row === null) {
                      onUpdateParents?.({
                        row: 'default',
                        column: 'default',
                      });
                    }

                    onUpdateContent({
                      fieldId: resolveFieldId(val),
                      fieldKey: val,
                      displayName: matched?.label || val,
                      role,
                      operation,
                      expand,
                    });
                  }}
                  options={fields.map((f) => ({
                    label: `${f.label} (${f.key})`,
                    value: f.key,
                  }))}
                />
              </Form.Item>

              <Form.Item label="业务角色" style={{ marginBottom: 10 }}>
                <Select
                  value={content.role}
                  onChange={(val: CellBusinessRole) => {
                    let defaultOp: CellDataOperation = 'sum';
                    let defaultExpand: CellExpandDirection = 'inherit';

                    if (val === 'row-dimension') {
                      defaultOp = 'group';
                      defaultExpand = 'down';
                      if (!mergePolicy && onUpdateMergePolicy) {
                        onUpdateMergePolicy({
                          id: `merge-${cell.id}`,
                          sheetId: cell.sheetId,
                          regionId: effectiveRegionId,
                          target: {
                            kind: 'template-cell',
                            templateCellId: cell.id,
                            subject: 'row-member-label',
                          },
                          kind: 'group-span',
                          direction: 'vertical',
                          enabled: true,
                          boundary: 'parent-group',
                          source: 'user',
                          sequence: 10,
                        });
                      }
                    } else if (val === 'column-dimension') {
                      defaultOp = 'group';
                      defaultExpand = 'right';
                    } else if (val === 'detail-column') {
                      defaultOp = 'list';
                      defaultExpand = 'down';
                    }

                    onUpdateContent({
                      role: val,
                      operation: defaultOp,
                      expand: defaultExpand,
                    });
                  }}
                  options={[
                    { label: '指标度量 (Measure)', value: 'measure' },
                    { label: '行维度 (Row Dimension)', value: 'row-dimension' },
                    { label: '列维度 (Column Dimension)', value: 'column-dimension' },
                    { label: '明细列 (Detail Column)', value: 'detail-column' },
                  ]}
                />
              </Form.Item>

              {content.role === 'measure' && (
                <Form.Item label="聚合方式" style={{ marginBottom: 10 }}>
                  <Select
                    value={content.operation}
                    onChange={(val: CellDataOperation) => onUpdateContent({ operation: val })}
                    options={[
                      { label: '求和 (SUM)', value: 'sum' },
                      { label: '平均值 (AVG)', value: 'avg' },
                      { label: '非空计数 (COUNT)', value: 'count' },
                      { label: '最小值 (MIN)', value: 'min' },
                      { label: '最大值 (MAX)', value: 'max' },
                    ]}
                  />
                </Form.Item>
              )}

              <Form.Item label="显示名称" style={{ marginBottom: 10 }}>
                <Input
                  value={localDisplayName}
                  onChange={(e) => setLocalDisplayName(e.target.value)}
                  onBlur={() => {
                    if (localDisplayName !== (content.displayName || '')) {
                      onUpdateContent({ displayName: localDisplayName });
                    }
                  }}
                  onPressEnter={() => {
                    if (localDisplayName !== (content.displayName || '')) {
                      onUpdateContent({ displayName: localDisplayName });
                    }
                  }}
                  placeholder={content.fieldKey}
                />
              </Form.Item>

              {/* 进阶规则：扩展方向与动态合并 (收拢在折叠面板，默认收起) */}
              <Collapse
                ghost
                size="small"
                style={{ marginTop: 4, background: '#fafafa', borderRadius: 4 }}
                items={[
                  {
                    key: 'advanced_rules',
                    label: <span style={{ fontSize: 12, color: '#595959', fontWeight: 500 }}>进阶规则（父格依赖与动态合并）</span>,
                    children: (
                      <>
                        <Form.Item label="扩展方向" style={{ marginBottom: 8 }}>
                          <Radio.Group
                            value={content.expand}
                            onChange={(e) => onUpdateContent({ expand: e.target.value })}
                          >
                            <Radio value="down">向下</Radio>
                            <Radio value="right">向右</Radio>
                            <Radio value="inherit">跟随父格</Radio>
                            <Radio value="none">固定</Radio>
                          </Radio.Group>
                        </Form.Item>

                        <Form.Item label="左侧父格 (行分组依据)" style={{ marginBottom: 8 }}>
                          <Select
                            value={cell.parents?.row ?? 'default'}
                            onChange={(val) => {
                              onUpdateParents?.({
                                row: val === 'default' ? 'default' : (val === 'none' ? 'none' : val),
                                column: cell.parents?.column ?? 'default',
                              });
                            }}
                            options={[
                              { label: '默认 (跟随左侧最近维度)', value: 'default' },
                              { label: '无行父格 (独立展开)', value: 'none' },
                              ...candidateRowParents.map((c) => ({
                                label: `R${c.position.row + 1}C${c.position.column + 1} ${c.content.kind === 'field' ? (c.content.displayName || c.content.fieldKey) : ''}`,
                                value: c.id,
                              })),
                            ]}
                          />
                        </Form.Item>

                        <Form.Item label="上方父格 (列分组依据)" style={{ marginBottom: 8 }}>
                          <Select
                            value={cell.parents?.column ?? 'default'}
                            onChange={(val) => {
                              onUpdateParents?.({
                                row: cell.parents?.row ?? 'default',
                                column: val === 'default' ? 'default' : (val === 'none' ? 'none' : val),
                              });
                            }}
                            options={[
                              { label: '默认 (跟随上方最近维度)', value: 'default' },
                              { label: '无列父格 (独立展开)', value: 'none' },
                              ...candidateColParents.map((c) => ({
                                label: `R${c.position.row + 1}C${c.position.column + 1} ${c.content.kind === 'field' ? (c.content.displayName || c.content.fieldKey) : ''}`,
                                value: c.id,
                              })),
                            ]}
                          />
                        </Form.Item>

                        {(content.role === 'row-dimension' || content.role === 'column-dimension') && (
                          <Form.Item label="时间周期分桶" style={{ marginBottom: 8 }}>
                            <Select
                              allowClear
                              placeholder="原始时间 (不截断)"
                              value={content.timeBucket?.granularity}
                              onChange={(val?: CellTimeGranularity) => {
                                onUpdateContent({
                                  timeBucket: val ? { granularity: val } : undefined,
                                });
                              }}
                              options={[
                                { label: '按日 (Day)', value: 'day' },
                                { label: '按月 (Month)', value: 'month' },
                                { label: '按季度 (Quarter)', value: 'quarter' },
                                { label: '按年 (Year)', value: 'year' },
                                { label: '按周 (Week)', value: 'week' },
                                { label: '按小时 (Hour)', value: 'hour' },
                              ]}
                            />
                          </Form.Item>
                        )}

                        <Form.Item label="动态合并规则" style={{ marginBottom: 8 }}>
                          <Select
                            value={mergePolicy ? mergePolicy.kind : 'none'}
                            onChange={(val) => {
                              if (val === 'none') {
                                if (onUpdateMergePolicy && mergePolicy) {
                                  onUpdateMergePolicy(null);
                                }
                              } else if (val === 'group-span') {
                                if (onUpdateMergePolicy) {
                                  onUpdateMergePolicy({
                                    id: mergePolicy?.id || `merge-${cell.id}`,
                                    sheetId: cell.sheetId,
                                    regionId: effectiveRegionId,
                                    target: {
                                      kind: 'template-cell',
                                      templateCellId: cell.id,
                                      subject: content.role === 'row-dimension' ? 'row-member-label' : 'column-member-label',
                                    },
                                    kind: 'group-span',
                                    direction: 'auto',
                                    boundary: 'parent-group',
                                    enabled: true,
                                    source: 'user',
                                    sequence: 1,
                                  });
                                }
                              } else if (val === 'adjacent-equal') {
                                if (onUpdateMergePolicy) {
                                  onUpdateMergePolicy({
                                    id: mergePolicy?.id || `merge-${cell.id}`,
                                    sheetId: cell.sheetId,
                                    regionId: effectiveRegionId,
                                    target: {
                                      kind: 'template-cell',
                                      templateCellId: cell.id,
                                      subject: content.role === 'measure' ? 'metric-value' : 'detail-value',
                                    },
                                    kind: 'adjacent-equal',
                                    direction: 'vertical',
                                    compareBy: 'typed-value',
                                    mergeNulls: false,
                                    mergeUndefined: false,
                                    mergeEmptyStrings: false,
                                    allowMeasures: content.role === 'measure',
                                    boundary: 'parent-group',
                                    enabled: true,
                                    source: 'user',
                                    sequence: 1,
                                  });
                                }
                              }
                            }}
                            options={[
                              { value: 'none', label: '不合并 (默认)' },
                              { value: 'group-span', label: '按分组覆盖 (随指标块延展)' },
                              { value: 'adjacent-equal', label: '相邻同值合并 (相同值连续)' },
                            ]}
                          />
                        </Form.Item>

                        <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 4 }}>
                          数据源：{datasetName}
                        </div>
                      </>
                    ),
                  },
                ]}
              />
            </>
          )}

          {/* 3. 业务公式配置 */}
          {isFormula && (
            <>
              <Form.Item label="指标标识 (Metric ID)" style={{ marginBottom: 10 }}>
                <Input
                  value={content.metricId}
                  onChange={(e) => onUpdateContent({ metricId: e.target.value })}
                />
              </Form.Item>

              <Form.Item label="计算范围 (Scope)" style={{ marginBottom: 10 }}>
                <Radio.Group
                  value={content.scope || 'summary'}
                  onChange={(e) => onUpdateContent({ scope: e.target.value })}
                >
                  <Radio.Button value="summary">聚合汇总计算</Radio.Button>
                  <Radio.Button value="row">行级计算</Radio.Button>
                </Radio.Group>
              </Form.Item>

              <Form.Item label="计算表达式" style={{ marginBottom: 10 }}>
                <Input.TextArea
                  rows={3}
                  value={localExpression}
                  onChange={(e) => setLocalExpression(e.target.value)}
                  onBlur={() => {
                    if (localExpression !== (content.expression || '')) {
                      onUpdateContent({ expression: localExpression });
                    }
                  }}
                  placeholder="例如: [field_a] / [field_b] * 100"
                />
              </Form.Item>

              <Form.Item label="显示名称" style={{ marginBottom: 10 }}>
                <Input
                  value={localDisplayName}
                  onChange={(e) => setLocalDisplayName(e.target.value)}
                  onBlur={() => {
                    if (localDisplayName !== (content.displayName || '')) {
                      onUpdateContent({ displayName: localDisplayName });
                    }
                  }}
                />
              </Form.Item>
            </>
          )}

          {/* 4. 静态文本配置 */}
          {isLiteral && (
            <>
              <Form.Item label="文本 / 静态数值" style={{ marginBottom: 10 }}>
                <Input
                  value={localLiteral}
                  onChange={(e) => {
                    setLocalLiteral(e.target.value);
                    memoryRef.current.literalValue = e.target.value;
                  }}
                  onBlur={() => {
                    if (localLiteral !== (content.value ?? '')) {
                      onUpdateContent({ value: localLiteral });
                    }
                  }}
                  onPressEnter={() => {
                    if (localLiteral !== (content.value ?? '')) {
                      onUpdateContent({ value: localLiteral });
                    }
                  }}
                  placeholder="请输入标题、说明或常量"
                />
              </Form.Item>

              {(!localLiteral || localLiteral === '') && (
                <div style={{ padding: '8px 10px', background: '#e6f4ff', borderRadius: 4, marginBottom: 10, fontSize: 12 }}>
                  <div style={{ color: '#0958d9', fontWeight: 500, marginBottom: 4 }}>快速绑定字段至此单元格：</div>
                  <Select
                    style={{ width: '100%' }}
                    placeholder="从数据源选取字段立即绑定..."
                    value={undefined}
                    onChange={(val) => {
                      const key = String(val ?? '');
                      const matched = fields.find((f) => f.key === key);
                      const isNum = matched?.type === 'number';
                      const isDate = matched?.type === 'date';
                      let role: CellBusinessRole = 'measure';
                      let op: CellDataOperation = 'sum';
                      let expand: CellExpandDirection = 'inherit';
                      if (isDate) {
                        role = 'column-dimension';
                        op = 'group';
                        expand = 'right';
                      } else if (!isNum) {
                        role = 'row-dimension';
                        op = 'group';
                        expand = 'down';
                      }
                      onUpdateContent({
                        kind: 'field',
                        fieldId: resolveFieldId(key),
                        fieldKey: key,
                        displayName: matched?.label || key,
                        role,
                        operation: op,
                        expand,
                      });
                    }}
                    options={fields.map((f) => ({
                      label: `${f.label} (${f.key})`,
                      value: f.key,
                    }))}
                  />
                </div>
              )}
            </>
          )}

          {/* 外观与对齐控制台 (CER-16, Problem 12) */}
          <Collapse
            ghost
            size="small"
            defaultActiveKey={['style_section']}
            style={{ marginTop: 8, background: '#fafafa', borderRadius: 4 }}
            items={[
              {
                key: 'style_section',
                label: <span style={{ fontSize: 12, color: '#595959', fontWeight: 500 }}>外观与对齐</span>,
                children: (
                  <Space direction="vertical" style={{ width: '100%' }} size={8}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: '#595959' }}>水平对齐:</span>
                      <Radio.Group
                        size="small"
                        value={cell.style?.textAlign || 'left'}
                        onChange={(e) => onUpdateStyle?.({ ...(cell.style || {}), textAlign: e.target.value })}
                        buttonStyle="solid"
                      >
                        <Tooltip title="左对齐"><Radio.Button value="left"><AlignLeftOutlined /></Radio.Button></Tooltip>
                        <Tooltip title="居中"><Radio.Button value="center"><AlignCenterOutlined /></Radio.Button></Tooltip>
                        <Tooltip title="右对齐"><Radio.Button value="right"><AlignRightOutlined /></Radio.Button></Tooltip>
                      </Radio.Group>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: '#595959' }}>垂直对齐:</span>
                      <Radio.Group
                        size="small"
                        value={cell.style?.verticalAlign || 'middle'}
                        onChange={(e) => onUpdateStyle?.({ ...(cell.style || {}), verticalAlign: e.target.value })}
                        buttonStyle="solid"
                      >
                        <Radio.Button value="top">上</Radio.Button>
                        <Radio.Button value="middle">中</Radio.Button>
                        <Radio.Button value="bottom">下</Radio.Button>
                      </Radio.Group>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: '#595959' }}>字体加粗:</span>
                      <Button
                        size="small"
                        type={cell.style?.bold ? 'primary' : 'default'}
                        icon={<BoldOutlined />}
                        onClick={() => onUpdateStyle?.({ ...(cell.style || {}), bold: !cell.style?.bold })}
                      >
                        {cell.style?.bold ? '已加粗' : '常规'}
                      </Button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Space size={4}>
                        <BgColorsOutlined style={{ color: '#8c8c8c' }} />
                        <span style={{ fontSize: 12, color: '#595959' }}>背景底色:</span>
                      </Space>
                      <Space size={4}>
                        {['#ffffff', '#f5f5f5', '#e6f7ff', '#f6ffed', '#fff7e6', '#fff1f0'].map((color) => (
                          <div
                            key={color}
                            onClick={() => onUpdateStyle?.({ ...(cell.style || {}), backgroundColor: color })}
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 3,
                              backgroundColor: color,
                              border: cell.style?.backgroundColor === color ? '2px solid #1677ff' : '1px solid #d9d9d9',
                              cursor: 'pointer',
                            }}
                          />
                        ))}
                      </Space>
                    </div>
                  </Space>
                ),
              },
            ]}
          />

          {/* 5. 进阶规则：父格依赖设置 (适用于公式与静态文本) */}
          {(isFormula || isLiteral) && (
            <Collapse
              ghost
              size="small"
              style={{ marginTop: 8, background: '#fafafa', borderRadius: 4 }}
              items={[
                {
                  key: 'parent_rules',
                  label: <span style={{ fontSize: 12, color: '#595959', fontWeight: 500 }}>进阶规则（父格依赖）</span>,
                  children: (
                    <>
                      <Form.Item label="左侧父格 (行分组依据)" style={{ marginBottom: 8 }}>
                        <Select
                          value={cell.parents?.row ?? 'default'}
                          onChange={(val) => {
                            onUpdateParents?.({
                              row: val === 'default' ? 'default' : (val === 'none' ? 'none' : val),
                              column: cell.parents?.column ?? 'default',
                            });
                          }}
                          options={[
                            { label: '默认 (跟随左侧最近维度)', value: 'default' },
                            { label: '无行父格 (独立展开/静态)', value: 'none' },
                            ...candidateRowParents.map((c) => ({
                              label: `R${c.position.row + 1}C${c.position.column + 1} ${c.content.kind === 'field' ? (c.content.displayName || c.content.fieldKey) : ''}`,
                              value: c.id,
                            })),
                          ]}
                        />
                      </Form.Item>

                      <Form.Item label="上方父格 (列分组依据)" style={{ marginBottom: 8 }}>
                        <Select
                          value={cell.parents?.column ?? 'default'}
                          onChange={(val) => {
                            onUpdateParents?.({
                              row: cell.parents?.row ?? 'default',
                              column: val === 'default' ? 'default' : (val === 'none' ? 'none' : val),
                            });
                          }}
                          options={[
                            { label: '默认 (跟随上方最近维度)', value: 'default' },
                            { label: '无列父格 (独立展开/静态)', value: 'none' },
                            ...candidateColParents.map((c) => ({
                              label: `R${c.position.row + 1}C${c.position.column + 1} ${c.content.kind === 'field' ? (c.content.displayName || c.content.fieldKey) : ''}`,
                              value: c.id,
                            })),
                          ]}
                        />
                      </Form.Item>
                    </>
                  ),
                },
              ]}
            />
          )}
        </div>

        {/* 底部即时生效状态栏 (彻底告别“应用配置”与“还原”按钮) */}
        <div
          style={{
            marginTop: 'auto',
            paddingTop: 8,
            borderTop: '1px solid #f0f0f0',
            backgroundColor: '#ffffff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Space size={4} style={{ color: '#52c41a', fontSize: 11, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <CheckCircleOutlined />
            <span style={{ color: '#8c8c8c' }}>即时生效 · Ctrl+Z 撤销</span>
          </Space>
          <Button
            danger
            type="text"
            size="small"
            style={{ padding: '0 4px', height: 22, fontSize: 12 }}
            icon={<DeleteOutlined />}
            onClick={onDelete}
          >
            清除
          </Button>
        </div>
      </Form>
    </Card>
  );
};
