import React,{forwardRef,useMemo,useRef,useEffect,useImperativeHandle,useState,useDeferredValue} from 'react';
import {Alert,Button,Card,Checkbox,ColorPicker,Collapse,Input,InputNumber,Radio,Select,Space,Spin,Tabs,Tag,Typography,message} from 'antd';
import {useDatasetData,useRegisteredDatasets} from '../core/datasetRegistry.js';
import {chartFields,compileChart} from '../chart/compileChart.js';
import {chartMetricKey,createChartConfig,type ChartConfigV1,type ChartMetric,type ChartFilter,type CompiledChart} from '../chart/types.js';
import type {FieldDataType,ComputedColumnConfig} from '../engine/types.js';
import {ChartView} from './presentation/charts/ChartView.js';
import {FormulaEditorModal} from './components/FormulaEditorModal.js';

export interface ChartConfigPanelRef {getConfig:()=>ChartConfigV1;validateAndGetChart:()=>CompiledChart}
export interface ChartConfigPanelProps {value:ChartConfigV1;onChange:(config:ChartConfigV1)=>void;isDark?:boolean|undefined;isEn?:boolean|undefined;height?:number|string|undefined}
const aggregations=[['sum','求和'],['avg','平均'],['count','计数'],['min','最小'],['max','最大']].map(([value,label])=>({value,label}));
const grains=[['hour','小时'],['day','日'],['week','周'],['month','月'],['quarter','季度'],['year','年'],['custom','自定义天数']].map(([value,label])=>({value,label}));
/** 模式一专用：没有表格、行列透视、工作簿及Excel保存入口。 */
export const ChartConfigPanel=forwardRef<ChartConfigPanelRef,ChartConfigPanelProps>(function ChartConfigPanel({value,onChange,isDark=false,isEn=false,height='100%'},ref){
  const datasets=useRegisteredDatasets(),resolved=useDatasetData(value.datasetId);
  const fields=useMemo(()=>chartFields(resolved.data,resolved.headers,value.fieldTypes),[resolved.data,resolved.headers,value.fieldTypes]);
  const initialised=useRef(value.dimension.field||value.metrics.length?value.datasetId:'');
  const [formula,setFormula]=useState<{open:boolean;value?:ComputedColumnConfig|undefined;originalKey?:string|undefined}>({open:false});
  const patch=(next:Partial<ChartConfigV1>)=>onChange({...value,...next});
  useEffect(()=>{
    if(resolved.loading||resolved.error||!fields.length||initialised.current===value.datasetId)return;
    initialised.current=value.datasetId;
    if(value.dimension.field||value.metrics.length)return;
    const dimension=fields.find(f=>f.type==='time')||fields.find(f=>f.type==='text')||fields[0];
    const metric=fields.find(f=>f.type==='number'&&f.key!==dimension?.key);
    if(dimension)onChange({...value,dimension:{field:dimension.key,...(dimension.type==='time'?{timeBucket:{granularity:'day' as const}}:{})},metrics:metric?[{type:'aggregated',field:metric.key,agg:'sum',label:metric.label,axis:'left'}]:[]});
  },[fields,value,onChange,resolved.loading,resolved.error]);
  const deferred=useDeferredValue(value);
  const preview=useMemo(()=>compileChart(deferred,resolved.data,resolved.headers),[deferred,resolved.data,resolved.headers]);
  useImperativeHandle(ref,()=>({getConfig:()=>structuredClone(value),validateAndGetChart:()=>{
    const chart=compileChart(value,resolved.data,resolved.headers);
    const message=resolved.loading?'数据源正在加载':resolved.error?.message||(!datasets.some(d=>d.id===value.datasetId)?'数据源不存在':'');
    return message?{...chart,valid:false,issues:[{path:'datasetId',message},...chart.issues]}:chart;
  }}),[value,resolved,datasets]);
  const options=fields.map(f=>({value:f.key,label:`${f.label} (${f.key})`}));
  const dimension=fields.find(f=>f.key===value.dimension.field);
  const setMetric=(index:number,next:Partial<ChartMetric>)=>patch({metrics:value.metrics.map((m,i)=>i===index?{...m,...next} as ChartMetric:m)});
  const selectMetrics=(selected:string[])=>{const metrics:ChartMetric[]=[...selected.map(field=>value.metrics.find(m=>m.type==='aggregated'&&m.field===field)||{type:'aggregated' as const,field,agg:fields.find(f=>f.key===field)?.type==='number'?'sum' as const:'count' as const,label:fields.find(f=>f.key===field)?.label||field,axis:'left' as const}),...value.metrics.filter(m=>m.type==='computed')];patch({metrics,sort:value.sort.field==='dimension'||metrics.some(m=>chartMetricKey(m)===value.sort.field)?value.sort:{field:'dimension',order:value.sort.order}});};
  const fieldInput=(f:ChartFilter)=>fields.find(x=>x.key===f.field)?.type==='number'?<InputNumber aria-label="筛选数值" value={typeof f.value==='number'?f.value:null} onChange={n=>updateFilter(f.id,{value:n??undefined})}/>:<Input aria-label="筛选文字" value={String(f.value??'')} onChange={e=>updateFilter(f.id,{value:e.target.value})}/>;
  const updateFilter=(id:string,next:Partial<ChartFilter>)=>patch({filters:value.filters.map(f=>f.id===id?{...f,...next}:f)});
  return <div data-chart-config-panel style={{display:'flex',height,minHeight:450,background:isDark?'#141414':'#fff',color:isDark?'#eee':undefined}}>
    <div style={{width:420,minWidth:340,maxWidth:'48%',overflowY:'auto',padding:12,borderRight:'1px solid #ddd'}}>
      <Space direction="vertical" style={{width:'100%'}} size={12}>
        <Typography.Text strong>{isEn?'Chart configuration':'图表配置（模式一）'}</Typography.Text>
        <Select aria-label="图表数据源" style={{width:'100%'}} value={value.datasetId} options={datasets.map(d=>({value:d.id,label:d.name}))} onChange={datasetId=>{initialised.current='';onChange(createChartConfig(datasetId));}}/>
        {resolved.error&&<Alert type="error" message={resolved.error.message} action={<Button onClick={()=>void resolved.refresh()}>重试</Button>}/>}
        <Radio.Group aria-label="图表类型" value={value.chartType} onChange={e=>patch({chartType:e.target.value})} optionType="button" options={[{value:'bar',label:'柱状图'},{value:'line',label:'折线图'},{value:'pie',label:'饼图'}]}/>
        <Tabs items={[
          {key:'data',label:'数据与维度',children:<Space direction="vertical" style={{width:'100%'}} size={12}>
            <Typography.Text>{value.chartType==='pie'?'分类维度':'横轴 / 分类维度'}</Typography.Text>
            <Select<string> aria-label="分类维度" showSearch optionFilterProp="label" style={{width:'100%'}} value={value.dimension.field||null} options={options} onChange={field=>patch({dimension:{field,...(fields.find(f=>f.key===field)?.type==='time'?{timeBucket:{granularity:'day'}}:{})},seriesField:value.seriesField===field?undefined:value.seriesField})}/>
            {dimension?.type==='time'&&<Space><Typography.Text>时间粒度</Typography.Text><Select aria-label="时间粒度" style={{width:140}} value={value.dimension.timeBucket?.granularity||'raw'} options={[{value:'raw',label:'原始时间'},...grains]} onChange={granularity=>patch({dimension:{field:value.dimension.field,...(granularity==='raw'?{}:{timeBucket:{granularity:granularity as any,...(granularity==='custom'?{customIntervalDays:1}:{})}})}})}/></Space>}
            {value.dimension.timeBucket?.granularity==='custom'&&<InputNumber aria-label="自定义天数" min={1} value={value.dimension.timeBucket.customIntervalDays||1} onChange={customIntervalDays=>patch({dimension:{...value.dimension,timeBucket:{...value.dimension.timeBucket!,customIntervalDays:customIntervalDays||1}}})}/>}
            <Typography.Text>系列维度（颜色 / 分组，可选）</Typography.Text>
            <Select aria-label="系列维度" allowClear style={{width:'100%'}} value={value.seriesField} options={options.filter(o=>o.value!==value.dimension.field)} onChange={seriesField=>patch({seriesField})}/>
            <Typography.Text>排序与分类数量</Typography.Text>
            <Space wrap><Select aria-label="图表排序字段" style={{width:160}} value={value.sort.field} options={[{value:'dimension',label:'分类维度'},...value.metrics.map(m=>({value:chartMetricKey(m),label:m.label||chartMetricKey(m)}))]} onChange={field=>patch({sort:{...value.sort,field}})}/><Select aria-label="图表排序方向" value={value.sort.order} options={[{value:'asc',label:'升序'},{value:'desc',label:'降序'}]} onChange={order=>patch({sort:{...value.sort,order}})}/><InputNumber aria-label="图表分类上限" min={1} max={1000} placeholder="全部分类" value={value.topN??null} onChange={n=>patch({topN:n??undefined})}/></Space>
            <Collapse size="small" items={[{key:'filter',label:`数据筛选（${value.filters.length}）`,children:<Space direction="vertical" style={{width:'100%'}}>
              {value.filters.map(f=><Card size="small" key={f.id}><Space direction="vertical"><Select<string> aria-label="筛选字段" style={{width:210}} value={f.field||null} options={options} onChange={field=>updateFilter(f.id,{field,operator:'eq',value:undefined})}/><Space><Select aria-label="筛选条件" value={f.operator} options={['eq','ne','gt','gte','lt','lte','contains','empty','notEmpty'].map((v,i)=>({value:v,label:['等于','不等于','大于','大于等于','小于','小于等于','包含','为空','不为空'][i]})).filter(o=>fields.find(x=>x.key===f.field)?.type==='number'?o.value!=='contains':!['gt','gte','lt','lte'].includes(o.value))} onChange={operator=>updateFilter(f.id,{operator})}/>{!['empty','notEmpty'].includes(f.operator)&&fieldInput(f)}</Space><Button danger size="small" onClick={()=>patch({filters:value.filters.filter(x=>x.id!==f.id)})}>删除筛选</Button></Space></Card>)}
              <Button onClick={()=>patch({filters:[...value.filters,{id:globalThis.crypto?.randomUUID?.()||`filter-${Date.now()}`,field:fields[0]?.key||'',operator:'eq',value:undefined}]})}>添加筛选</Button>
            </Space>},{key:'fields',label:'字段类型',children:fields.map(f=><div key={f.key} style={{display:'flex',justifyContent:'space-between',gap:8,marginBottom:6}}><Typography.Text ellipsis style={{maxWidth:230}}>{f.label}</Typography.Text><Select aria-label={`字段类型 ${f.key}`} size="small" value={f.type} options={[{value:'time',label:'时间'},{value:'text',label:'文本'},{value:'number',label:'数值'}]} onChange={(type:FieldDataType)=>patch({fieldTypes:{...value.fieldTypes,[f.key]:type}})}/></div>)}]}/>
          </Space>},
          {key:'metrics',label:'指标与公式',children:<Space direction="vertical" style={{width:'100%'}} size={10}>
            <Select aria-label="选择图表指标" mode="multiple" style={{width:'100%'}} value={value.metrics.filter(m=>m.type==='aggregated').map(m=>m.field)} options={options.filter(o=>o.value!==value.dimension.field&&o.value!==value.seriesField)} onChange={selectMetrics} placeholder="选择统计指标"/>
            {value.metrics.map((m,i)=><Card key={chartMetricKey(m)} size="small" data-chart-metric={chartMetricKey(m)} title={<Space><Tag>{m.type==='computed'?'业务公式':m.field}</Tag><Button size="small" disabled={!i} onClick={()=>{const list=[...value.metrics];[list[i-1],list[i]]=[list[i]!,list[i-1]!];patch({metrics:list});}}>上移</Button><Button size="small" danger onClick={()=>patch({metrics:value.metrics.filter((_,n)=>n!==i),sort:value.sort.field===chartMetricKey(m)?{field:'dimension',order:value.sort.order}:value.sort})}>移除指标</Button></Space>}>
              <Space direction="vertical" style={{width:'100%'}}><Input aria-label="指标名称" value={m.label||chartMetricKey(m)} onChange={e=>setMetric(i,{label:e.target.value})}/>
                {m.type==='aggregated'?<Select aria-label="指标聚合" value={m.agg} options={aggregations} onChange={agg=>setMetric(i,{agg} as Partial<ChartMetric>)}/>:<Button onClick={()=>setFormula({open:true,value:m,originalKey:m.name})}>编辑公式</Button>}
                <Space><Select aria-label="指标坐标轴" value={m.axis||'left'} options={[{value:'left',label:'左轴'},{value:'right',label:'右轴'}]} onChange={axis=>setMetric(i,{axis})}/><Input aria-label="指标单位" placeholder="显示单位，如 % / 件" value={m.unit||''} onChange={e=>setMetric(i,{unit:e.target.value})}/></Space>
              </Space>
            </Card>)}
            <Button onClick={()=>setFormula({open:true})}>添加业务公式</Button>
          </Space>},
          {key:'style',label:'图形样式',children:<Space direction="vertical" style={{width:'100%'}} size={12}>
            {(['legend','labels','stacked','smooth'] as const).map((key,i)=><Checkbox key={key} checked={value.appearance[key]} onChange={e=>patch({appearance:{...value.appearance,[key]:e.target.checked}})}>{['显示图例','显示数值标签','堆叠柱状图','平滑折线'][i]}</Checkbox>)}
            <Typography.Text>自定义图形配色</Typography.Text><Space wrap>{value.appearance.palette.map((color,i)=><ColorPicker key={i} aria-label={`图形颜色 ${i+1}`} value={color} disabledAlpha onChange={c=>patch({appearance:{...value.appearance,palette:value.appearance.palette.map((p,n)=>n===i?c.toHexString().toUpperCase():p)}})}/>)}</Space>
            <Space><Button onClick={()=>patch({appearance:{...value.appearance,palette:[...value.appearance.palette,'#1677FF']}})}>添加颜色</Button><Button onClick={()=>patch({appearance:{...value.appearance,palette:[]}})}>恢复主题配色</Button></Space>
          </Space>}
        ]}/>
      </Space>
    </div>
    <div style={{flex:1,minWidth:0,padding:16,overflow:'auto'}}>
      <Space style={{marginBottom:12}} wrap><Typography.Text strong>VChart实时预览</Typography.Text><Tag>原始 {resolved.data.length} 条</Tag><Tag>筛选后 {preview.filteredRows} 条</Tag><Tag>分析结果 {preview.result.data.length} 组</Tag></Space>
      <Spin spinning={resolved.loading}><ChartView config={deferred} data={resolved.data} headers={resolved.headers} compiled={preview} theme={isDark?'dark':'light'} height={440}/></Spin>
    </div>
    {formula.open&&<FormulaEditorModal open usage="chart" initialValue={formula.value} availableFields={fields} sampleRow={resolved.data[0]} isDark={isDark} onCancel={()=>setFormula({open:false})} onOk={metric=>{
      if(value.metrics.some(m=>chartMetricKey(m)===metric.name&&chartMetricKey(m)!==formula.originalKey)){message.error('指标标识已存在，请使用其他Key');return;}
      const old=value.metrics.find(m=>chartMetricKey(m)===formula.originalKey);
      patch({metrics:formula.originalKey?value.metrics.map(m=>chartMetricKey(m)===formula.originalKey?{...old,...metric} as ChartMetric:m):[...value.metrics,{...metric,axis:'left'}],sort:formula.originalKey&&value.sort.field===formula.originalKey?{...value.sort,field:metric.name}:value.sort});setFormula({open:false});
    }}/>}
  </div>;
});
