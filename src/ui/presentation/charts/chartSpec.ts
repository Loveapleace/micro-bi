import type { ChartConfigV1, CompiledChart } from '../../../chart/types.js';
import { chartMetricKey } from '../../../chart/types.js';
import type { ResolvedThemeConfig } from '../theme.js';

/** 图表投影只读聚合数值；表头、合并、总计布局不进入VChart数据。 */
export function buildChartSpec(config:ChartConfigV1,compiled:CompiledChart,theme:ResolvedThemeConfig):any {
  const labels=new Map<string,string>(),dimensionKeys:string[]=[];
  const values=compiled.result.data.flatMap(row=>{
    const value=row[compiled.dimensionField],key=JSON.stringify([typeof value,value]);
    if(!labels.has(key)){labels.set(key,value===null||value===undefined?'(空值)':value===''?'(空字符串)':String(value));dimensionKeys.push(key);}
    return config.metrics.map(metric=>{const id=chartMetricKey(metric),raw=row[id],series=config.seriesField?row[config.seriesField]:undefined;
      const metricLabel=metric.label||id,seriesLabel=config.seriesField?String(series??'(空值)'):'';
      return {__chart_x__:key,__chart_xLabel__:labels.get(key),__chart_y__:typeof raw==='number'&&Number.isFinite(raw)?raw:null,
        __chart_metric__:id,__chart_name__:metricLabel,__chart_series__:config.seriesField?config.metrics.length>1?`${seriesLabel} · ${metricLabel}`:seriesLabel:metricLabel,
        __chart_axis__:metric.axis||'left',__chart_unit__:metric.unit||''};});
  });
  const palette=config.appearance.palette.length?config.appearance.palette:theme.chartPalette;
  const base:any={type:config.chartType,data:[{id:'chart-data',values}],color:palette,background:theme.colorBgContainer,
    legends:{visible:config.appearance.legend,orient:'top',position:'middle',item:{label:{style:{fill:theme.colorText}}}},
    tooltip:{visible:true,mark:{title:{value:(d:any)=>d.__chart_xLabel__},content:[{key:(d:any)=>d.__chart_series__,value:(d:any)=>d.__chart_y__===null?'—':`${d.__chart_y__}${d.__chart_unit__}`}]}},
    animation:false,animationAppear:false};
  const label={visible:config.appearance.labels,style:{fill:theme.colorText},formatMethod:(v:any,d:any)=>`${d?.__chart_y__??v}${d?.__chart_unit__||''}`};
  if(config.chartType==='pie')return {...base,valueField:'__chart_y__',categoryField:'__chart_xLabel__',outerRadius:0.82,
    data:[{id:'chart-data',values:values.filter(v=>v.__chart_y__!==null&&v.__chart_y__>0)}],label:{...label,position:'outside',formatMethod:(_v:any,d:any)=>`${d.__chart_xLabel__}: ${d.__chart_y__}${d.__chart_unit__}`}};
  const axes:any[]=[{orient:'bottom',type:'band',domain:dimensionKeys,label:{style:{fill:theme.colorTextSecondary},formatMethod:(v:string)=>labels.get(v)||v}},
    {orient:'left',type:'linear',nice:true,zero:config.chartType==='bar',label:{style:{fill:theme.colorTextSecondary}},grid:{visible:true,style:{stroke:theme.colorBorder}}}];
  const series=(axis:'left'|'right',dataId:string)=>{
    const type=axis==='right'&&config.chartType==='bar'?'line':config.chartType;
    return {type,id:axis,dataId,xField:type==='bar'&&!config.appearance.stacked?['__chart_x__','__chart_series__']:'__chart_x__',yField:'__chart_y__',seriesField:'__chart_series__',
      stack:config.appearance.stacked,label,...(type==='line'?{line:{style:{curveType:config.appearance.smooth?'monotone':'linear'}},point:{visible:true}}:{barMaxWidth:40})};
  };
  if(config.metrics.some(m=>m.axis==='right'))return {...base,type:'common',data:[{id:'left-data',values:values.filter(v=>v.__chart_axis__==='left')},{id:'right-data',values:values.filter(v=>v.__chart_axis__==='right')}],
    axes:[{...axes[0],seriesIndex:[0,1]},{...axes[1],seriesIndex:0},{orient:'right',type:'linear',seriesIndex:1,nice:true,label:{style:{fill:theme.colorTextSecondary}},grid:{visible:false}}],series:[series('left','left-data'),series('right','right-data')]};
  return {...base,...series('left','chart-data'),axes};
}
