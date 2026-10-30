import React, { useEffect, useState } from 'react';
import { Alert, Descriptions, Form, Input, Modal, Select, Space, Switch, Tabs, Tag, Typography } from 'antd';
import type { AdvancedCellUpdate, CellDefinition, CellFormatOptions, CellTemplateDocumentV1 } from '../report-template/types.js';
import type { BiGridModel } from '../report/types.js';
import { canOpenCellAdvancedSettings, getCellCapabilities, type CapabilityField } from '../report-template/cellCapabilities.js';
import { buildAdvancedCellUpdate, createAdvancedCellDraft, type AdvancedCellDraft } from './advancedCellState.js';
import { PresentationRuleEditor } from './PresentationRuleEditor.js';
import { rememberRuleColors } from './StyleEffectEditor.js';
import { StaticSpanSettings } from './StaticSpanSettings.js';

export interface CellAdvancedSettingsProps {
  structureReadOnly?: boolean | undefined;
  contentReadOnly?: boolean | undefined;
  open: boolean;
  cell: CellDefinition | null;
  document: CellTemplateDocumentV1;
  onSave: (updated: AdvancedCellUpdate) => void;
  previewGrid?: BiGridModel | undefined;
  fields?: CapabilityField[] | undefined;
  onCancel: () => void;
}
const operationNames: Record<string,string> = { sum:'求和 SUM',avg:'平均 AVG',count:'计数 COUNT',min:'最小 MIN',max:'最大 MAX',list:'逐条明细',group:'分类分组' };
const bucketNames:Record<string,string>={year:'年',quarter:'季度',month:'月',week:'周',day:'日',hour:'小时',minute:'分钟'};

