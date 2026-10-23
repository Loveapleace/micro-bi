import React, { useState, useEffect } from 'react';
import {
  Modal,
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
  ConditionalRule,
  CellExpandDirection,
  CellDataOperation,
  CellMergePolicyKind,
} from '../report-template/types.js';

const { Text } = Typography;
const { TextArea } = Input;

export interface CellAdvancedSettingsProps {
  open: boolean;
  cell: CellDefinition | null;
  document: CellTemplateDocumentV1;
  onSave: (updated: Partial<CellDefinition>) => void;
  onCancel: () => void;
}

export const CellAdvancedSettings: React.FC<CellAdvancedSettingsProps> = ({
  open,
  cell,
  document,
  onSave,
  onCancel,
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

  // Tab 2: 样式与外观状态
  const [align, setAlign] = useState<'left' | 'center' | 'right'>('left');
  const [verticalAlign, setVerticalAlign] = useState<'top' | 'middle' | 'bottom'>('middle');
  const [fontSize, setFontSize] = useState<number>(12);
  const [bold, setBold] = useState<boolean>(false);
  const [italic, setItalic] = useState<boolean>(false);
  const [color, setColor] = useState<string>('');
  const [bgColor, setBgColor] = useState<string>('');
  const [wrapText, setWrapText] = useState<boolean>(false);

  // Tab 3: 扩展与数据模式状态
  const [expand, setExpand] = useState<CellExpandDirection>('none');
  const [operation, setOperation] = useState<CellDataOperation>('sum');
  const [tooltip, setTooltip] = useState<string>('');
  const [mergePolicy, setMergePolicy] = useState<CellMergePolicyKind>('default');

  // Tab 4: 条件告警与父格状态
  const [enableAlert, setEnableAlert] = useState<boolean>(false);
  const [alertOperator, setAlertOperator] = useState<'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'eq'>('lt');
  const [alertVal1, setAlertVal1] = useState<number>(90);
  const [alertVal2, setAlertVal2] = useState<number>(100);
  const [alertStyleScheme, setAlertStyleScheme] = useState<'red' | 'orange' | 'green'>('red');
  const [rowParent, setRowParent] = useState<string | null>('default');
  const [colParent, setColParent] = useState<string | null>('default');

  useEffect(() => {
    if (open && cell) {
      const content = cell.content as any;
      const fmtOpts: CellFormatOptions = content?.formatOptions || (cell as any).formatOptions || {};

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

      // 2. 样式
      setAlign(
        cell.style?.textAlign ||
          (content.kind === 'field' && content.role === 'measure' ? 'right' : 'left')
      );
      setVerticalAlign(cell.style?.verticalAlign || 'middle');
      setFontSize(cell.style?.fontSize || 12);
      setBold(cell.style?.bold ?? (content.kind === 'field'));
      setItalic(cell.style?.italic ?? false);
      setColor(cell.style?.color || '');
      setBgColor(cell.style?.backgroundColor || '');
      setWrapText(cell.style?.wrapText ?? false);

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
      const existingRules: ConditionalRule[] = (cell as any).conditionRules || content?.conditionRules || [];
      if (existingRules.length > 0 && existingRules[0]) {
        setEnableAlert(true);
        const r0 = existingRules[0];
        setAlertOperator(r0.condition.operator);
        setAlertVal1(r0.condition.values[0] ?? 90);
        setAlertVal2(r0.condition.values[1] ?? 100);
        if (r0.style?.color === '#52c41a') setAlertStyleScheme('green');
        else if (r0.style?.color === '#d46b08') setAlertStyleScheme('orange');
        else setAlertStyleScheme('red');
      } else {
        setEnableAlert(false);
        setAlertOperator('lt');
        setAlertVal1(90);
        setAlertVal2(100);
        setAlertStyleScheme('red');
      }

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

    // 组装条件规则
    let conditionRules: ConditionalRule[] | undefined = undefined;
    if (enableAlert) {
      let schemeStyle = {
        color: '#cf1322',
        backgroundColor: '#fff1f0',
        bold: true,
      };
      if (alertStyleScheme === 'orange') {
        schemeStyle = {
          color: '#d46b08',
          backgroundColor: '#fffbe6',
          bold: true,
        };
      } else if (alertStyleScheme === 'green') {
        schemeStyle = {
          color: '#389e0d',
          backgroundColor: '#f6ffed',
          bold: true,
        };
      }

      conditionRules = [
        {
          id: `cond-${cell.id}-${Date.now()}`,
          sheetId: cell.sheetId,
          targetMetricId: (cell.content as any).metricId || (cell.content as any).fieldKey,
          condition: {
            operator: alertOperator,
            values: alertOperator === 'between' ? [alertVal1, alertVal2] : [alertVal1],
          },
          style: schemeStyle,
          priority: 10,
        },
      ];
    }

    onSave({
      parents: {
        row: rowParent === '__NONE__' ? null : rowParent,
        column: colParent === '__NONE__' ? null : colParent,
      },
      mergePolicy,
      content: {
        ...cell.content,
        format: format === 'default' ? undefined : format,
        expand: isFieldCell ? expand : (cell.content as any).expand,
        operation: isFieldCell ? operation : (cell.content as any).operation,
        formatOptions,
        tooltip: tooltip.trim() || undefined,
        conditionRules,
        mergePolicy,
      } as any,
      style: {
        ...(cell.style || {}),
        textAlign: align,
        verticalAlign,
        fontSize,
        bold,
        italic,
        color: color || undefined,
        backgroundColor: bgColor || undefined,
        wrapText,
      },
      formatOptions,
      conditionRules,
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
      width={680}
      destroyOnClose
    >
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
            key: 'style',
            label: '样式与排版',
            children: (
              <Form layout="vertical" size="small" style={{ marginTop: 8 }}>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="水平对齐">
                      <Radio.Group value={align} onChange={(e) => setAlign(e.target.value)}>
                        <Radio.Button value="left">左对齐</Radio.Button>
                        <Radio.Button value="center">居中</Radio.Button>
                        <Radio.Button value="right">右对齐</Radio.Button>
                      </Radio.Group>
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="垂直对齐">
                      <Radio.Group value={verticalAlign} onChange={(e) => setVerticalAlign(e.target.value)}>
                        <Radio.Button value="top">顶端对齐</Radio.Button>
                        <Radio.Button value="middle">垂直居中</Radio.Button>
                        <Radio.Button value="bottom">底端对齐</Radio.Button>
                      </Radio.Group>
                    </Form.Item>
                  </Col>
                </Row>

                <Row gutter={16}>
                  <Col span={8}>
                    <Form.Item label="字体字号">
                      <Select
                        value={fontSize}
                        onChange={setFontSize}
                        options={[
                          { value: 10, label: '10 px (极小)' },
                          { value: 11, label: '11 px (次要)' },
                          { value: 12, label: '12 px (常规正文)' },
                          { value: 13, label: '13 px' },
                          { value: 14, label: '14 px (强调)' },
                          { value: 16, label: '16 px (大字号)' },
                          { value: 18, label: '18 px (主标题)' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item label="文本加粗">
                      <Radio.Group value={bold ? 'bold' : 'normal'} onChange={(e) => setBold(e.target.value === 'bold')}>
                        <Radio.Button value="normal">常规</Radio.Button>
                        <Radio.Button value="bold">加粗</Radio.Button>
                      </Radio.Group>
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item label="文本自动换行">
                      <Switch
                        checked={wrapText}
                        onChange={setWrapText}
                        checkedChildren="自动换行"
                        unCheckedChildren="单行截断"
                      />
                    </Form.Item>
                  </Col>
                </Row>

                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="文本字体颜色">
                      <Space wrap size={6} style={{ marginBottom: 6 }}>
                        {[
                          { c: '', label: '默认' },
                          { c: '#262626', label: '深黑' },
                          { c: '#1677ff', label: '企业蓝' },
                          { c: '#389e0d', label: '质检绿' },
                          { c: '#d46b08', label: '告警橙' },
                          { c: '#cf1322', label: '危险红' },
                        ].map((item) => (
                          <Tag
                            key={item.label}
                            color={item.c || 'default'}
                            style={{
                              cursor: 'pointer',
                              border: color === item.c ? '2px solid #000' : undefined,
                            }}
                            onClick={() => setColor(item.c)}
                          >
                            {item.label}
                          </Tag>
                        ))}
                      </Space>
                      <Input
                        placeholder="自定义十六进制色值，如 #1677ff"
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                        allowClear
                      />
                    </Form.Item>
                  </Col>

                  <Col span={12}>
                    <Form.Item label="单元格背景填充色">
                      <Space wrap size={6} style={{ marginBottom: 6 }}>
                        {[
                          { c: '', label: '无底色' },
                          { c: '#e6f7ff', label: '浅蓝' },
                          { c: '#f6ffed', label: '浅绿' },
                          { c: '#fff7e6', label: '浅橙' },
                          { c: '#fff1f0', label: '浅红' },
                          { c: '#fafafa', label: '浅灰' },
                        ].map((item) => (
                          <Tag
                            key={item.label}
                            style={{
                              backgroundColor: item.c || '#fff',
                              color: '#000',
                              cursor: 'pointer',
                              border: bgColor === item.c ? '2px solid #1677ff' : '1px solid #d9d9d9',
                            }}
                            onClick={() => setBgColor(item.c)}
                          >
                            {item.label}
                          </Tag>
                        ))}
                      </Space>
                      <Input
                        placeholder="自定义背景色值，如 #f0f5ff"
                        value={bgColor}
                        onChange={(e) => setBgColor(e.target.value)}
                        allowClear
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </Form>
            ),
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
            key: 'alert_parent',
            label: '条件告警与父格',
            children: (
              <Form layout="vertical" size="small" style={{ marginTop: 8 }}>
                <Typography.Title level={5} style={{ margin: '0 0 8px 0', fontSize: 13 }}>
                  动态阈值高亮与警示 (条件格式)
                </Typography.Title>
                <Row gutter={16} align="middle" style={{ marginBottom: 8 }}>
                  <Col span={6}>
                    <Switch
                      checked={enableAlert}
                      onChange={setEnableAlert}
                      checkedChildren="已开启"
                      unCheckedChildren="已关闭"
                    />
                  </Col>
                  <Col span={18}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {enableAlert ? '当展开后数据满足设定的阈值条件时，自动赋予高亮告警样式' : '未开启阈值告警'}
                    </Text>
                  </Col>
                </Row>

                {enableAlert && (
                  <div style={{ backgroundColor: '#f9f9f9', padding: '10px 12px', borderRadius: 6, marginBottom: 16 }}>
                    <Row gutter={12}>
                      <Col span={8}>
                        <Form.Item label="比较条件" style={{ marginBottom: 8 }}>
                          <Select
                            value={alertOperator}
                            onChange={setAlertOperator}
                            options={[
                              { value: 'lt', label: '< 小于' },
                              { value: 'lte', label: '<= 小于等于' },
                              { value: 'gt', label: '> 大于' },
                              { value: 'gte', label: '>= 大于等于' },
                              { value: 'eq', label: '= 等于' },
                              { value: 'between', label: '介于区间' },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item label={alertOperator === 'between' ? '阈值下限' : '阈值数值'} style={{ marginBottom: 8 }}>
                          <InputNumber
                            style={{ width: '100%' }}
                            value={alertVal1}
                            onChange={(val) => setAlertVal1(val ?? 0)}
                          />
                        </Form.Item>
                      </Col>
                      {alertOperator === 'between' && (
                        <Col span={8}>
                          <Form.Item label="阈值上限" style={{ marginBottom: 8 }}>
                            <InputNumber
                              style={{ width: '100%' }}
                              value={alertVal2}
                              onChange={(val) => setAlertVal2(val ?? 0)}
                            />
                          </Form.Item>
                        </Col>
                      )}
                    </Row>
                    <Form.Item label="高亮告警方案" style={{ marginBottom: 0 }}>
                      <Radio.Group
                        value={alertStyleScheme}
                        onChange={(e) => setAlertStyleScheme(e.target.value)}
                      >
                        <Radio value="red">
                          <Tag color="red" style={{ margin: 0 }}>红字浅红底 (严重警示)</Tag>
                        </Radio>
                        <Radio value="orange">
                          <Tag color="orange" style={{ margin: 0 }}>深橙字浅黄底 (关注预警)</Tag>
                        </Radio>
                        <Radio value="green">
                          <Tag color="green" style={{ margin: 0 }}>绿字浅绿底 (达标优良)</Tag>
                        </Radio>
                      </Radio.Group>
                    </Form.Item>
                  </div>
                )}

                <Divider style={{ margin: '8px 0 12px 0' }} />

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
        ]}
      />
    </Modal>
  );
};
