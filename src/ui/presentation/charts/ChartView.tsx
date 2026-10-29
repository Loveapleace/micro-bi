import React, { useMemo } from 'react';
import { Alert, Empty } from 'antd';
import { compileChart } from '../../../chart/compileChart.js';
import type { ChartConfigV1, CompiledChart } from '../../../chart/types.js';
import type { DataRecord, HeaderMapping } from '../../../engine/types.js';
import type { ViewThemeConfig } from '../types.js';
import { resolveThemeConfig } from '../theme.js';
import { VChartView } from './VChartView.js';
import { buildChartSpec } from './chartSpec.js';

export interface ChartViewProps {
  config:ChartConfigV1;
  data:readonly DataRecord[];
  headers?:HeaderMapping | undefined;
  theme?:'light'|'dark'|ViewThemeConfig | undefined;
  height?:number | undefined;
  compiled?:CompiledChart | undefined;
}
export const ChartView:React.FC<ChartViewProps>=({config,data,headers,theme,height=380,compiled:provided})=>{
  const compiled=useMemo(()=>provided||compileChart(config,data,headers),[provided,config,data,headers]);
  const resolved=useMemo(()=>resolveThemeConfig(theme),[theme]);
  const spec=useMemo(()=>compiled.valid?buildChartSpec(config,compiled,resolved):undefined,[config,compiled,resolved]);
  if(!compiled.valid)return <Alert type="error" showIcon message="图表配置需要调整" description={compiled.issues.map(i=>i.message).join('；')}/>;
  if(!compiled.result.data.length)return <div style={{height,display:'grid',placeItems:'center'}}><Empty description="当前筛选下没有数据"/></div>;
  if(config.chartType==='pie'&&!compiled.result.data.some(r=>Number(r[compiled.metricKeys[0]||''])>0))return <Empty description="饼图没有可展示的正值"/>;
  return <VChartView viewType={config.chartType} result={compiled.result} dimensionField={compiled.dimensionField} activeMetrics={compiled.metricKeys} theme={resolved}
    vchartSpec={spec} specMode="replace" chartStyle={{height}}/>;
};
