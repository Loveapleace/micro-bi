import type { DataRecord, FieldMeta, HeaderMapping, DynamicTransformConfig } from '../engine/types.js';
import { transformData } from '../engine/pipeline.js';
import { validateTransformConfig } from '../engine/validator.js';
import { profileDataset } from '../engine/profiler.js';
import { validateAndParseFormula } from './formulaValidation.js';
import type { ChartConfigV1, ChartFilter, ChartIssue, CompiledChart } from './types.js';
import { chartMetricKey } from './types.js';

export function chartFields(data:readonly DataRecord[],headers:HeaderMapping={},overrides?:ChartConfigV1['fieldTypes']):FieldMeta[] {
  const detected=profileDataset(data,{headers,userOverrides:overrides});
  const seen=new Set(detected.map(f=>f.key));
  return [...detected,...Object.keys(headers).filter(key=>!seen.has(key)).map(key=>({key,label:headers[key]||key,type:overrides?.[key]||'text',detectedType:'text'} as FieldMeta))];
}
export function validateChartConfig(raw:unknown,fields?:readonly FieldMeta[]):{valid:boolean;issues:ChartIssue[]} {
  const issues:ChartIssue[]=[],issue=(path:string,message:string)=>issues.push({path,message});
  const c=raw as ChartConfigV1;
  if(!c||typeof c!=='object'||c.kind!=='chart-config'||c.version!==1)return {valid:false,issues:[{path:'kind',message:'请选择新的图表配置；此入口不读取旧配置'}]};
  if(!c.dimension||typeof c.dimension!=='object'||!Array.isArray(c.metrics)||!Array.isArray(c.filters)||!c.appearance||typeof c.appearance!=='object'||!c.sort||typeof c.sort!=='object')return {valid:false,issues:[{path:'schema',message:'图表配置结构不完整'}]};
  const allowed=new Set(['kind','version','datasetId','chartType','dimension','seriesField','metrics','fieldTypes','filters','sort','topN','appearance']);
  for(const key of Object.keys(c))if(!allowed.has(key))issue(key,'图表配置包含不支持的属性');
  if(typeof c.datasetId!=='string'||!c.datasetId.trim())issue('datasetId','请选择数据源');
  if(!['bar','line','pie'].includes(c.chartType))issue('chartType','请选择柱状图、折线图或饼图');
  const names=new Set(fields?.map(f=>f.key)),hasField=(field:unknown,path:string)=>{if(typeof field!=='string'||!field)issue(path,'请选择字段');else if(fields&&!names.has(field))issue(path,`字段不存在：${field}`);};
  hasField(c.dimension?.field,'dimension');
  if(c.dimension&&Object.keys(c.dimension).some(k=>!['field','timeBucket'].includes(k)))issue('dimension','图表使用分类轴和系列，不支持行列透视配置');
  if(c.dimension?.timeBucket&&!['hour','day','week','month','quarter','year','custom'].includes(c.dimension.timeBucket.granularity))issue('dimension.timeBucket','时间粒度无效');
  if(c.dimension?.timeBucket?.granularity==='custom'&&(!Number.isInteger(c.dimension.timeBucket.customIntervalDays)||(c.dimension.timeBucket.customIntervalDays||0)<1))issue('dimension.timeBucket','自定义天数必须为正整数');
  if(c.seriesField){hasField(c.seriesField,'seriesField');if(c.seriesField===c.dimension?.field)issue('seriesField','系列字段不能与分类轴相同');}
  if(c.fieldTypes)for(const [field,type]of Object.entries(c.fieldTypes)){hasField(field,'fieldTypes');if(!['time','text','number'].includes(type))issue('fieldTypes','字段类型无效');}
  if(!Array.isArray(c.metrics)||!c.metrics.length)issue('metrics','至少选择一个指标');
  else {
    if(c.metrics.some(m=>!m||typeof m!=='object'))return {valid:false,issues:[{path:'metrics',message:'指标结构无效'}]};
    const keys=new Set<string>();
    for(const [i,m]of c.metrics.entries()){
      if(!m||!['aggregated','computed'].includes(m.type)){issue(`metrics.${i}`,'仅支持聚合指标或业务公式');continue;}
      const key=chartMetricKey(m);if(typeof key!=='string'||!key||keys.has(key))issue(`metrics.${i}`,'指标标识不能为空或重复');keys.add(key);
      if(key===c.dimension?.field||key===c.seriesField||typeof key==='string'&&key.startsWith('__chart_'))issue(`metrics.${i}`,'指标标识与维度或内部字段冲突');
      if(m.type==='aggregated'){hasField(m.field,`metrics.${i}`);if(!['sum','avg','count','min','max'].includes(m.agg))issue(`metrics.${i}`,'聚合方式无效');}
      if(m.axis&&!['left','right'].includes(m.axis))issue(`metrics.${i}`,'指标轴无效');
      if(m.type==='computed')for(const message of validateAndParseFormula(m,fields))issue(`metrics.${i}`,message);
    }
    if(c.chartType==='pie'&&(c.metrics.length!==1||c.seriesField))issue('chartType','饼图仅支持一个指标，请移除系列字段和多余指标');
    if(c.chartType!=='pie'&&c.metrics.length&&c.metrics.every(m=>m.axis==='right'))issue('metrics','至少保留一个左轴指标');
    if(c.appearance?.stacked&&(c.chartType!=='bar'||c.metrics.some(m=>m.axis==='right')))issue('appearance.stacked','堆叠仅支持同轴柱状图');
  }
  if(!Array.isArray(c.filters))issue('filters','筛选配置无效');
  else for(const f of c.filters){if(!f){issue('filters','筛选配置无效');continue;}hasField(f.field,'filters');if(!['eq','ne','gt','gte','lt','lte','contains','empty','notEmpty'].includes(f.operator))issue('filters','比较操作无效');
    if(!['empty','notEmpty'].includes(f.operator)&&f.value===undefined)issue('filters','请输入筛选值');
    if(['gt','gte','lt','lte'].includes(f.operator)&&typeof f.value!=='number')issue('filters','数值比较需要数值阈值');}
  if(!c.sort||!['asc','desc'].includes(c.sort.order)||c.sort.field!=='dimension'&&!c.metrics?.some(m=>m&&chartMetricKey(m)===c.sort.field))issue('sort','请选择有效的排序字段和方向');
  if(c.topN!==undefined&&(!Number.isInteger(c.topN)||c.topN<1||c.topN>1000))issue('topN','分类数量应在1～1000之间');
  if(!c.appearance||['legend','labels','stacked','smooth'].some(k=>typeof (c.appearance as any)[k]!=='boolean')||!Array.isArray(c.appearance.palette)||c.appearance.palette.some(x=>typeof x!=='string'||!/^#[\da-f]{6}$/i.test(x)))issue('appearance','图形样式或颜色无效');
  return {valid:!issues.length,issues};
}
function matches(row:DataRecord,f:ChartFilter,type?:string):boolean {
  const raw=row[f.field],empty=raw===null||raw===undefined||raw==='';
  const a=!empty&&type==='number'&&typeof raw==='string'?Number(raw.replace(/,/g,'')):!empty&&type==='text'?String(raw):raw;
  const b=type==='text'&&f.value!==undefined&&f.value!==null?String(f.value):f.value;
  if(f.operator==='empty')return empty;if(f.operator==='notEmpty')return !empty;
  if(f.operator==='eq')return Object.is(a,b);if(f.operator==='ne')return !Object.is(a,b);
  if(f.operator==='contains')return typeof a==='string'&&typeof b==='string'&&a.includes(b);
  if(empty||typeof b!=='number')return false;const n=typeof a==='number'?a:typeof a==='string'&&a.trim()?Number(a.replace(/,/g,'')):NaN;if(!Number.isFinite(n))return false;
  return f.operator==='gt'?n>b:f.operator==='gte'?n>=b:f.operator==='lt'?n<b:n<=b;
}
/** 从事实按分类/系列聚合；不消费透视矩阵或格式化后的单元格文字。 */
export function compileChart(config:ChartConfigV1,data:readonly DataRecord[],headers:HeaderMapping={}):CompiledChart {
  const shape=validateChartConfig(config);
  const fields=shape.valid?chartFields(data,headers,config?.fieldTypes):[],validation=shape.valid?validateChartConfig(config,fields):shape;
  const result:CompiledChart={valid:validation.valid,issues:validation.issues,result:{data:[],columns:[],meta:{inputRows:data.length,outputRows:0,executionTimeMs:0}},dimensionField:config?.dimension?.field||'',metricKeys:[],inputRows:data.length,filteredRows:0};
  if(!result.valid)return result;
  try{
    const fieldTypes=new Map(fields.map(f=>[f.key,f.type]));
    const filtered=data.filter(r=>config.filters.every(f=>matches(r,f,fieldTypes.get(f.field))));result.filteredRows=filtered.length;
    const dim=config.dimension,dimensions={...(dim.timeBucket?{timeBucket:{...dim.timeBucket,field:dim.field}}:{}),categories:[...(dim.timeBucket?[]:[dim.field]),...(config.seriesField?[config.seriesField]:[])]};
    const columns=config.metrics.map(({axis,unit,...metric})=>metric);
    const dsl:DynamicTransformConfig={datasetId:config.datasetId,headers,fields:config.fieldTypes,dimensions,columns};
    const checked=validateTransformConfig(dsl,fields);if(!checked.valid){result.valid=false;result.issues=checked.issues.map(i=>({path:'metrics',message:i.message}));return result;}
    const transformed=transformData(filtered,dsl);
    const metricKeys=config.metrics.map(chartMetricKey);result.metricKeys=metricKeys;
    const typedKey=(v:unknown)=>JSON.stringify([typeof v,v]);
    const groups=new Map<string,{value:unknown;rank:number;rows:DataRecord[]}>();
    // 指标排序在原事实重新计算分类汇总，避免AVG及比率被系列切片二次求和。
    const ranked=config.sort.field==='dimension'?undefined:transformData(filtered,{...dsl,dimensions:{...dimensions,categories:dimensions.categories.filter(f=>f!==config.seriesField)}});
    const ranks=new Map(ranked?.data.map(r=>[typedKey(r[dim.field]),Number(r[config.sort.field])])||[]);
    for(const r of transformed.data){const key=typedKey(r[dim.field]);const group=groups.get(key)||{value:r[dim.field],rank:ranks.get(key)??0,rows:[]};group.rows.push(r);groups.set(key,group);}
    const sorted=[...groups.values()].sort((a,b)=>{const n=config.sort.field==='dimension'?typeof a.value==='number'&&typeof b.value==='number'?a.value-b.value:String(a.value??'').localeCompare(String(b.value??''),'zh-CN',{numeric:true}):a.rank-b.rank;return n*(config.sort.order==='desc'?-1:1)||typedKey(a.value).localeCompare(typedKey(b.value));});
    const rows=sorted.slice(0,config.topN||sorted.length).flatMap(g=>g.rows);
    result.result={...transformed,data:rows,meta:{...transformed.meta,outputRows:rows.length}};
  }catch(error){result.valid=false;result.issues.push({path:'metrics',message:(error as Error).message});}
  return result;
}
