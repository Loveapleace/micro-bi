import React, { useId, useState } from 'react';
import { Button, Checkbox, Col, ColorPicker, Form, Input, InputNumber, Radio, Row, Select, Space, Typography, theme } from 'antd';
import type { CellDefinition, CellTemplateDocumentV1, VisualStyleAction } from '../report-template/types.js';
import { normalizeRuleColor } from '../report-template/presentationRules.js';
const recentKey = 'micro-bi:editor:recent-colors';
export function readRecentColors(): string[] { try {
    return JSON.parse(localStorage.getItem(recentKey) || '[]').filter((x: unknown) => typeof x === 'string' && normalizeRuleColor(x)).slice(0, 12);
}
catch {
    return [];
} }
export function rememberRuleColors(colors: (string | undefined)[]) {
    try {
        const list = [...colors, ...readRecentColors()].map(c => c && normalizeRuleColor(c)).filter((c): c is string => !!c);
        localStorage.setItem(recentKey, JSON.stringify([...new Set(list)].slice(0, 12)));
    }
    catch { /* 编辑器偏好不可阻断报表保存。 */ }
}
const presets = ['#CF1322', '#D46B08', '#389E0D', '#1677FF', '#722ED1', '#262626', '#FFFFFF', '#FFF1F0', '#FFFBE6', '#F6FFED', '#E6F7FF'];
export function RuleColorField({ label, value, onChange }: {
    label: string;
    value?: string | undefined;
    onChange: (color: string | undefined) => void;
}) {
    const [format,setFormat]=useState<'hex'|'rgb'|'hsb'>('hex');
    const normalized = value ? normalizeRuleColor(value) : undefined;
    return <Space wrap>
    <ColorPicker aria-label={`${label}调色盘`} value={normalized || '#1677FF'} disabledAlpha mode="single" format={format} onFormatChange={v=>setFormat(v||'hex')} showText presets={[{ label: '预设颜色', colors: presets, defaultOpen: true }, { label: '最近使用', colors: readRecentColors(), defaultOpen: true }]} onChange={(color) => onChange(color.toHexString().toUpperCase())} onClear={() => onChange(undefined)} allowClear/>
    <Input aria-label={`${label}色值`} placeholder="HEX / rgb(22,119,255)" value={value || ''} status={value && !normalized ? 'error' : ''} onChange={e => onChange(e.target.value || undefined)} onBlur={() => { if (normalized)
        onChange(normalized); }} style={{ width: 190 }}/>
    <Button size="small" onClick={() => onChange(undefined)}>不覆盖{label}</Button>
  </Space>;
}
export function StyleEffectEditor({ value, onChange, cell, document }: {
    value: VisualStyleAction;
    onChange: (value: VisualStyleAction) => void;
    cell: CellDefinition;
    document: CellTemplateDocumentV1;
}) {
    const controlId = useId();
    const { token } = theme.useToken();
    const update = (v: Partial<VisualStyleAction>) => onChange({ ...value, ...v, ...(v.style&&!('presetId' in v)?{presetId:undefined}:{}) });
    const style = (v: Partial<VisualStyleAction['style']>) => update({ style: { ...value.style, ...v } });
    const reset = (p: 'color' | 'backgroundColor', checked: boolean) => update({ reset: checked ? [...new Set([...(value.reset || []), p])] : (value.reset || []).filter(x => x !== p) });
    const base = cell.style || {};
    const horizontal = value.style.textAlign === 'general' ? 'left' : value.style.textAlign ?? (base.textAlign === 'general' ? 'left' : base.textAlign) ?? 'left';
    const vertical = value.style.verticalAlign ?? base.verticalAlign ?? 'middle';
    const italic = value.style.italic ?? base.italic ?? false;
    const wrapText = value.style.wrapText ?? base.wrapText ?? false;
    const previewStyle: React.CSSProperties = {
      color: value.reset?.includes('color') ? base.color || token.colorText : value.style.color ?? base.color ?? token.colorText,
      backgroundColor: value.noFill ? token.colorBgContainer : value.reset?.includes('backgroundColor') ? base.backgroundColor || token.colorBgContainer : value.style.backgroundColor ?? base.backgroundColor ?? token.colorBgContainer,
      fontFamily: value.style.fontFamily ?? base.fontFamily,
      fontSize: value.style.fontSize ?? base.fontSize ?? 14,
      fontWeight: (value.style.bold ?? base.bold) ? 'bold' : 'normal',
      fontStyle: italic ? 'italic' : 'normal',
      display: 'flex', alignItems: {top:'flex-start',middle:'center',bottom:'flex-end'}[vertical],
      height: 112, padding: 12, boxSizing: 'border-box', border: '1px solid '+token.colorBorder, borderRadius: 6, overflow: 'hidden',
    };
    const previewText: React.CSSProperties = {width:'100%',minWidth:0,textAlign:horizontal,whiteSpace:wrapText?'normal':'nowrap',overflow:'hidden',textOverflow:'ellipsis',overflowWrap:'anywhere'};
    return <Space direction="vertical" size={10} style={{ width: '100%' }}>
    <Space wrap><Typography.Text strong>样式作用范围</Typography.Text><Radio.Group aria-label="样式作用范围" value={value.scope} onChange={e => update({ scope: e.target.value })}>
      <Radio.Button value="cell">仅单元格</Radio.Button><Radio.Button value="row">整行</Radio.Button></Radio.Group></Space>
    {value.scope === 'row' && <Typography.Text type="secondary">覆盖目标报表的实际列（含已开启的行总计），随动态列变化；文本仅替换命中格。跨行合并格未整体命中时保留原样式。</Typography.Text>}
    {value.scope==='row'&&!cell.regionId&&document.regions.filter(r=>r.sheetId===cell.sheetId).length>1&&<Space><Typography.Text>整行所属区域</Typography.Text><Select aria-label="整行所属区域" style={{width:180}} value={value.regionId} options={document.regions.filter(r=>r.sheetId===cell.sheetId).map((r,i)=>({value:r.id,label:`区域${i+1}`}))} onChange={regionId=>update({regionId})}/></Space>}
    {value.scope === 'row' && !document.regions.some(r => r.sheetId === cell.sheetId) && <Space><Typography.Text>静态列范围（1起）</Typography.Text>
      <InputNumber<number> aria-label="整行起始列" min={1} value={value.rowColumns ? value.rowColumns[0] + 1 : null} onChange={v => update({ rowColumns: [Math.max(0, (v || 1) - 1), value.rowColumns?.[1] ?? cell.position.column] })}/>
      <InputNumber<number> aria-label="整行结束列" min={1} value={value.rowColumns ? value.rowColumns[1] + 1 : null} onChange={v => update({ rowColumns: [value.rowColumns?.[0] ?? 0, Math.max(0, (v || 1) - 1)] })}/></Space>}
    <Space wrap><Typography.Text>快捷样式</Typography.Text>{[
            ['红色', '#CF1322', '#FFF1F0'], ['橙色', '#D46B08', '#FFFBE6'], ['绿色', '#389E0D', '#F6FFED']
        ].map(([name, color, backgroundColor],i) => <Button key={name} type={value.presetId===['red','orange','green'][i]?'primary':'default'} size="small" onClick={() => update({ presetId:['red','orange','green'][i] as 'red'|'orange'|'green', style: { ...value.style, color, backgroundColor, bold: true }, noFill: false, reset: [] })}>{name}</Button>)}</Space>
    <Space direction="vertical"><Typography.Text>文字颜色</Typography.Text><RuleColorField label="文字" value={value.style.color} onChange={color => style({ color })}/></Space>
    <Space direction="vertical"><Typography.Text>背景颜色</Typography.Text><RuleColorField label="背景" value={value.style.backgroundColor} onChange={backgroundColor => update({ style: { ...value.style, backgroundColor }, noFill: false })}/></Space>
    <Space wrap><Checkbox checked={!!value.noFill} onChange={e => update({ noFill: e.target.checked })}>无填充</Checkbox>
      <Checkbox checked={!!value.reset?.includes('color')} onChange={e => reset('color', e.target.checked)}>恢复基础字体色</Checkbox>
      <Checkbox checked={!!value.reset?.includes('backgroundColor')} onChange={e => reset('backgroundColor', e.target.checked)}>恢复基础背景</Checkbox></Space>
    <Space wrap><Typography.Text>字重</Typography.Text><Select aria-label="样式字重" value={value.style.bold === undefined ? 'inherit' : String(value.style.bold)} style={{ width: 100 }} options={[{ value: 'inherit', label: '继承' }, { value: 'true', label: '加粗' }, { value: 'false', label: '常规' }]} onChange={v => style({ bold: v === 'inherit' ? undefined : v === 'true' })}/>
      <Typography.Text>字号</Typography.Text><InputNumber<number> aria-label="样式字号" min={6} max={96} placeholder="继承" value={value.style.fontSize ?? null} onChange={v => style({ fontSize: v ?? undefined })}/></Space>
    <Typography.Text type="secondary">跟随原样式：不新增覆盖，保留单元格已有设置。</Typography.Text>
    <fieldset style={{border:'1px solid '+token.colorBorderSecondary,borderRadius:6,padding:'8px 12px 0',minWidth:0}}>
      <legend style={{width:'auto',padding:'0 6px',marginBottom:4,fontSize:14,fontWeight:600}}>对齐方式</legend>
      <Row gutter={16}>
        <Col xs={24} sm={12}><Form.Item layout="vertical" label="水平对齐" htmlFor={controlId+'-horizontal'} extra="控制文字在单元格内靠左、居中或靠右。" style={{marginBottom:12}}>
          <Select id={controlId+'-horizontal'} aria-label="样式水平对齐" value={value.style.textAlign||'inherit'} style={{width:'100%'}} options={[{value:'inherit',label:'跟随原样式'},{value:'general',label:'常规（文本左，数值右）'},{value:'left',label:'左对齐'},{value:'center',label:'水平居中'},{value:'right',label:'右对齐'}]} onChange={v=>style({textAlign:v==='inherit'?undefined:v as any})}/>
        </Form.Item></Col>
        <Col xs={24} sm={12}><Form.Item layout="vertical" label="垂直对齐" htmlFor={controlId+'-vertical'} extra="控制文字在单元格内靠上、居中或靠下。" style={{marginBottom:12}}>
          <Select id={controlId+'-vertical'} aria-label="样式垂直对齐" value={value.style.verticalAlign||'inherit'} style={{width:'100%'}} options={[{value:'inherit',label:'跟随原样式'},{value:'top',label:'顶端对齐'},{value:'middle',label:'垂直居中'},{value:'bottom',label:'底端对齐'}]} onChange={v=>style({verticalAlign:v==='inherit'?undefined:v as any})}/>
        </Form.Item></Col>
      </Row>
    </fieldset>
    <fieldset style={{border:'1px solid '+token.colorBorderSecondary,borderRadius:6,padding:'8px 12px 0',minWidth:0}}>
      <legend style={{width:'auto',padding:'0 6px',marginBottom:4,fontSize:14,fontWeight:600}}>文字显示</legend>
      <Row gutter={16}>
        <Col xs={24} sm={12}><Form.Item layout="vertical" label="字体倾斜" extra="只改变文字外观，不影响内容和数值。" style={{marginBottom:12}}>
          <Radio.Group aria-label="样式斜体" value={value.style.italic===undefined?'inherit':String(value.style.italic)} size="small" onChange={e=>style({italic:e.target.value==='inherit'?undefined:e.target.value==='true'})}>
            <Radio.Button value="inherit">跟随原样式</Radio.Button><Radio.Button value="true">斜体</Radio.Button><Radio.Button value="false">不倾斜</Radio.Button>
          </Radio.Group>
        </Form.Item></Col>
        <Col xs={24} sm={12}><Form.Item layout="vertical" label="换行方式" extra="自动换行可能增加行高；不自动换行时，超宽文字可能被截断。" style={{marginBottom:12}}>
          <Radio.Group aria-label="样式换行" value={value.style.wrapText===undefined?'inherit':String(value.style.wrapText)} size="small" onChange={e=>style({wrapText:e.target.value==='inherit'?undefined:e.target.value==='true'})}>
            <Radio.Button value="inherit">跟随原样式</Radio.Button><Radio.Button value="true">自动换行</Radio.Button><Radio.Button value="false">不自动换行</Radio.Button>
          </Radio.Group>
        </Form.Item></Col>
      </Row>
    </fieldset>
    <div><Typography.Text strong>效果示意</Typography.Text>
      <Typography.Paragraph type="secondary" style={{margin:'4px 0 8px'}}>在固定高度的示例格中预览，实际表格按列宽和行高显示；对齐不会移动行列或改变原值。</Typography.Paragraph>
      <Row gutter={[12,12]}>
        <Col xs={24} sm={12}><div role="group" aria-label="长文本样式预览" style={previewStyle}><div style={previewText}>示例内容 123.45，这是一段用于观察文字对齐、倾斜和自动换行效果的较长说明。</div></div></Col>
        <Col xs={24} sm={12}><div role="group" aria-label="数值样式预览" style={previewStyle}><div style={previewText}>12,345.67</div></div></Col>
      </Row>
    </div>
  </Space>;
}
