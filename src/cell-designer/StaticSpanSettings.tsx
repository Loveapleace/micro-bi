import React from 'react';
import { Button, Form, InputNumber, Select, Space, Switch, Typography } from 'antd';
import type { CellDefinition, CellTemplateDocumentV1, StaticSpanConfig } from '../report-template/types.js';

export interface StaticSpanSettingsProps {
  cell: CellDefinition;
  document: CellTemplateDocumentV1;
  value: StaticSpanConfig;
  onChange: (value: StaticSpanConfig) => void;
}

/** 任意静态格均使用同一个设置入口，无标题行或固定行号分支。 */
export function StaticSpanSettings({ cell, document, value, onChange }: StaticSpanSettingsProps) {
  const regions = document.regions.filter((r) => r.sheetId === cell.sheetId);
  const parents = (axis: 'row' | 'column') => document.cells.filter((c) => c.sheetId === cell.sheetId && c.regionId === value.regionId &&
    c.content.kind === 'field' && c.content.role === `${axis}-dimension`).map((c) => ({ value: c.id,
      label: `${(c.content as any).displayName || (c.content as any).fieldKey}${(c.content as any).timeBucket ? ` · ${(c.content as any).timeBucket.granularity}` : ''}` }));
  const update = (changes: Partial<StaticSpanConfig>) => onChange({ ...value, ...changes });
  return <Form layout="vertical" size="small" style={{ marginTop: 8 }}>
    <Form.Item label="范围跟随"><Select aria-label="范围跟随" value={value.enabled ? value.scope : 'fixed'} onChange={(scope) => {
      update({ enabled: scope !== 'fixed', scope: scope === 'fixed' ? value.scope : scope as StaticSpanConfig['scope'],
        ...(scope === 'column-group' ? { repeat: value.repeat === 'once' ? 'column-groups' : value.repeat,
          columnParentId: value.columnParentId || parents('column')[0]?.value, includeTotals: false } : {}) });
    }} options={[{ value: 'fixed', label: '固定范围（普通单元格或手工合并）' }, { value: 'report', label: '目标报表全宽' },
      { value: 'columns', label: '仅动态列区域' }, { value: 'column-group', label: '所属列分组宽度' }]} /></Form.Item>
    <Form.Item label="目标动态区域"><Select aria-label="目标动态区域" disabled={!value.enabled} value={value.regionId}
      onChange={(regionId) => update({ regionId, rowParentId: undefined, columnParentId: undefined })}
      options={regions.map((r, i) => ({ value: r.id, label: `区域 ${i + 1} · R${r.anchor.row + 1}C${r.anchor.column + 1}` }))} /></Form.Item>
    <Form.Item label="出现上下文"><Select aria-label="出现上下文" disabled={!value.enabled} value={value.repeat} onChange={(repeat) => update({ repeat,
      ...(repeat === 'row-groups' ? { rowParentId: value.rowParentId || parents('row')[0]?.value } : {}),
      ...(repeat === 'column-groups' ? { scope: 'column-group', includeTotals: false, columnParentId: value.columnParentId || parents('column')[0]?.value } : {}),
      ...(repeat === 'once' && (value.placement === 'before-group' || value.placement === 'after-group') ? { placement: 'template' } : {}) })}
      options={[{ value: 'once', label: '整个目标区域一次', disabled: value.scope === 'column-group' }, { value: 'row-groups', label: '每个行分组一次' },
        { value: 'column-groups', label: '每个列分组一次' }]} /></Form.Item>
    {value.repeat === 'row-groups' && <Form.Item label="行父分组"><Select aria-label="行父分组" disabled={!value.enabled} value={value.rowParentId}
      onChange={(rowParentId) => update({ rowParentId })} options={parents('row')} /></Form.Item>}
    {(value.scope === 'column-group' || value.repeat === 'column-groups') && <Form.Item label="列父分组"><Select aria-label="列父分组" disabled={!value.enabled}
      value={value.columnParentId} onChange={(columnParentId) => update({ columnParentId })} options={parents('column')} /></Form.Item>}
    <Form.Item label="位置锚定"><Select aria-label="位置锚定" disabled={!value.enabled} value={value.placement} onChange={(placement) => update({ placement })}
      options={[{ value: 'template', label: '模板位置 / 组内偏移' }, { value: 'before-region', label: '目标区域前' }, { value: 'after-region', label: '目标区域后' },
        { value: 'before-group', label: '所属分组前', disabled: value.repeat === 'once' }, { value: 'after-group', label: '所属分组后', disabled: value.repeat === 'once' }]} /></Form.Item>
    <Space size={24} align="start">
      <Form.Item label="行偏移"><InputNumber aria-label="行偏移" min={0} max={100000} disabled={!value.enabled} value={value.rowOffset} onChange={(v) => update({ rowOffset: v || 0 })} /></Form.Item>
      <Form.Item label="静态区域高度（行）"><InputNumber aria-label="静态区域高度" min={1} max={1000} value={value.height} disabled={!value.enabled}
        onChange={(v) => update({ height: v || 1 })} /></Form.Item>
    </Space>
    <Space size={24} align="start">
      <Form.Item label="包含末尾总计"><Switch aria-label="包含末尾总计" checked={value.includeTotals} disabled={!value.enabled || value.scope === 'column-group'} onChange={(includeTotals) => update({ includeTotals })} /></Form.Item>
      <Form.Item label="合并显示"><Switch aria-label="合并显示" checked={value.merge} disabled={!value.enabled} onChange={(merge) => update({ merge })} /></Form.Item>
    </Space>
    <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
      宽度按目标区域实际展开的列计算，未单独设置对齐时默认居中；外观使用画布顶部的 Excel 工具栏调整。关闭合并显示仍保留范围与定位。分组说明会预留行，其他非空静态内容冲突时阻止发布。
      {value.scope === 'column-group' && value.repeat === 'row-groups' ? '当前配置会在每个行父组与列父组的交叉范围各显示一次。' : ''}
    </Typography.Paragraph>
    {value.suppressions.length > 0 && <Space><Typography.Text type="secondary">已保留 {value.suppressions.length} 条局部取消</Typography.Text>
      <Button size="small" onClick={() => update({ merge: true, suppressions: [] })}>恢复全部范围合并</Button></Space>}
  </Form>;
}
