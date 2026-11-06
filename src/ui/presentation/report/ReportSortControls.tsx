import React, {forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Button, Dropdown, Modal, Select, Space, Tooltip, Typography, theme} from 'antd';
import {ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, HolderOutlined, PlusOutlined, SortAscendingOutlined} from '@ant-design/icons';
import type {ReportSortCatalog, ReportSortHeader, ReportSortRule, ReportSortTarget} from '../../../report/sortTypes.js';
import {reportSortRuleIssues, sortRuleSummary, sortSliceId} from '../../../report/reportSort.js';

export interface ReportSortControlsRef {
  openHeader:(header:ReportSortHeader,anchor:{left:number;top:number})=>void;
}
export interface ReportSortControlsProps {
  catalog:ReportSortCatalog;
  rules:readonly ReportSortRule[];
  defaultRules?:readonly ReportSortRule[]|undefined;
  /** undefined restores template defaults; [] explicitly clears instance sorting. */
  onChange:(rules:ReportSortRule[]|undefined)=>void;
  disabled?:boolean|undefined;
  label?:string|undefined;
  sheetId?:string|undefined;
}
const clone=(rules:readonly ReportSortRule[])=>rules.map(rule=>({...rule,...(rule.slice?{slice:rule.slice.map(member=>({...member}))}:{})}));
const base=(targetId:string):ReportSortRule=>({targetId,by:'value',order:'asc'});
const operationLabel:Record<string,string>={sum:'求和',avg:'平均',count:'计数',min:'最小值',max:'最大值',formula:'业务公式'};
const axisLabel=(target:ReportSortTarget)=>`${target.axis==='record'?'':target.axis==='row'?'行：':'列：'}${target.label}`;
const popupContainer=(trigger:HTMLElement)=>trigger.closest<HTMLElement>('.mbi-modal-content, .ant-modal-content')||trigger.ownerDocument.body;
const scope=(target:ReportSortTarget,catalog:ReportSortCatalog)=>target.axis==='record'?'全部记录':target.parentId
  ? `同一${catalog.targets.find(parent=>parent.id===target.parentId)?.label||'父级'}内的${target.label}`:`全部${target.label}`;

