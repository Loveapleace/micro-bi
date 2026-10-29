import test from 'node:test';
import assert from 'node:assert/strict';
import {createChartConfig,compileChart,validateChartConfig,chartFields} from '../dist/esm/chart/index.js';
import {buildChartSpec} from '../dist/esm/ui/presentation/charts/chartSpec.js';
import {resolveThemeConfig} from '../dist/esm/ui/presentation/theme.js';
const facts=[{id:1,shop:'A',team:'X',day:'2026-01-01',qty:10,bad:1},{id:2,shop:'A',team:'X',day:'2026-01-02',qty:30,bad:3},{id:3,shop:'A',team:'Y',day:'2026-02-01',qty:100,bad:5},{id:4,shop:'B',team:'X',day:'2026-02-02',qty:80,bad:6}];
const base=()=>({...createChartConfig('facts'),dimension:{field:'shop'},metrics:[{type:'aggregated',field:'qty',agg:'sum',label:'产量'}]});
const run=(c,data=facts)=>{const r=compileChart(c,data);assert.equal(r.valid,true,JSON.stringify(r.issues));return r;};
const spec=c=>buildChartSpec(c,run(c),resolveThemeConfig('light'));
test('CH-01 mode1 has a new tagged contract and does not read old table/panel documents',()=>{
  for(const c of [{columns:[]},{version:'1.0',analyses:[]},{kind:'cell-template'},null])assert.equal(validateChartConfig(c).valid,false);
  assert.equal(validateChartConfig({...base(),columns:[]}).valid,false);
});
test('CH-02 chart grouping uses fact measures and produces no column-pivot result',()=>{
  const r=run(base());assert.deepEqual(r.result.data.map(r=>[r.shop,r.qty]),[['A',140],['B',80]]);assert.equal(r.result.meta.isCrossTab,false);
});
test('CH-03 category and series form flat rows without dynamic metric field names',()=>{
  const c={...base(),seriesField:'team'},r=run(c);assert.equal(r.result.data.length,3);assert.equal(r.result.data.find(r=>r.shop==='A'&&r.team==='X').qty,40);assert.equal(r.metricKeys[0],'qty');assert.equal(r.result.columns.filter(c=>c.kind==='aggregated').length,1);
});
test('CH-04 time bucketing groups facts once for each month',()=>{
  const r=run({...base(),dimension:{field:'day',timeBucket:{granularity:'month'}}});assert.deepEqual(r.result.data.map(r=>[r.day,r.qty]),[['2026-01',40],['2026-02',180]]);
});
test('CH-05 AVG reflects raw record count',()=>{
  const c=base();c.metrics[0].agg='avg';assert.equal(run(c).result.data[0].qty,140/3);
});
test('CH-06 formula aggregates dependencies in the same category slice',()=>{
  const c=base();c.metrics.push({type:'computed',name:'ratio',label:'不良率',expression:'[SUM(bad)] / [SUM(qty)]',scope:'summary'});assert.equal(run(c).result.data[0].ratio,9/140);
});
test('CH-07 row-level formulas are aggregated from each fact',()=>{
  const c=base();c.metrics.push({type:'computed',name:'double',label:'双倍',expression:'[qty]*2',scope:'row'});assert.equal(run(c).result.data[0].double,280);
});
test('CH-08 formula syntax and missing references block rendering',()=>{
  for(const expression of ['[qty] +','[missing] / 2']){const c=base();c.metrics=[{type:'computed',name:'x',label:'x',expression}];assert.equal(compileChart(c,facts).valid,false);}
});
test('CH-09 filtering facts before grouping recomputes aggregates',()=>{
  const c={...base(),filters:[{id:'one',field:'qty',operator:'gte',value:30}]};const r=run(c);assert.equal(r.filteredRows,3);assert.equal(r.result.data[0].qty,130);
});
test('CH-10 empty/zero filter predicates are distinct',()=>{
  const data=[{shop:'A',qty:0},{shop:'B',qty:null},{shop:'C',qty:''}];const c=base();c.filters=[{id:'one',field:'qty',operator:'empty'}];assert.equal(run(c,data).filteredRows,2);c.filters=[{id:'one',field:'qty',operator:'eq',value:0}];assert.equal(run(c,data).filteredRows,1);
});
test('CH-11 top N retains every series of the selected category',()=>{
  const r=run({...base(),seriesField:'team',sort:{field:'qty',order:'desc'},topN:1});assert.equal(r.result.data.length,2);assert.ok(r.result.data.every(r=>r.shop==='A'));assert.equal(r.result.data.reduce((s,r)=>s+r.qty,0),140);
});
test('CH-12 top N by AVG reruns category aggregation instead of summing series averages',()=>{
  const c={...base(),seriesField:'team',sort:{field:'qty',order:'desc'},topN:1};c.metrics[0].agg='avg';assert.deepEqual(run(c).result.data.map(r=>r.shop),['B']);
});
test('CH-13 dimension sort order is reflected in plot domain',()=>{
  const c={...base(),sort:{field:'dimension',order:'desc'}},s=spec(c);assert.deepEqual(s.data[0].values.map(v=>v.__chart_xLabel__),['B','A']);assert.equal(s.axes[0].domain.length,2);
});
test('CH-14 pie configuration requires one metric and no series',()=>{
  const c={...base(),chartType:'pie',seriesField:'team'};assert.equal(validateChartConfig(c).valid,false);delete c.seriesField;c.metrics.push({type:'aggregated',field:'bad',agg:'sum'});assert.equal(validateChartConfig(c).valid,false);
});
test('CH-15 pie AVG values are not averaged or summed again by the renderer',()=>{
  const c={...base(),chartType:'pie'};c.metrics[0].agg='avg';assert.equal(spec(c).data[0].values[0].__chart_y__,140/3);
});
test('CH-16 pie omits nonpositive values without changing compiled values',()=>{
  const c={...base(),chartType:'pie'},r=run(c,[{shop:'A',qty:-1},{shop:'B',qty:2}]),s=buildChartSpec(c,r,resolveThemeConfig());assert.equal(s.data[0].values.length,1);assert.equal(r.result.data[0].qty,-1);
});
test('CH-17 explicit right axis and units survive projection',()=>{
  const c=base();c.metrics.push({type:'aggregated',field:'bad',agg:'sum',axis:'right',unit:'件'});const s=spec(c);assert.equal(s.type,'common');assert.equal(s.axes.filter(a=>a.orient==='right').length,1);assert.equal(s.data[1].values[0].__chart_y__,9);assert.equal(s.data[1].values[0].__chart_unit__,'件');
});
test('CH-18 label, palette and legend preferences use one derived spec',()=>{
  const c=base();c.appearance={...c.appearance,palette:['#123456'],labels:true,legend:false};const s=spec(c);assert.deepEqual(s.color,['#123456']);assert.equal(s.label.visible,true);assert.equal(s.legends.visible,false);
});
test('CH-19 stacked configuration rejects unsupported chart and mixed axes',()=>{
  const c=base();c.appearance.stacked=true;c.chartType='line';assert.equal(validateChartConfig(c).valid,false);c.chartType='bar';c.metrics[0].axis='right';assert.equal(validateChartConfig(c).valid,false);
});
test('CH-20 data insertion/deletion/reverse recomputes the same chart configuration',()=>{
  const c=base(),added=[...facts,{shop:'C',team:'Z',day:'2026-03-01',qty:11,bad:1}];assert.equal(run(c,added).result.data.length,3);assert.deepEqual(run(c,[...added].reverse()).result.data.map(r=>[r.shop,r.qty]),run(c,added).result.data.map(r=>[r.shop,r.qty]));assert.equal(run(c,added.filter(r=>r.shop!=='A')).result.data.length,2);
});
test('CH-21 ready-empty keeps a valid config using header schema and recovers',()=>{
  const c=base(),r=compileChart(c,[],{shop:'车间',qty:'数量'});assert.equal(r.valid,true);assert.equal(r.result.data.length,0);assert.equal(run(c).result.data.length,2);
});
test('CH-22 JSON save/reopen keeps exact new source and result',()=>{
  const c={...base(),seriesField:'team',topN:1};const saved=JSON.parse(JSON.stringify(c));assert.deepEqual(saved,c);assert.deepEqual(run(saved).result.data,run(c).result.data);
});
test('CH-23 invalid axes, duplicate metrics and unknown sort fields are diagnosed',()=>{
  for(const patch of [{seriesField:'shop'},{sort:{field:'missing',order:'asc'}},{metrics:[...base().metrics,...base().metrics]},{topN:0},{appearance:{...base().appearance,palette:['red']}}])assert.equal(validateChartConfig({...base(),...patch}).valid,false);
});
test('CH-24 source config and facts remain unchanged after compile and spec projection',()=>{
  const c=base(),before=structuredClone(c),data=structuredClone(facts);spec(c);run(c);assert.deepEqual(c,before);assert.deepEqual(data,facts);
});
test('CH-25 field profiling and explicit overrides are shared by panel and compiler',()=>{
  const fields=chartFields([{x:'123',day:'2026-01-01'}],{x:'编号'},{x:'text'});assert.equal(fields.find(f=>f.key==='x').type,'text');assert.equal(fields.find(f=>f.key==='day').type,'time');
});
test('CH-26 malformed new structures return diagnostics rather than throwing',()=>{
  for(const patch of [{metrics:null},{metrics:[null]},{dimension:null},{filters:null},{appearance:null},{sort:null}])assert.equal(compileChart({...base(),...patch},facts).valid,false);
});
test('CH-27 numeric-string filters follow detected numeric field types while keeping zero nonempty',()=>{
  const c={...base(),filters:[{id:'x',field:'qty',operator:'eq',value:1234}]};const r=run(c,[{shop:'A',qty:'1,234'},{shop:'B',qty:'0'},{shop:'C',qty:''}]);assert.equal(r.filteredRows,1);assert.equal(r.result.data[0].qty,1234);
});
test('CH-28 grouped bars have an explicit series band and right-axis measures become lines',()=>{
  const c={...base(),seriesField:'team'};assert.deepEqual(spec(c).xField,['__chart_x__','__chart_series__']);c.metrics.push({type:'aggregated',field:'bad',agg:'sum',axis:'right'});assert.equal(spec(c).series[1].type,'line');
});
test('CH-29 explicit text correction controls filter meaning without modifying numeric facts',()=>{
  const c={...base(),fieldTypes:{qty:'text'},filters:[{id:'x',field:'qty',operator:'eq',value:'10'}]};const r=run(c);assert.equal(r.filteredRows,1);assert.equal(facts[0].qty,10);
});
