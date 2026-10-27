import React, { useState, useEffect } from 'react';
import {
  Modal,
  Alert,
  Checkbox,
  Form,
  Select,
  Radio,
  Input,
  InputNumber,
  Switch,
  Space,
  Divider,
  Typography,
  Tabs,
  Row,
  Col,
  Tag,
} from 'antd';
import type {
  CellDefinition,
  CellTemplateDocumentV1,
  CellFormatOptions,
  CellExpandDirection,
  CellDataOperation,
  CellMergePolicyKind,
  StaticSpanConfig,
} from '../report-template/types.js';
import type { AdvancedCellUpdate, PresentationRules, StyleRule, VisualStyleAction } from '../report-template/types.js';
import type { BiGridModel } from '../report/types.js';
import { emptyPresentationRules, targetForCell } from '../report-template/presentationTypes.js';
import { visualStyleForCell, validatePresentationRules, normalizeRuleColor } from '../report-template/presentationRules.js';
import { PresentationRuleEditor } from './PresentationRuleEditor.js';
import { StyleEffectEditor, rememberRuleColors } from './StyleEffectEditor.js';
import { StaticSpanSettings } from './StaticSpanSettings.js';

const { Text } = Typography;
const { TextArea } = Input;

export interface CellAdvancedSettingsProps {
  open: boolean;
  cell: CellDefinition | null;
  document: CellTemplateDocumentV1;
  onSave: (updated: AdvancedCellUpdate) => void;
  previewGrid?: BiGridModel | undefined;
  fields?: { key: string; label: string; type?: string | undefined }[] | undefined;
  onCancel: () => void;
}

