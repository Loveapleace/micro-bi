import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Checkbox, DatePicker, Input, InputNumber, Select, Space, Switch, Table, Typography } from 'antd';
import dayjs from 'dayjs';
import type { BiGridModel } from '../report/types.js';
import type { CellDefinition, CellTemplateDocumentV1, PresentationRules, PresentationRule, RulePredicate, RuleOperand, ConditionOperator } from '../report-template/types.js';
import type { RuleValueType } from '../report-template/presentationTypes.js';
import { targetForCell } from '../report-template/presentationTypes.js';
import { applyPresentationRules, resolvePresentationTarget } from '../report-template/presentationRules.js';
import { conditionOperators, dateComparable, getCellCapabilities, getOperandValueType, metricAggregations, type CapabilityField } from '../report-template/cellCapabilities.js';
import { generateTemplateCellId } from '../report-template/identity.js';
import { StyleEffectEditor } from './StyleEffectEditor.js';

type Field = CapabilityField;
const opNames: Record<ConditionOperator,string> = {lt:'小于',lte:'小于等于',gt:'大于',gte:'大于等于',eq:'等于',ne:'不等于',between:'介于（含边界）',contains:'包含',startsWith:'开头为',endsWith:'结尾为',in:'属于集合',notIn:'不属于集合',empty:'为空',notEmpty:'不为空'};
const dateOpNames: Partial<Record<ConditionOperator,string>> = {lt:'早于',lte:'不晚于',gt:'晚于',gte:'不早于',between:'日期区间（含边界）'};
const literalFor=(type:RuleValueType,list=false):RuleOperand=>({kind:'literal',value:list?[]:type==='number'?90:type==='boolean'?true:'',...(list?{valueType:'list' as const}:type==='date'?{valueType:'date' as const}:{})});
function typedPredicate(cell:CellDefinition,fields:Field[],grid?:BiGridModel):RulePredicate{
  const type=getCellCapabilities(cell,{fields,grid}).valueType;
  return {kind:'comparison',left:{kind:'current'},valueType:type,operator:type==='number'?'lt':'eq',right:literalFor(type)};
}
interface PredicateContext {cell:CellDefinition;document:CellTemplateDocumentV1;fields:Field[];grid?:BiGridModel|undefined}
function OperandEditor({value,onChange,cell,fields,document,grid,left=false,expectedType,listRequired=false}:PredicateContext&{
  value:RuleOperand;onChange:(v:RuleOperand)=>void;left?:boolean|undefined;expectedType?:RuleValueType|undefined;listRequired?:boolean|undefined;
}){
  const isList=value.kind==='literal'&&(value.valueType==='list'||Array.isArray(value.value));
  const kind=value.kind==='current'?'current-'+(value.basis||'value'):value.kind==='literal'?isList?'list':value.valueType==='date'?'date':typeof value.value:value.kind;
  const currentType=getCellCapabilities(cell,{fields,grid}).valueType;
  const compatible=(type:RuleValueType)=>left||!expectedType||expectedType==='unknown'||type==='unknown'||type===expectedType;
  const usableFields=fields.filter(f=>compatible(getOperandValueType({kind:'field',field:f.key},cell,document,{fields,grid}))||expectedType==='number');
  const metrics=[...new Map(document.cells.filter(c=>(c.content as any).metricId&&compatible(getCellCapabilities(c,{fields,grid}).valueType)).map(c=>[(c.content as any).metricId,{value:(c.content as any).metricId,label:(c.content as any).displayName||c.id}])).values()];
  const kinds=[
    ...(compatible(currentType)?[{value:'current-value',label:'本格有效值'}]:[]),
    ...(currentType==='number'&&compatible('number')?[{value:'current-display-number',label:'本格显示尺度数值'}]:[]),
    ...(compatible('text')?[{value:'current-text',label:'基础格式化文本'}]:[]),
    ...(usableFields.length?[{value:'field',label:'同上下文字段'}]:[]),...(metrics.length?[{value:'metric',label:'同切片指标'}]:[]),
    ...(!left?[...(compatible('number')?[{value:'number',label:'数值'}]:[]),...(compatible('text')?[{value:'string',label:'文字'}]:[]),
      ...(compatible('date')?[{value:'date',label:'日期 / 时间'}]:[]),...(compatible('boolean')?[{value:'boolean',label:'布尔'}]:[])]:[]),
  ];
  if(listRequired)kinds.splice(0,kinds.length,{value:'list',label:'值列表'});
  if(!kinds.some(k=>k.value===kind))kinds.push({value:kind,label:'当前来源（请按比较类型调整）'});
  const choose=(k:string)=>{
    if(k.startsWith('current-'))onChange({kind:'current',basis:k.slice(8) as any});
    else if(k==='field'){const field=usableFields[0]?.key||'';onChange({kind:'field',field,...(!left&&expectedType==='number'&&getOperandValueType({kind:'field',field},cell,document,{fields,grid})!=='number'?{agg:'count' as const}:{})});}
    else if(k==='metric')onChange({kind:'metric',metricId:metrics[0]?.value||''});
    else onChange(literalFor(k==='string'?'text':k as RuleValueType,k==='list'));
  };
  const rawFieldType=value.kind==='field'?getOperandValueType({kind:'field',field:value.field},cell,document,{fields,grid}):'unknown';
  const aggregations=metricAggregations(rawFieldType);
  return <Space wrap size={4}>
    <Select aria-label={left?'条件左值来源':'条件右值来源'} value={kind} style={{width:165}} options={kinds} onChange={choose}/>
    {value.kind==='literal'&&(isList?<Input aria-label="条件值列表" style={{width:230}} placeholder="JSON值列表" value={Array.isArray(value.value)?JSON.stringify(value.value):String(value.value??'')} status={!Array.isArray(value.value)?'error':''}
      onChange={e=>{let next:any=e.target.value;try{next=JSON.parse(next);}catch{}onChange({...value,value:next,valueType:'list'});}}/>:
      kind==='date'?<DatePicker aria-label="条件日期" showTime format="YYYY-MM-DD HH:mm:ss" value={typeof value.value==='string'&&dateComparable(value.value)!==undefined?dayjs(value.value):null}
        onChange={d=>onChange({...value,value:d?d.format('YYYY-MM-DD HH:mm:ss'):'',valueType:'date'})}/>:
      typeof value.value==='number'?<InputNumber aria-label="条件数值" value={value.value} onChange={v=>onChange({...value,value:v??0})}/>:
      typeof value.value==='boolean'?<Switch aria-label="条件布尔值" checked={value.value} checkedChildren="是" unCheckedChildren="否" onChange={v=>onChange({...value,value:v})}/>:
      <Input aria-label="条件文字" value={String(value.value??'')} style={{width:180}} onChange={e=>onChange({...value,value:e.target.value})}/>)}
    {value.kind==='field'&&<><Select aria-label="引用字段" style={{width:180}} value={value.field} options={usableFields.map(f=>({value:f.key,label:f.label||f.key}))} onChange={field=>onChange({kind:'field',field,...(!left&&expectedType==='number'&&getOperandValueType({kind:'field',field},cell,document,{fields,grid})!=='number'?{agg:'count' as const}:{})})}/>
      <Select aria-label="字段聚合口径" style={{width:145}} value={value.agg||'record'} options={[...(compatible(rawFieldType)?[{value:'record',label:'明细同一记录'}]:[]),...(compatible('number')?aggregations.map(v=>({value:v,label:({sum:'求和',avg:'平均',count:'计数',min:'最小',max:'最大'} as Record<string,string>)[v]})):[])]}
        onChange={v=>onChange({...value,agg:v==='record'?undefined:v as any})}/></>}
    {value.kind==='metric'&&<Select aria-label="引用指标" style={{width:200}} value={value.metricId} options={metrics} onChange={metricId=>onChange({...value,metricId})}/>}
  </Space>;
}
function PredicateEditor({value,onChange,cell,fields,document,grid,depth=0}:PredicateContext&{value:RulePredicate;onChange:(v:RulePredicate)=>void;depth?:number|undefined}){
  const context={cell,fields,document,grid};
  if(value.kind==='group')return <div style={{borderLeft:'3px solid #91caff',paddingLeft:10}}>
    <Space><Select aria-label="条件组关系" value={value.mode} style={{width:160}} options={[{value:'and',label:'全部满足 AND'},{value:'or',label:'任意满足 OR'}]} onChange={mode=>onChange({...value,mode})}/>
      <Button size="small" onClick={()=>onChange({...value,children:[...value.children,typedPredicate(cell,fields,grid)]})}>添加条件</Button>
      <Button size="small" disabled={depth>=7} onClick={()=>onChange({...value,children:[...value.children,{kind:'group',mode:'or',children:[typedPredicate(cell,fields,grid)]}]})}>添加条件组</Button></Space>
    {value.children.map((p,i)=><div key={i} style={{paddingTop:10}}><Space align="start"><PredicateEditor {...context} value={p} depth={depth+1} onChange={v=>onChange({...value,children:value.children.map((c,j)=>j===i?v:c)})}/>
      <Button size="small" disabled={value.children.length===1} onClick={()=>onChange({...value,children:value.children.filter((_,j)=>j!==i)})}>删除条件</Button></Space></div>)}
  </div>;
  const inferred=getOperandValueType(value.left,cell,document,{fields,grid});
  const type=value.valueType&&value.valueType!=='unknown'?value.valueType:inferred;
  const ops=conditionOperators(type);
  const replaceLeft=(left:RuleOperand)=>{
    const nextType=getOperandValueType(left,cell,document,{fields,grid}),allowed=conditionOperators(nextType);
    const operator=allowed.includes(value.operator)?value.operator:nextType==='number'?'lt':'eq';
    const previousType=value.right?getOperandValueType(value.right,cell,document,{fields,grid}):'unknown';
    onChange({...value,left,valueType:nextType,operator,right:previousType===nextType?value.right:literalFor(nextType,['in','notIn'].includes(operator)),...(operator==='between'?{upper:literalFor(nextType)}:{upper:undefined})});
  };
  return <Space direction="vertical" size={5}>
    <Space wrap><OperandEditor {...context} value={value.left} left onChange={replaceLeft}/>
      <Select aria-label="比较操作" value={value.operator} style={{width:175}} options={[...new Set([...ops,value.operator])].map(operator=>({value:operator,label:type==='date'?dateOpNames[operator]||opNames[operator]:opNames[operator],disabled:!ops.includes(operator)}))}
        onChange={operator=>onChange({...value,valueType:inferred,operator,right:['in','notIn'].includes(operator)?literalFor(type,true):
          value.right&&value.right.kind!=='literal'?value.right:literalFor(type),...(operator==='between'?{upper:literalFor(type)}:{upper:undefined})})}/>
      {!['empty','notEmpty'].includes(value.operator)&&<OperandEditor {...context} value={value.right||literalFor(type)} expectedType={type} listRequired={['in','notIn'].includes(value.operator)} onChange={right=>onChange({...value,valueType:inferred,right})}/>}
    </Space>
    {value.operator==='between'&&<Space><Typography.Text>至</Typography.Text><OperandEditor {...context} value={value.upper||literalFor(type)} expectedType={type} onChange={upper=>onChange({...value,valueType:inferred,upper})}/></Space>}
    {!ops.includes(value.operator)&&<Typography.Text type="warning">该比较方式不适用于当前左值，请重新选择。</Typography.Text>}
    <Button size="small" disabled={depth>=7} onClick={()=>onChange({kind:'group',mode:'and',children:[value,typedPredicate(cell,fields,grid)]})}>组合 AND / OR</Button>
  </Space>;
}