export const CellAdvancedSettings: React.FC<CellAdvancedSettingsProps> = ({
  open, cell, document, onSave, onCancel, previewGrid, fields, contentReadOnly=false,
}) => {
  const [draft,setDraft] = useState<AdvancedCellDraft | null>(null);
  const [error,setError] = useState('');
  const [tab,setTab] = useState('settings');
  useEffect(()=>{
    if(open&&cell){setDraft(createAdvancedCellDraft(document,cell));setError('');setTab('settings');}
  },[open,cell]);
  if(!canOpenCellAdvancedSettings(cell)||!draft)return null;
  const context={fields,grid:previewGrid,contentReadOnly};
  const cap=getCellCapabilities(cell,context);
  if(!cap.tabs.length)return null;
  const content=cell.content;
  const isStatic=cap.role==='static';
  const permits=(key:keyof CellFormatOptions)=>cap.advancedFormatKeys.includes(key);
  const changeFormat=<K extends keyof CellFormatOptions>(key:K,value:CellFormatOptions[K])=>setDraft(prev=>prev?{
    ...prev,format:{...prev.format,[key]:value},dirtyFormat:[...new Set([...prev.dirtyFormat,key])],
  }:prev);
  const change=<K extends keyof AdvancedCellDraft['dirty']>(key:K,value:AdvancedCellDraft[K])=>setDraft(prev=>prev?{
    ...prev,[key]:value,dirty:{...prev.dirty,[key]:true},
  }:prev);
  const apply=()=>{
    try{
      const update=buildAdvancedCellUpdate(document,cell,draft,context);
      if(update.visualStyleRules)rememberRuleColors([draft.style.style.color,draft.style.style.backgroundColor]);
      onSave(update);
    }catch(e){setError((e as Error).message);}
  };
  const mergeOptions=cap.mergePolicies.map(value=>({value,label:value==='default'?'跟随报表合并设置':value==='none'?'不自动合并':value==='group-span'?
    content.kind==='field'&&content.role==='column-dimension'?'横向覆盖所属列分组':'纵向覆盖所属行分组':'相邻同值合并（遵循字段和分组边界）'}));
  if(draft.mergePolicy&&!mergeOptions.some(o=>o.value===draft.mergePolicy))mergeOptions.push({value:draft.mergePolicy,label:'当前合并设置'} as any);
  const name=content.kind==='field'?content.displayName||content.fieldKey:content.kind==='literal'?
    isStatic?'静态文本 / 固定值':'面板生成文字':content.displayName||'公式';
  const settings=<Form layout="vertical" size="small" style={{paddingTop:8}}>
    {cap.canDrill&&<>
      <Form.Item label="明细下钻"><Switch aria-label="双击查看明细" checked={draft.drill.enabled} onChange={enabled=>change('drill',{...draft.drill,enabled})}/><Typography.Text type="secondary" style={{marginLeft:10}}>预览或展示时双击，打开只读明细工作表</Typography.Text></Form.Item>
      {draft.drill.enabled&&<>
        <Form.Item label="明细字段"><Select mode="multiple" aria-label="明细字段" placeholder="全部字段" value={draft.drill.columns} options={(fields||[]).map(f=>({value:f.key,label:f.label||f.key}))} onChange={columns=>change('drill',{...draft.drill,columns})}/></Form.Item>
        <Form.Item label="每页条数"><Select aria-label="明细每页条数" value={draft.drill.pageSize} options={[20,50,100].map(value=>({value,label:String(value)}))} onChange={pageSize=>change('drill',{...draft.drill,pageSize})}/></Form.Item>
      </>}
    </>}
    {cap.canEditAggregation&&<Form.Item label="计算口径（与左侧指标同步）" extra="改变统计计算；同一指标的派生总计同步更新。"><Select aria-label="指标聚合口径" value={draft.operation}
      options={[...new Set([...cap.aggregations,...(draft.operation?[draft.operation]:[])])].map(value=>({value,label:operationNames[value]||value,disabled:!cap.aggregations.includes(value as any)}))}
      onChange={v=>change('operation',v)}/></Form.Item>}
    {cap.role==='total'&&<Typography.Paragraph type="secondary">汇总口径继承对应指标，在原指标或左侧面板修改，不单独设置另一套聚合。</Typography.Paragraph>}
    {cap.role==='formula'&&<Typography.Paragraph type="secondary">此处只设置公式结果的业务显示；工作表公式通过画布 F2 编辑。</Typography.Paragraph>}
    {['dimension','time-dimension'].includes(cap.role)&&<Descriptions size="small" column={1} style={{marginBottom:16}} items={[
      {key:'axis',label:'维度方向',children:content.kind==='field'&&content.role==='column-dimension'?'列维度 · 横向展开':'行维度 · 纵向展开'},
      ...(content.kind==='field'&&content.timeBucket?[{key:'bucket',label:'时间分组',children:bucketNames[content.timeBucket.granularity]||content.timeBucket.granularity}]:[]),
      {key:'source',label:'字段与层级',children:'在左侧维度面板维护；此处的显示规则不改变分组身份和排序依据。'},
    ]}/>}
    {permits('scale')&&<Form.Item label="业务显示缩放" extra="仅对显示数值除以该倍率，不改变原数值、聚合及公式输入。与工具栏的小数、百分比等格式组合生效。"><Select aria-label="业务显示缩放" value={draft.format.scale??1}
      options={[{value:1,label:'原始数值（÷1）'},{value:1000,label:'千（÷1000）'},{value:10000,label:'万（÷10000）'},{value:1000000,label:'百万（÷1000000）'},
        ...(![1,1000,10000,1000000].includes(draft.format.scale??1)?[{value:draft.format.scale!,label:`当前倍率（÷${draft.format.scale}）`}]:[])]} onChange={v=>changeFormat('scale',v)}/></Form.Item>}
    {permits('emptyDisplay')&&<Form.Item label="空值显示文字" extra="只替换 null、undefined 或空字符串的显示；数字 0、布尔 false 和原始数据保持不变。留空表示保持空白。"><Input aria-label="空值显示文字" placeholder="保持空白，例如可填写 —、无、N/A" value={draft.format.emptyDisplay??''} allowClear onChange={e=>changeFormat('emptyDisplay',e.target.value||undefined)}/></Form.Item>}
    {cap.valueType==='text'&&<Typography.Paragraph type="secondary">文本编号及前导零保持原值；按数据替换文案请使用“条件规则”。</Typography.Paragraph>}
    {cap.valueType==='unknown'&&<Typography.Paragraph type="secondary">当前没有可识别的结果值，已有显示配置保持；数据就绪后按实际类型提供业务设置。</Typography.Paragraph>}
  </Form>;
  const sections:Record<string,React.ReactNode>={
    settings,
    content:<Form layout="vertical" size="small" style={{paddingTop:8}}><Form.Item label="静态文本 / 固定值" extra="支持换行；以 = 开头的内容在此仍保存为文本，公式通过画布 F2 输入。"><Input.TextArea aria-label="静态内容文字" rows={3} value={draft.text} onChange={e=>change('text',e.target.value)}/></Form.Item></Form>,
    rules:cap.canEditConditions?<PresentationRuleEditor cell={cell} document={document} fields={fields} previewGrid={previewGrid} value={draft.rules} onChange={v=>change('rules',v)}/>:null,
    merge:<>
      {cap.mergePolicies.length>0&&<Form layout="vertical" size="small"><Form.Item label="动态合并"><Select aria-label="动态合并" value={draft.mergePolicy}
        options={mergeOptions.map(o=>({...o,disabled:!cap.mergePolicies.includes(o.value)}))} onChange={v=>change('mergePolicy',v)}/></Form.Item>
        <Typography.Paragraph type="secondary">动态规则按字段与分组身份应用到展开结果；不同于工具栏对选区的一次手工合并。取消合并和成员例外保留，数值及公式不会被合并操作清空。</Typography.Paragraph></Form>}
      {cap.canFollowRange&&<><Typography.Paragraph type="secondary">按数据展开后的报表或分组宽度跟随；普通固定选区的合并与取消合并使用 Excel 工具栏。</Typography.Paragraph><StaticSpanSettings cell={cell} document={document} value={draft.staticSpan} onChange={v=>change('staticSpan',v)}/></>}
    </>,
  };
  return <Modal open={open} title={<Space wrap><Typography.Text strong>单元格高级配置</Typography.Text><Tag color="blue">{cap.label}</Tag>
    <Tag>R{cell.position.row+1}C{cell.position.column+1}</Tag><Typography.Text type="secondary">{name}</Typography.Text></Space>}
    width={920} styles={{body:{maxHeight:'72vh',overflowY:'auto'}}} onOk={apply} onCancel={onCancel} okText="应用配置" cancelText="取消" destroyOnHidden>
    {error&&<Alert type="error" showIcon message={error} style={{marginBottom:12}}/>}
    <Typography.Paragraph type="secondary" style={{marginBottom:12}}>
      {isStatic?'在这里编辑静态内容及动态范围跟随。':'按当前角色配置业务属性；字段、分组粒度和展开结构由左侧面板维护。'}
      普通单元格的字体、颜色、对齐、边框和数字 / 日期格式使用画布顶部的 Excel 工具栏。
    </Typography.Paragraph>
    <Tabs activeKey={cap.tabs.some(t=>t.key===tab)?tab:cap.tabs[0]?.key||'settings'} onChange={setTab} items={cap.tabs.map(item=>({...item,children:sections[item.key]}))}/>
  </Modal>;
};
