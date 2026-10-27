/** Section37：共享求值器的本机样本测量；不代替浏览器容量/滚动测试。先 npm run build。 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { applyPresentationRules } from '../dist/esm/report-template/presentationRules.js';
import { compileCellReport } from '../dist/esm/report-template/compileCellReport.js';

const root=resolve('doc/verification/conditional-rules-acceptance-2026-10-26');
const doc=JSON.parse(await readFile('examples/cell-reports/workshop-delivery-status-rules.json','utf8'));
const facts=JSON.parse(await readFile('test/fixtures/presentation-facts.json','utf8'));
const compiled=compileCellReport(doc,facts);
assert.equal(compiled.valid,true,JSON.stringify(compiled.diagnostics));
const published=compiled.publication.sheets[0].cells;
assert.deepEqual(['低产','关注','正常'].map(t=>published.filter(c=>c.displayText===t).length),[5,4,4]);
assert.equal(published.filter(c=>c.c===3&&typeof c.v==='number').reduce((s,c)=>s+c.v,0),10850);

const sources=doc.cells.filter(c=>c.content.kind==='field');
const cells=[];
for(let i=0;i<10000;i++)for(const [col,s]of sources.entries()){
  const value=facts[i%facts.length][s.content.fieldKey];
  cells.push({row:i+3,col,value,displayText:String(value),role:'custom',sourceCellId:s.id,regionId:s.regionId,style:{}});
}
const grid={type:'detail',cells,rowCount:10003,colCount:4,bindings:[],merges:[]};
const runs=[];
function measure(name,document,input){
  const t=performance.now(),out=applyPresentationRules(document,input);
  const elapsedMs=Number((performance.now()-t).toFixed(2));
  assert.equal(out.diagnostics.some(d=>d.severity==='error'),false);
  assert.ok(out.grid.ruleStatistics.every(s=>s.samples.length<=3));
  runs.push({name,elapsedMs,targets:out.grid.ruleStatistics[0].targets,statistics:out.grid.ruleStatistics.map(({samples,...s})=>({...s,sampleCount:samples.length}))});
  return out.grid;
}
const before=measure('initial-10000-rows',doc,grid);
const thresholdDoc=structuredClone(doc);thresholdDoc.presentationRules.revision++;
thresholdDoc.presentationRules.ruleSets[0].rules[0].predicate.children[0].right.value=500;
const changed=measure('threshold-only-700-to-500',thresholdDoc,before);
assert.ok(changed.cells.filter(c=>c.displayText==='低产').length<before.cells.filter(c=>c.displayText==='低产').length);
const updated={...grid,cells:grid.cells.map((c,i)=>i===3?{...c,value:1500,displayText:'1500'}:c)};
const after=measure('one-effective-value-update',doc,updated);
assert.equal(after.cells[3].value,1500);assert.equal(after.cells[3].displayText,'正常');
await mkdir(root,{recursive:true});
const result={environment:{node:process.version,platform:process.platform,architecture:process.arch},scope:'pure TypeScript resolver; 10000 records / 40000 cells / 3 rules; no browser capacity claim',example:{valid:true,statuses:[5,4,4],numericTotal:10850},runs};
await writeFile(resolve(root,'performance-and-example.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