export function PresentationRuleEditor({ value, onChange, cell, document, fields = [], previewGrid }: {
    value: PresentationRules;
    onChange: (v: PresentationRules) => void;
    cell: CellDefinition;
    document: CellTemplateDocumentV1;
    fields?: Field[] | undefined;
    previewGrid?: BiGridModel | undefined;
}) {
    const [setId] = useState(() => value.ruleSets.find(s => resolvePresentationTarget(s.target, document).some(c => c.id === cell.id))?.id || generateTemplateCellId('rule-set'));
    const existing = value.ruleSets.find(s => s.id === setId);
    const set = existing || { id: setId, order: Math.max(-1, ...value.ruleSets.map(s => s.order)) + 1, target: { ...targetForCell(cell), regionId: cell.regionId || (document.regions.filter(r => r.sheetId === cell.sheetId).length === 1 ? document.regions.find(r => r.sheetId === cell.sheetId)?.id : undefined) }, rules: [] };
    const [active, setActive] = useState(existing?.rules[0]?.id);
    const save = (s: typeof set) => onChange({ ...value, ruleSets: existing ? value.ruleSets.map(x => x.id === set.id ? s : x) : [...value.ruleSets, s] });
    const update = (id: string, patch: Partial<PresentationRule>) => save({ ...set, rules: set.rules.map(r => r.id === id ? { ...r, ...patch } : r) });
    const reorder = (from: number, to: number) => { const list = [...set.rules]; const [item] = list.splice(from, 1); if (item)
        list.splice(to, 0, item); save({ ...set, rules: list.map((r, i) => ({ ...r, order: i })) }); };
    const [delayed, setDelayed] = useState(value);
    useEffect(() => { const t = setTimeout(() => setDelayed(value), 150); return () => clearTimeout(t); }, [value]);
    const evaluation = useMemo(() => previewGrid ? applyPresentationRules({ ...document, presentationRules: delayed }, previewGrid, [], { sheetId: cell.sheetId }) : undefined, [document, delayed, previewGrid, cell.sheetId]);
    const stats = evaluation?.grid.ruleStatistics?.filter(s => set.rules.some(r => r.id === s.ruleId)) || [];
    const availableFields = fields.length ? fields : [...new Map(document.cells.filter(c => c.content.kind === 'field').map(c => [(c.content as any).fieldKey, { key: (c.content as any).fieldKey, label: (c.content as any).displayName || (c.content as any).fieldKey }])).values()];
    const capabilities=getCellCapabilities(cell,{fields:availableFields,grid:previewGrid});
    const roleOptions=set.target.kind==='field'?[{label:'业务数据',value:'data'},{label:'总计/小计',value:'total'},{label:'维度',value:'dimension'}]:
      (targetForCell(cell).roles||[]).map(value=>({value,label:capabilities.role==='header'?'表头 / 指标标签':({data:'业务数据',total:'总计/小计',dimension:'维度',header:'表头',static:'静态内容'} as Record<string,string>)[value]||value}));
    return <Space direction="vertical" size={12} style={{ width: '100%' }}>
    <Typography.Text type="secondary">规则按顺序执行；所有条件读取原有效值/基础文本，文字替换不改变数值和公式。仅单元格/整行控制视觉范围。</Typography.Text>
    <Space wrap><Typography.Text>目标</Typography.Text><Select aria-label="规则目标范围" value={set.target.kind || 'source'} style={{ width: 200 }} options={[{ value: 'source', label: '当前字段/源格展开实例' }, ...(capabilities.canTargetField?[{ value: 'field', label: '同字段的选定角色' }]:[])]} onChange={kind => save({ ...set, target: { ...set.target, kind } })}/>
      <Typography.Text>区域</Typography.Text><Select aria-label="规则目标区域" allowClear style={{ width: 180 }} value={set.target.regionId} options={document.regions.filter(r => r.sheetId === cell.sheetId).map((r, i) => ({ value: r.id, label: `区域${i + 1}` }))} onChange={regionId => save({ ...set, target: { ...set.target, regionId } })}/></Space>
    <Space wrap><Typography.Text>全局执行序（大值后执行）</Typography.Text><InputNumber aria-label="规则集全局执行序" min={0} value={set.order} onChange={order=>save({...set,order:order??0})}/></Space>
    <Space wrap><Typography.Text>触发角色</Typography.Text><Checkbox.Group value={set.target.roles || []} options={roleOptions} onChange={roles => save({ ...set, target: { ...set.target, roles: roles as string[] } })}/></Space>
    <Button type="primary" aria-label="添加规则" onClick={() => { const id = generateTemplateCellId('rule'); save({ ...set, rules: [...set.rules, { id, name: `规则${set.rules.length + 1}`, enabled: true, order: set.rules.length, predicate: { kind: 'group', mode: 'and', children: [typedPredicate(cell,availableFields,previewGrid)] }, style: { scope: 'cell', style: { color: '#CF1322', backgroundColor: '#FFF1F0', bold: true } }, stopIfTrue: true }] }); setActive(id); }}>添加规则</Button>
    {set.rules.map((r, i) => <Card key={r.id} size="small" data-rule-id={r.id} title={<Space wrap><Switch aria-label={`启用${r.name}`} checked={r.enabled} onChange={enabled => update(r.id, { enabled })}/><Input aria-label="规则名称" value={r.name} style={{ width: 145 }} onChange={e => update(r.id, { name: e.target.value })}/>
      <Button size="small" disabled={!i} onClick={() => reorder(i, i - 1)}>上移</Button><Button size="small" disabled={i === set.rules.length - 1} onClick={() => reorder(i, i + 1)}>下移</Button>
      <Button size="small" onClick={() => { const id = generateTemplateCellId('rule'); save({ ...set, rules: [...set.rules, { ...structuredClone(r), id, name: r.name + '副本', order: set.rules.length }] }); setActive(id); }}>复制规则</Button>
      <Button size="small" danger onClick={() => save({ ...set, rules: set.rules.filter(x => x.id !== r.id).map((x, n) => ({ ...x, order: n })) })}>删除规则</Button></Space>}>
      {active !== r.id ? <Button onClick={() => setActive(r.id)}>编辑规则</Button> : <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <PredicateEditor value={r.predicate} onChange={predicate => update(r.id, { predicate })} cell={cell} fields={availableFields} document={document} grid={previewGrid}/>
        <Checkbox checked={!!r.style} onChange={e => update(r.id, { style: e.target.checked ? { scope: 'cell', style: {} } : undefined })}>设置样式</Checkbox>
        {r.style && <StyleEffectEditor value={r.style} onChange={style => update(r.id, { style })} cell={cell} document={document}/>}
        <Checkbox checked={r.text !== undefined} onChange={e => update(r.id, { text: e.target.checked ? '' : undefined })}>替换显示文本</Checkbox>
        {r.text !== undefined && <><Input.TextArea aria-label="替换显示文本" rows={2} value={r.text} placeholder="低产（{formatted}）；留空表示隐藏文字" onChange={e => update(r.id, { text: e.target.value })}/>
          <Space wrap>{['value', 'formatted', 'fieldLabel', 'rowLabel', 'columnLabel'].map(t => <Button size="small" key={t} onClick={() => update(r.id, { text: (r.text || '') + `{${t}}` })}>{`{${t}}`}</Button>)}</Space></>}
        <Checkbox checked={r.stopIfTrue} onChange={e => update(r.id, { stopIfTrue: e.target.checked })}>命中后停止</Checkbox>
        {!r.stopIfTrue && <Typography.Text type="warning">继续匹配：同作用层的后续动作可以覆盖本规则。</Typography.Text>}
      </Space>}
    </Card>)}
    <Checkbox checked={!!set.otherwise?.style} onChange={e=>save({...set,otherwise:{...set.otherwise,style:e.target.checked?{scope:'cell',style:{}}:undefined}})}>未命中时设置样式</Checkbox>
    {set.otherwise?.style&&<StyleEffectEditor value={set.otherwise.style} onChange={style=>save({...set,otherwise:{...set.otherwise,style}})} cell={cell} document={document}/>}
    <Checkbox checked={set.otherwise?.text !== undefined} onChange={e => save({ ...set, otherwise: { ...set.otherwise, text: e.target.checked ? '' : undefined } })}>未命中时替换文字</Checkbox>
    {set.otherwise?.text !== undefined && <Input aria-label="未命中默认文字" value={set.otherwise.text} onChange={e => save({ ...set, otherwise: { ...set.otherwise, text: e.target.value } })}/>}
    {evaluation?.diagnostics.some(d => d.severity === 'error') && <Alert type="error" message={evaluation.diagnostics.filter(d => d.severity === 'error').map(d => d.message).join('；')}/>}
    {stats.length > 0 ? <Table size="small" pagination={false} rowKey="ruleId" dataSource={stats} columns={[
                { title: '规则', render: (_, s) => set.rules.find(r => r.id === s.ruleId)?.name }, { title: '目标', dataIndex: 'targets' }, { title: '命中', dataIndex: 'matched' }, { title: '最终触发', dataIndex: 'applied' },
                { title: '被前序拦截', dataIndex: 'blocked' }, { title: '影响行', dataIndex: 'affectedRows' }, { title: '影响格', dataIndex: 'affectedCells' }, { title: '跳过合并', dataIndex: 'skippedMerges' }
            ]}/> : <Typography.Text type="secondary">当前无目标实例；合法的零命中规则仍可保存。</Typography.Text>}
    {stats.flatMap(s => s.samples.slice(0, 1).map(sample => <Typography.Text key={'sample-'+s.ruleId} type="secondary">{set.rules.find(r => r.id === s.ruleId)?.name}样本 R{sample.row + 1}C{sample.col + 1}：原值{String(sample.value ?? '空')}，基础文本“{sample.formatted}”，条件{sample.matched ? '成立' : '不成立'}，最终文本“{sample.text}”</Typography.Text>))}
  </Space>;
}