export const ReportSortControls=forwardRef<ReportSortControlsRef,ReportSortControlsProps>(function ReportSortControls(
  {catalog,rules,defaultRules=[],onChange,disabled,label='排序',sheetId},ref){
  const {token}=theme.useToken();
  const [draft,setDraft]=useState<ReportSortRule[]|null>(null);
  const [menu,setMenu]=useState<{header:ReportSortHeader;anchor:{left:number;top:number}}|null>(null);
  const targetMap=useMemo(()=>new Map(catalog.targets.map(target=>[target.id,target])),[catalog]);
  const availableTargets=catalog.targets.filter(target=>!sheetId||target.sheetId===sheetId);
  const listRef=useRef<HTMLDivElement>(null);
  const dragRef=useRef<{from:number;over:number;handle:HTMLElement;pointer:number}|null>(null);
  const recordMode=availableTargets.some(target=>target.axis==='record')&&!availableTargets.some(target=>target.axis!=='record');
  const summary=rules.map(rule=>sortRuleSummary(rule,catalog)).join('；');
  const issues=reportSortRuleIssues(catalog,rules),draftIssues=reportSortRuleIssues(catalog,draft||[]);
  const sameAsDefault=JSON.stringify(rules)===JSON.stringify(defaultRules);
  const metricsFor=(target:ReportSortTarget|undefined)=>catalog.metrics.filter(metric=>metric.sheetId===target?.sheetId&&metric.regionId===target?.regionId);
  const slicesFor=(target:ReportSortTarget|undefined)=>catalog.slices.filter(slice=>slice.sheetId===target?.sheetId&&slice.regionId===target?.regionId&&slice.axis===(target?.axis==='row'?'column':'row'));
  const replaceRule=(current:readonly ReportSortRule[],rule:ReportSortRule)=>{
    const index=current.findIndex(item=>item.targetId===rule.targetId);
    return index<0?[...clone(current),rule]:current.map((item,i)=>i===index?rule:{...item});
  };
  const openEditor=(preset?:ReportSortRule,replace=false)=>{
    setMenu(null);
    let next=clone(rules);
    if(preset&&(!next.some(rule=>rule.targetId===preset.targetId)||replace))next=replaceRule(next,preset);
    if(!next.length&&availableTargets.length)next=[base(availableTargets.find(target=>target.axis==='row'&&!availableTargets.some(child=>child.parentId===target.id))?.id||availableTargets[0]!.id)];
    setDraft(next);
  };
  useImperativeHandle(ref,()=>({openHeader:(header,anchor)=>{if(!disabled&&targetMap.has(header.preset.targetId))setMenu({header,anchor});}}),[disabled,targetMap]);
  useEffect(()=>{if(menu&&(!targetMap.has(menu.header.preset.targetId)||disabled))setMenu(null);},[catalog,disabled,menu]);
  const quick=(rule:ReportSortRule)=>{onChange(targetMap.get(rule.targetId)?.axis==='record'?[rule]:replaceRule(rules,rule));setMenu(null);};
  const menuTarget=menu&&targetMap.get(menu.header.preset.targetId);
  const menuMetric=menu&&catalog.metrics.find(metric=>metric.id===menu.header.preset.metricId);
  const menuSlice=menu?.header.preset.slice?.length?catalog.slices.find(slice=>slice.id===sortSliceId(menu.header.preset.slice!))?.label:undefined;
  const menuItems=menu&&menuTarget?[
    {key:'title',label:<div style={{maxWidth:280}}><Typography.Text strong>{menuMetric?`${menuSlice||'全部汇总'} · ${menuMetric.label}`:menuTarget.label}</Typography.Text><div style={{fontSize:12,color:token.colorTextSecondary}}>排序范围：{scope(menuTarget,catalog)}</div></div>,disabled:true},
    {key:'asc',icon:<ArrowUpOutlined/>,label:menu.header.preset.by==='metric'?'从小到大':menuTarget.valueType==='date'?'时间从早到晚':'升序'},
    {key:'desc',icon:<ArrowDownOutlined/>,label:menu.header.preset.by==='metric'?'从大到小':menuTarget.valueType==='date'?'时间从晚到早':'降序'},
    {type:'divider' as const},
    ...(menu.header.related?[{key:'related',label:`按本${menuTarget.axis==='column'?'列':'行'}指标排序${targetMap.get(menu.header.related.targetId)?.label||''}…`}]:[]),
    ...(menuTarget.axis!=='record'&&metricsFor(menuTarget).length?[{key:'metric',label:'按指标排序…'}]:[]),
    {key:'settings',label:menuTarget.axis==='record'?'多条件排序…':'排序设置…'},
    {key:'clear',label:'恢复该项默认顺序'},
  ]:[];
  const changeDraft=(index:number,patch:Partial<ReportSortRule>)=>setDraft(current=>current!.map((rule,i)=>i===index?{...rule,...patch}:rule));
  const moveDraft=(from:number,to:number)=>setDraft(current=>{const next=[...current!],[rule]=next.splice(from,1);if(rule)next.splice(to,0,rule);return next;});
  const finishDrag=()=>{
    const drag=dragRef.current;if(!drag)return;dragRef.current=null;
    if(drag.handle.hasPointerCapture(drag.pointer))drag.handle.releasePointerCapture(drag.pointer);
    listRef.current?.querySelectorAll('[data-sort-drop]').forEach(element=>element.removeAttribute('data-sort-drop'));
    if(drag.from!==drag.over)moveDraft(drag.from,drag.over);
  };
  return <>
    <style>{`.micro-bi-sort-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:8px}.micro-bi-sort-fields label{display:grid;gap:4px;min-width:0;font-size:12px}.micro-bi-sort-rule[data-sort-drop]{box-shadow:0 -2px 0 ${token.colorPrimary}}.micro-bi-sort-dialog .ant-modal-body,.micro-bi-sort-dialog .mbi-modal-body{max-height:65vh;overflow-y:auto}`}</style>
    <Space size={8} wrap data-report-sort-controls>
      <Button size="small" icon={<SortAscendingOutlined/>} aria-label="报表排序设置" disabled={disabled||!availableTargets.length} onClick={()=>openEditor()}>{label}{rules.length?` (${rules.length})`:''}</Button>
      {summary?<Tooltip title={summary}><Typography.Text type={issues.length?'warning':'secondary'} ellipsis style={{maxWidth:320,fontSize:12}}>{summary}</Typography.Text></Tooltip>:null}
      {!sameAsDefault&&<Button size="small" type="link" onClick={()=>onChange(undefined)}>恢复默认</Button>}
    </Space>
    {issues.length>0&&<div role="status" style={{fontSize:12,color:token.colorWarningText}}>{[...new Set(issues.map(issue=>issue.message))].join('；')}</div>}
    {menu&&typeof document!=='undefined'&&createPortal(<Dropdown open autoFocus menu={{items:menuItems,onClick:({key})=>{
      const preset=menu.header.preset,target=targetMap.get(preset.targetId);if(!target)return;
      if(key==='asc'||key==='desc')quick({...preset,order:key});
      else if(key==='related')openEditor(menu.header.related,true);
      else if(key==='metric')openEditor({...preset,by:'metric',metricId:preset.metricId||metricsFor(target)[0]?.id,order:'desc'},true);
      else if(key==='settings')openEditor(preset);
      else if(key==='clear'){onChange([...rules.filter(rule=>rule.targetId!==preset.targetId),...clone(defaultRules.filter(rule=>rule.targetId===preset.targetId))]);setMenu(null);}
    }}} onOpenChange={open=>{if(!open)setMenu(null);}} trigger={['click']} placement="bottomRight">
      <span style={{position:'fixed',left:menu.anchor.left,top:menu.anchor.top,width:1,height:1,zIndex:token.zIndexPopupBase}}/>
    </Dropdown>,document.body)}
    <Modal title={recordMode?'多条件排序':'排序设置'} open={draft!==null} className="micro-bi-sort-dialog" width={610} okText="应用" cancelText="取消"
      onCancel={()=>{dragRef.current=null;setDraft(null);}} okButtonProps={{disabled:draftIssues.some(issue=>issue.code!=='WARN_SORT_SLICE_MISSING')}}
      onOk={()=>{if(draft){onChange(clone(draft));setDraft(null);}}} destroyOnHidden>
      <div ref={listRef} onPointerMove={event=>{
        const drag=dragRef.current;if(!drag)return;
        const row=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-sort-rule-index]');
        listRef.current?.querySelectorAll('[data-sort-drop]').forEach(element=>element.removeAttribute('data-sort-drop'));
        if(row&&listRef.current?.contains(row)){drag.over=Number(row.dataset.sortRuleIndex);if(drag.over!==drag.from)row.setAttribute('data-sort-drop','true');}
      }} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
        {draft?.map((rule,index)=>{
          const target=targetMap.get(rule.targetId),metric=catalog.metrics.find(metric=>metric.id===rule.metricId),slices=slicesFor(target);
          const sliceValue=rule.slice?.length?sortSliceId(rule.slice):'all',sliceMissing=sliceValue!=='all'&&!slices.some(slice=>slice.id===sliceValue);
          const ruleIssue=draftIssues.find(issue=>issue.rule===rule);
          return <div key={`${index}:${rule.targetId}`} className="micro-bi-sort-rule" data-sort-rule-index={index} style={{padding:'12px 0',borderBottom:`1px solid ${token.colorBorderSecondary}`}}>
            <Space style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
              <Space>
                {target?.axis==='record'&&<Button type="text" size="small" icon={<HolderOutlined/>} aria-label={`拖动第${index+1}条排序调整优先级`} style={{cursor:'grab',touchAction:'none'}}
                  onPointerDown={event=>{if(event.button!==0)return;const handle=event.currentTarget;handle.setPointerCapture(event.pointerId);dragRef.current={from:index,over:index,handle,pointer:event.pointerId};event.preventDefault();}}
                  onKeyDown={event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){moveDraft(index,Math.max(0,Math.min(draft.length-1,index+(event.key==='ArrowUp'?-1:1))));event.preventDefault();}}}/>}
                <Typography.Text strong>{target?.axis==='record'?index===0?'首先按':'然后按':target?.axis==='column'?'列排序':'行排序'}</Typography.Text>
              </Space>
              <Button type="text" size="small" icon={<DeleteOutlined/>} aria-label={`删除第${index+1}条排序`} onClick={()=>setDraft(draft.filter((_,i)=>i!==index))}/>
            </Space>
            <div className="micro-bi-sort-fields">
              <label>{recordMode?'字段':'排序对象'}<Select getPopupContainer={popupContainer} aria-label={`第${index+1}条排序对象`} value={rule.targetId} status={!target?'error':''}
                options={[...(!target?[{value:rule.targetId,label:'排序字段已变化，请重新选择'}]:[]),...availableTargets.map(target=>({value:target.id,label:axisLabel(target),disabled:draft.some((other,i)=>i!==index&&other.targetId===target.id)}))]}
                onChange={targetId=>changeDraft(index,{targetId,by:'value',metricId:undefined,slice:undefined})}/></label>
              {target?.axis!=='record'&&<label>排序依据<Select getPopupContainer={popupContainer} aria-label={`第${index+1}条排序依据`} value={rule.by==='metric'?rule.metricId||'missing':'value'}
                status={rule.by==='metric'&&!metric?'error':''} options={[{value:'value',label:target?.valueType==='date'?'时间先后':'成员名称'},
                  ...(rule.by==='metric'&&!metric?[{value:rule.metricId||'missing',label:'指标口径已变化，请重新选择'}]:[]),
                  ...metricsFor(target).map(metric=>({value:metric.id,label:`${metric.label}（${operationLabel[metric.operation]||metric.operation}）`}))]}
                onChange={value=>changeDraft(index,value==='value'?{by:'value',metricId:undefined,slice:undefined}:{by:'metric',metricId:value})}/></label>}
              <label>顺序<Select getPopupContainer={popupContainer} aria-label={`第${index+1}条排序方向`} value={rule.order} options={[{value:'asc',label:'升序'},{value:'desc',label:'降序'}]} onChange={order=>changeDraft(index,{order})}/></label>
            </div>
            {rule.by==='metric'&&(slices.length>0||rule.slice?.length)&&<Space wrap style={{marginTop:8}}><Typography.Text type="secondary" style={{fontSize:12}}>取值范围</Typography.Text>
              <Select getPopupContainer={popupContainer} aria-label={`第${index+1}条取值范围`} showSearch optionFilterProp="label" style={{minWidth:190,maxWidth:'100%'}} value={sliceValue}
                options={[{value:'all',label:target?.axis==='row'?'全部列汇总':'全部行汇总'},...(sliceMissing?[{value:sliceValue,label:'参考成员当前无数据（已保留）'}]:[]),...slices.map(slice=>({value:slice.id,label:slice.label}))]}
                onChange={value=>changeDraft(index,{slice:value==='all'?undefined:slices.find(slice=>slice.id===value)?.members.map(member=>({...member}))})}/></Space>}
            {target&&target.axis!=='record'&&<div style={{fontSize:12,color:token.colorTextSecondary,marginTop:6}}>范围：{scope(target,catalog)}</div>}
            {ruleIssue&&<Typography.Text type={ruleIssue.code==='WARN_SORT_SLICE_MISSING'?'warning':'danger'} style={{fontSize:12}}>{ruleIssue.message}</Typography.Text>}
          </div>;
        })}
      </div>
      {draft&&availableTargets.some(target=>!draft.some(rule=>rule.targetId===target.id))&&<Button aria-label="添加排序" type="link" size="small" icon={<PlusOutlined/>} style={{paddingLeft:0,marginTop:10}} onClick={()=>{
        const target=availableTargets.find(target=>!draft.some(rule=>rule.targetId===target.id));if(target)setDraft([...draft,base(target.id)]);
      }}>添加排序</Button>}
      {draft&&<Typography.Paragraph type="secondary" style={{fontSize:12,marginTop:12,marginBottom:0}}>{draft.length?draft.map(rule=>sortRuleSummary(rule,catalog)).join('；'):'恢复默认顺序'}</Typography.Paragraph>}
    </Modal>
  </>;
});