export const CellAdvancedSettings: React.FC<CellAdvancedSettingsProps> = ({
  open,
  cell,
  document,
  onSave,
  onCancel, previewGrid, fields,
}) => {
  // Tab 1: 格式与数值状态
  const [format, setFormat] = useState<string | undefined>(undefined);
  const [precision, setPrecision] = useState<number | undefined>(undefined);
  const [useGrouping, setUseGrouping] = useState<boolean>(true);
  const [scale, setScale] = useState<number>(1);
  const [prefix, setPrefix] = useState<string>('');
  const [suffix, setSuffix] = useState<string>('');
  const [negativeFormat, setNegativeFormat] = useState<'minus' | 'bracket' | 'red_minus' | 'red_bracket'>('minus');
  const [emptyDisplay, setEmptyDisplay] = useState<string>('__NONE__');
  const [zeroDisplay, setZeroDisplay] = useState<'zero' | 'blank' | 'dash'>('zero');
  const [dateFormat, setDateFormat] = useState<string | undefined>(undefined);

  const [basicAction, setBasicAction] = useState<VisualStyleAction>({scope:'cell',style:{}});
  // Tab 3: 扩展与数据模式状态
  const [expand, setExpand] = useState<CellExpandDirection>('none');
  const [operation, setOperation] = useState<CellDataOperation>('sum');
  const [tooltip, setTooltip] = useState<string>('');
  const [mergePolicy, setMergePolicy] = useState<CellMergePolicyKind>('default');

  // Tab 4: 条件告警与父格状态
  const [rules, setRules] = useState<PresentationRules>(emptyPresentationRules);
  const [saveError, setSaveError] = useState('');
  const [rowParent, setRowParent] = useState<string | null>('default');
  const [colParent, setColParent] = useState<string | null>('default');
  const [staticText, setStaticText] = useState('');
  const [staticSpan, setStaticSpan] = useState<StaticSpanConfig | undefined>(undefined);

  useEffect(() => {
    if (open && cell) {
      const content = cell.content as any;
      const normal = visualStyleForCell(document,cell);
      setRules(structuredClone(document.presentationRules || emptyPresentationRules()));
      setBasicAction({scope:normal?.scope==='row'?'row':'cell',regionId:normal?.regionId,presetId:normal?.presetId,style:structuredClone(normal?.style||{}),reset:normal?.reset,noFill:normal?.noFill,rowColumns:normal?.rowColumns});setSaveError('');
      const fmtOpts: CellFormatOptions = content?.formatOptions || (cell as any).formatOptions || {};
      const area = document.layoutRules.find((r) => r.sheetId === cell.sheetId && r.kind === 'merge' && r.range?.startRow === cell.position.row && r.range.startColumn === cell.position.column)?.range;
      setStaticText(content.kind === 'literal' ? String(content.value ?? '') : '');
      setStaticSpan(cell.staticSpan || { id: `span-${cell.id}`, enabled: false,
        regionId: cell.regionId || document.regions.find((r) => r.sheetId === cell.sheetId)?.id || '', scope: 'report', placement: 'template', repeat: 'once',
        rowOffset: 0, height: area ? area.endRow - area.startRow + 1 : 1, includeTotals: true, merge: true, suppressions: [], templateRange: area });

      // 1. 格式
      setFormat(fmtOpts.format || content?.format || undefined);
      setPrecision(fmtOpts.precision !== undefined ? fmtOpts.precision : (content?.format === 'integer' ? 0 : 2));
      setUseGrouping(fmtOpts.useGrouping !== false);
      setScale(fmtOpts.scale || 1);
      setPrefix(fmtOpts.prefix || '');
      setSuffix(fmtOpts.suffix || '');
      setNegativeFormat(fmtOpts.negativeFormat || 'minus');
      setEmptyDisplay(fmtOpts.emptyDisplay !== undefined ? (fmtOpts.emptyDisplay === '' ? '__NONE__' : fmtOpts.emptyDisplay) : '__NONE__');
      setZeroDisplay(fmtOpts.zeroDisplay || 'zero');
      setDateFormat(fmtOpts.dateFormat || undefined);

      // 3. 扩展与数据模式
      setExpand(content.expand || 'none');
      setOperation(content.operation || 'sum');
      setTooltip(fmtOpts.tooltip || content.tooltip || (cell as any).tooltip || '');

      let initialMergePolicy: CellMergePolicyKind =
        (cell as any).mergePolicy || fmtOpts.mergePolicy || (content as any)?.mergePolicy || 'default';
      if (initialMergePolicy === 'default' && document.mergeConfig?.policies) {
        const cellPolicy = document.mergeConfig.policies.find(
          (p) => p.target.kind === 'template-cell' && (p.target as any).templateCellId === cell.id
        );
        if (cellPolicy) {
          if (!cellPolicy.enabled) {
            initialMergePolicy = 'none';
          } else if (cellPolicy.kind === 'adjacent-equal') {
            initialMergePolicy = 'adjacent-equal';
          } else if (cellPolicy.kind === 'group-span') {
            initialMergePolicy = 'group-span';
          }
        }
      }
      setMergePolicy(initialMergePolicy);

      // 4. 条件告警与父格
      setRowParent(cell.parents?.row ?? 'default');
      setColParent(cell.parents?.column ?? 'default');
    }
  }, [open, cell]);

  if (!cell) return null;

  // 候选父格列表 (同一工作表且非自身)
  const candidateCells = (document.cells || []).filter(
    (c) => c.id !== cell.id && c.sheetId === cell.sheetId
  );

  const isFieldCell = cell.content.kind === 'field';
  const isMeasureCell = isFieldCell && (cell.content as any).role === 'measure';

  const handleOk = () => {
    // 组装格式化选项
    const cleanEmpty = emptyDisplay === '__NONE__' ? undefined : emptyDisplay;
    const formatOptions: CellFormatOptions = {
      format: format === 'default' ? undefined : format,
      precision,
      useGrouping,
      scale,
      prefix: prefix.trim() || undefined,
      suffix: suffix.trim() || undefined,
      negativeFormat,
      emptyDisplay: cleanEmpty,
      zeroDisplay,
      dateFormat: dateFormat || undefined,
      tooltip: tooltip.trim() || undefined,
      mergePolicy,
    };

    const normal = visualStyleForCell(document,cell);
    const basic: StyleRule = { id: normal?.id || 'visual-'+cell.id, sheetId: cell.sheetId,
      targetId: cell.id, target: targetForCell(cell), scope: basicAction.scope==='row'?'row':'template-cell',style:basicAction.style,
      priority: normal?.priority ?? document.styleRules.length,regionId:basicAction.regionId||cell.regionId||(document.regions.filter(r=>r.sheetId===cell.sheetId).length===1?document.regions.find(r=>r.sheetId===cell.sheetId)?.id:undefined),presetId:basicAction.presetId,reset:basicAction.reset,noFill:basicAction.noFill,rowColumns:basicAction.rowColumns };
    const visualStyleRules = [...document.styleRules.filter(r=>r.id!==basic.id), basic];
    const presentationRules = { ...rules, revision: rules.revision+1 };
    const errors = validatePresentationRules({...document, presentationRules, styleRules:visualStyleRules}, fields?.map(f=>f.key)).filter(d=>d.severity==='error');
    if(errors.length){setSaveError(errors.map(d=>d.message).join('；'));return;}
    rememberRuleColors([basicAction.style.color,basicAction.style.backgroundColor,...rules.ruleSets.flatMap(s=>[s.otherwise?.style?.style.color,s.otherwise?.style?.style.backgroundColor,...s.rules.flatMap(r=>[r.style?.style.color,r.style?.style.backgroundColor])])]);
    onSave({
      presentationRules, visualStyleRules,
      ...(cell.content.kind === 'literal' ? { literalOverride: cell.literalOverride || staticText !== String(cell.content.value ?? '') } : {}),
      staticSpan: cell.content.kind === 'literal' && staticSpan && (staticSpan.enabled || cell.staticSpan) ? { ...staticSpan,
        templateRange: { startRow: cell.position.row, startColumn: cell.position.column,
          endRow: cell.position.row + staticSpan.height - 1,
          endColumn: cell.position.column + Math.max(0, (staticSpan.templateRange?.endColumn ?? cell.position.column) - (staticSpan.templateRange?.startColumn ?? cell.position.column)) } } : undefined,
      parents: {
        row: rowParent === '__NONE__' ? null : rowParent,
        column: colParent === '__NONE__' ? null : colParent,
      },
      mergePolicy,
      content: {
        ...cell.content,
        ...(cell.content.kind === 'literal' ? { value: staticText === String(cell.content.value ?? '') ? cell.content.value : staticText } : {}),
        format: format === 'default' ? undefined : format,
        expand: isFieldCell ? expand : (cell.content as any).expand,
        operation: isFieldCell ? operation : (cell.content as any).operation,
        formatOptions,
        tooltip: tooltip.trim() || undefined,
        mergePolicy,
      } as any,
      formatOptions,
    });
  };

  return (
    <Modal
      title={
        <Space size={8}>
          <span style={{ fontWeight: 600 }}>单元格高级配置</span>
          <Tag color="blue" style={{ fontSize: 12 }}>
            [R{cell.position.row + 1}C{cell.position.column + 1}]
          </Tag>
          {isFieldCell && (
            <Tag color={isMeasureCell ? 'orange' : 'cyan'}>
              {(cell.content as any).displayName || (cell.content as any).fieldKey}
            </Tag>
          )}
        </Space>
      }
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      width={1000}
      styles={{ body: { maxHeight: '72vh', overflowY: 'auto' } }}
      okText="应用配置" cancelText="取消"
      destroyOnClose
    >
      {saveError && <Alert type="error" message={saveError} style={{marginBottom:12}}/>}
      <Tabs
        defaultActiveKey="format"
        items={[
          {
            key: 'format',
            label: '格式与数值',
            children: (
              <Form layout="vertical" size="small" style={{ marginTop: 8 }}>
                <Row gutter={16}>
                  <Col span={14}>
                    <Form.Item label="数字展示格式类型">
                      <Select
                        value={format || 'default'}
                        onChange={(val) => setFormat(val === 'default' ? undefined : val)}
                        options={[
                          { value: 'default', label: '默认常规 (无预设格式)' },
                          { value: 'number', label: '千分数值 (1,234.00)' },
                          { value: 'decimal2', label: '两位小数 (1234.00)' },
                          { value: 'integer', label: '千分整数 (1,234)' },
                          { value: 'percent', label: '百分比 (12.34%)' },
                          { value: 'currency', label: '货币符号 (¥1,234.00)' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={10}>
                    <Form.Item label="小数保留位数 (0 ~ 6 位)">
                      <InputNumber
                        min={0}
                        max={6}
                        style={{ width: '100%' }}
                        value={precision ?? 2}
                        onChange={(val) => setPrecision(typeof val === 'number' ? val : 2)}
                      />
                    </Form.Item>
                  </Col>
                </Row>

                <Row gutter={16}>
                  <Col span={8}>
                    <Form.Item label="千分位逗号分隔">
                      <Switch
                        checked={useGrouping}
                        onChange={setUseGrouping}
                        checkedChildren="开启"
                        unCheckedChildren="关闭"
                      />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item label="量级缩放 (折算)">
                      <Select
                        value={scale}
                        onChange={setScale}
                        options={[
                          { value: 1, label: '1 (原始数值)' },
                          { value: 1000, label: '1,000 (千)' },
                          { value: 10000, label: '10,000 (万元)' },
                          { value: 1000000, label: '1,000,000 (百万元)' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item label="负数展现样式">
                      <Select
                        value={negativeFormat}
                        onChange={setNegativeFormat}
                        options={[
                          { value: 'minus', label: '-123.45 (常规负号)' },
                          { value: 'bracket', label: '(123.45) (会计括号)' },
                          { value: 'red_minus', label: '红字 -123.45' },
                          { value: 'red_bracket', label: '红字 (123.45)' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                </Row>

                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="前缀符号 (如 ¥, $, No.)">
                      <Input
                        placeholder="选填，如 ¥"
                        value={prefix}
                        onChange={(e) => setPrefix(e.target.value)}
                        allowClear
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="后缀单位 (如 件, 小时, %, kg)">
                      <Input
                        placeholder="选填，如 件、h、%"
                        value={suffix}
                        onChange={(e) => setSuffix(e.target.value)}
                        allowClear
                      />
                    </Form.Item>
                  </Col>
                </Row>

                <Divider style={{ margin: '8px 0 12px 0' }} />

                <Row gutter={16}>
                  <Col span={8}>
                    <Form.Item label="空值 (Null) 替代文本">
                      <Select
                        value={emptyDisplay}
                        onChange={setEmptyDisplay}
                        options={[
                          { value: '__NONE__', label: '保持空白' },
                          { value: '-', label: '横杠 (-)' },
                          { value: '0', label: '数字零 (0)' },
                          { value: '无', label: '文本 (无)' },
                          { value: 'N/A', label: 'N/A' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item label="数值为 0 显示模式">
                      <Select
                        value={zeroDisplay}
                        onChange={setZeroDisplay}
                        options={[
                          { value: 'zero', label: '正常显示 (0)' },
                          { value: 'blank', label: '隐藏为空白' },
                          { value: 'dash', label: '转为横杠 (-)' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item label="日期时间模版 (可选)">
                      <Select
                        allowClear
                        placeholder="默认原生"
                        value={dateFormat}
                        onChange={setDateFormat}
                        options={[
                          { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
                          { value: 'YYYY年MM月', label: 'YYYY年MM月' },
                          { value: 'MM-DD', label: 'MM-DD' },
                          { value: 'YYYY/MM/DD HH:mm', label: 'YYYY/MM/DD HH:mm' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </Form>
            ),
          },
          {
            key: 'style', label: '样式与排版', children: <StyleEffectEditor cell={cell} document={document} value={basicAction} onChange={setBasicAction}/>,
          },
          {
            key: 'expand',
            label: '扩展与数据模式',
            children: (
              <Form layout="vertical" size="small" style={{ marginTop: 8 }}>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="单元格扩展方向">
                      <Radio.Group
                        value={expand}
                        onChange={(e) => setExpand(e.target.value)}
                        disabled={!isFieldCell}
                      >
                        <Radio.Button value="down">向下扩展 (↓ 纵向行)</Radio.Button>
                        <Radio.Button value="right">向右扩展 (→ 横向列)</Radio.Button>
                        <Radio.Button value="none">不扩展 (· 汇总单值)</Radio.Button>
                      </Radio.Group>
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="数据计算与聚合方式">
                      <Select
                        value={operation}
                        onChange={setOperation}
                        disabled={!isFieldCell}
                        options={[
                          { value: 'sum', label: '求和 (SUM)' },
                          { value: 'avg', label: '平均值 (AVG)' },
                          { value: 'count', label: '计数 (COUNT)' },
                          { value: 'max', label: '最大值 (MAX)' },
                          { value: 'min', label: '最小值 (MIN)' },
                          { value: 'detail', label: '明细列表 (LIST，逐行平铺)' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                </Row>

                <Divider style={{ margin: '8px 0 12px 0' }} />

                <Row gutter={16}>
                  <Col span={24}>
                    <Form.Item label="动态合并规则 (受控指标 / 维度格专用)" style={{ marginBottom: 8 }}>
                      <Select
                        value={mergePolicy}
                        onChange={setMergePolicy}
                        disabled={!isFieldCell}
                        options={[
                          { value: 'default', label: '跟随向导全局设置 (默认)' },
                          { value: 'group-span', label: '同类项分组延展合并 (随内部子维度/指标块纵向跨行合并)' },
                          { value: 'adjacent-equal', label: '相邻相同值合并 (纵向连续值相同时自动合并)' },
                          { value: 'none', label: '禁止合并 (即使全局开启合并，当前列也强制逐行平铺)' },
                        ]}
                      />
                      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                        {isFieldCell
                          ? '控制该受控格在数据展开后如何执行动态合并。静态文本单元格请直接在 Excel 画布框选并点击工具栏【合并单元格】。'
                          : '当前单元格为静态单元格，请直接框选并点击 Excel 画布工具栏【合并单元格】。'}
                      </Text>
                    </Form.Item>
                  </Col>
                </Row>

                <Divider style={{ margin: '8px 0 12px 0' }} />

                <Form.Item label="指标口径业务解释 / 悬浮说明 (Tooltip)">
                  <TextArea
                    rows={3}
                    placeholder="例如：良品率 = (交付总件数 - 缺陷件数) / 交付总件数 * 100%。展示态鼠标悬浮时将呈现说明气泡。"
                    value={tooltip}
                    onChange={(e) => setTooltip(e.target.value)}
                    allowClear
                  />
                </Form.Item>
              </Form>
            ),
          },
          {
            key: 'parents',
            label: '父格与上下文',
            children: (
              <Form layout="vertical" size="small" style={{ marginTop: 8 }}>
                <Typography.Title level={5} style={{ margin: '0 0 8px 0', fontSize: 13 }}>
                  父格依赖设置 (上下文与扩展继承)
                </Typography.Title>
                <Form.Item label="行父格 (控制行方向成员上下文继承)">
                  <Select
                    allowClear
                    value={rowParent || '__NONE__'}
                    onChange={(val) => setRowParent(val === '__NONE__' ? null : val)}
                    options={[
                      { label: '默认 (系统推导)', value: 'default' },
                      { label: '无 (不继承行上下文)', value: '__NONE__' },
                      ...candidateCells.map((c) => ({
                        label: `[R${c.position.row + 1}C${c.position.column + 1}] ${(c.content as any).displayName || (c.content as any).fieldKey || (c.content as any).value || c.id}`,
                        value: c.id,
                      })),
                    ]}
                  />
                </Form.Item>

                <Form.Item label="列父格 (控制列方向交叉上下文继承)">
                  <Select
                    allowClear
                    value={colParent || '__NONE__'}
                    onChange={(val) => setColParent(val === '__NONE__' ? null : val)}
                    options={[
                      { label: '默认 (系统推导)', value: 'default' },
                      { label: '无 (不继承列上下文)', value: '__NONE__' },
                      ...candidateCells.map((c) => ({
                        label: `[R${c.position.row + 1}C${c.position.column + 1}] ${(c.content as any).displayName || (c.content as any).fieldKey || (c.content as any).value || c.id}`,
                        value: c.id,
                      })),
                    ]}
                  />
                </Form.Item>
              </Form>
            ),
          },
          { key:'rules', label:'条件规则', children:<PresentationRuleEditor cell={cell} document={document} fields={fields} previewGrid={previewGrid} value={rules} onChange={setRules}/> },
          ...(cell.content.kind === 'literal' && staticSpan ? [{
            key: 'static-span', label: '范围跟随', children: <StaticSpanSettings cell={cell} document={document} value={staticSpan} text={staticText}
              onTextChange={setStaticText} onChange={setStaticSpan} onActivate={() => setBasicAction(a=>({...a,style:{...a.style,textAlign:'center',verticalAlign:'middle'}}))} />,
          }] : []),
        ]}
      />
    </Modal>
  );
};
