// Real native API regression. No platform/backend writes; builds an isolated temporary harness.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'micro-bi-vtable-rendering-qa'));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'micro-bi-vtable-native-'));
const source = relative => JSON.stringify(path.join(root, relative).replaceAll('\\', '/'));
const entry = `
import { ListTable } from ${source('node_modules/@visactor/vtable/es/index.js')};
import { ReportTableRuntime } from ${source('src/ui/presentation/report/reportTableRuntime.ts')};
import { readCanvasViewport, observeCanvasViewport } from ${source('src/ui/presentation/report/canvasViewport.ts')};
const container=document.querySelector('#table'), wrapper=document.querySelector('#wrapper');
const calls={created:0,release:0,records:0,options:0,resize:0,density:0};
const runtime=new ReportTableRuntime(options=>{
  calls.created++;const table=new ListTable(container,options);
  for(const [method,key] of [['release','release'],['setRecords','records'],['updateOption','options'],['resize','resize'],['setPixelRatio','density']]){
    const original=table[method].bind(table);table[method]=(...args)=>{calls[key]++;return original(...args);};
  }
  return table;
});
runtime.updateViewport(readCanvasViewport(container));
const stop=observeCanvasViewport(container,view=>runtime.updateViewport(view));
let ids=Array.from({length:200},(_,i)=>i), version=0, font=11, color='#174EA6', columns=6;
function sheet(){return {id:'main',name:'Main',rowCount:ids.length+2,colCount:columns,defaultRowHeight:28,defaultColWidth:180,
  merges:[{startRow:0,endRow:0,startCol:0,endCol:columns-1}],
  cells:[{r:0,c:0,v:'动态报表标题 '+version,styleId:'title',sourceCellId:'title'},
    ...Array.from({length:columns},(_,c)=>({r:1,c,v:'字段'+c,styleId:'head',sourceCellId:'header-'+c})),
    ...ids.flatMap((id,index)=>Array.from({length:columns},(_,c)=>({r:index+2,c,v:c===0?'成员'+id:id*10+c,
      displayText:c===0?'成员'+id:'显示 '+(id*10+c+version),styleId:'data',sourceCellId:'metric-'+c,bindingId:'member-'+id+'-'+c})))
  ]};}
function apply(){runtime.apply('report',sheet(),{title:{fontSize:14,bold:true,align:'center',color:'#1677FF'},
  head:{fontSize:11,bold:true},data:{fontSize:font,color}});}
apply();const original=runtime.table;
window.qa={runtime,calls,original,container,wrapper,readCanvasViewport,
  apply:change=>{if(change.ids)ids=change.ids;if(change.version!==undefined)version=change.version;
    if(change.font)font=change.font;if(change.color)color=change.color;if(change.columns)columns=change.columns;apply();},
  detail:()=>runtime.apply('report',{id:'detail',name:'Detail',rowCount:70,colCount:2,defaultRowHeight:28,
    cells:Array.from({length:70},(_,r)=>({r,c:0,v:'明细'+r,sourceCellId:'detail-'+r,bindingId:'detail-'+r})),merges:[]},{}),
  main:apply,dispose:()=>{stop();runtime.dispose();}};
`;
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(temporary, 'entry.ts'), entry);
await build({configFile:false,root,logLevel:'error',build:{outDir:path.join(temporary,'dist'),emptyOutDir:true,minify:false,
  lib:{entry:path.join(temporary,'entry.ts'),formats:['es'],fileName:()=> 'qa.js'}}});
const server=http.createServer(async(request,response)=>{
  if(request.url==='/qa.js') {response.setHeader('Content-Type','application/javascript');response.end(await fs.readFile(path.join(temporary,'dist','qa.js')));}
  else {response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<style>body{margin:0;background:#eee}#wrapper{margin:24px;transform-origin:0 0}#table{width:900px;height:440px;background:white}</style><div id="wrapper"><div id="table"></div></div><script type="module" src="/qa.js"></script>');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const page=await browser.newPage({viewport:{width:1280,height:800}}), errors=[], cases=[];
// Force the missing-event path; the full host smoke test also covers ordinary media events.
await page.addInitScript(()=>{
  const native=window.matchMedia.bind(window);
  window.matchMedia=query=>{
    const result=native(query);
    if(query.startsWith('(resolution:')){result.addEventListener=()=>{};result.removeEventListener=()=>{};}
    return result;
  };
});
page.on('pageerror',error=>errors.push(error.message));
const record=(name,result)=>cases.push({name,result});
const stable=async()=>assert.equal(await page.evaluate(()=>qa.runtime.table===qa.original&&!qa.original.isReleased),true);
try{
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.bringToFront();
  await page.waitForFunction(()=>window.qa?.runtime.table.rowCount===202);
  assert.ok(Math.abs(await page.evaluate(()=>qa.original.getCellStyle(1,2).fontSize)-44/3)<.001);
  await page.evaluate(()=>{qa.original.selectCell(1,2);qa.original.setScrollTop(500);qa.original.setScrollLeft(70);});
  const position=await page.evaluate(()=>({top:qa.original.scrollTop,left:qa.original.scrollLeft}));
  await page.evaluate(()=>qa.apply({ids:Array.from({length:200},(_,i)=>199-i),font:18,color:'#D4380D'}));
  await stable();
  const sorted=await page.evaluate(()=>({ranges:qa.original.getSelectedCellRanges(),top:qa.original.scrollTop,left:qa.original.scrollLeft,
    value:qa.original.getCellOriginValue(1,201),text:qa.original.getCellValue(1,201),font:qa.original.getCellStyle(1,201).fontSize,color:qa.original.getCellStyle(1,201).color,calls:{...qa.calls}}));
  assert.equal(sorted.ranges[0].start.row,201);assert.equal(sorted.top,position.top);assert.equal(sorted.left,position.left);
  assert.equal(sorted.font,24);assert.equal(sorted.color,'#D4380D');assert.equal(sorted.value,1);assert.equal(sorted.text,'显示 1');
  assert.equal(sorted.calls.records,1);record('native setRecords refreshes formats/styles and migrates the selected identity',sorted);
  await page.evaluate(()=>qa.apply({ids:Array.from({length:199},(_,i)=>199-i)}));
  assert.deepEqual(await page.evaluate(()=>qa.original.getSelectedCellRanges()),[]);await stable();
  record('deleting the selected business identity clears its selection',true);
  await page.evaluate(()=>qa.apply({version:7}));
  await page.waitForFunction(()=>qa.original.getCellValue(0,0)==='动态报表标题 7');
  assert.equal(await page.evaluate(()=>qa.original.getCellValue(1,2)),'显示 1998');await stable();
  record('same merged bounds refresh both the title and unmerged formatted values',true);
  await page.evaluate(()=>qa.apply({columns:8}));await page.waitForFunction(()=>qa.original.colCount===8);await stable();
  await page.evaluate(()=>qa.apply({columns:4}));await page.waitForFunction(()=>qa.original.colCount===4);await stable();
  record('adding/removing dynamic columns updates the existing native layout',true);
  await page.evaluate(()=>{qa.original.setScrollTop(280);qa.detail();});
  await page.waitForFunction(()=>qa.original.colCount===2);assert.equal(await page.evaluate(()=>qa.original.scrollTop),0);
  await page.evaluate(()=>{qa.original.setScrollTop(56);qa.main();});await page.waitForFunction(()=>qa.original.colCount===4);
  assert.equal(await page.evaluate(()=>qa.original.scrollTop),280);await stable();
  await page.evaluate(()=>qa.detail());assert.equal(await page.evaluate(()=>qa.original.scrollTop),56);
  await page.evaluate(()=>qa.main());record('source/detail tab switches retain independent scroll positions',true);
  await page.evaluate(()=>qa.wrapper.style.transform='scale(.875)');
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1.5,mobile:false});
  await page.waitForFunction(()=>Math.abs(qa.original.pixelRatio-1.3125)<.0001);
  const density=await page.evaluate(()=>({ratio:qa.original.pixelRatio,width:qa.original.canvas.width,cssWidth:parseFloat(qa.original.canvas.style.width),
    viewport:qa.readCanvasViewport(qa.container),calls:{...qa.calls}}));
  assert.ok(Math.abs(density.width-density.cssWidth*1.3125)<=1);await stable();record('fractional scale × DPR matches physical canvas pixels',density);
  for(let round=0;round<4;round++){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1.5,mobile:false});
    await page.evaluate(()=>qa.wrapper.style.transform='scale(.875)');
    await page.waitForFunction(()=>Math.abs(qa.original.pixelRatio-1.3125)<.0001);
    await page.evaluate(()=>qa.wrapper.style.transform='scale(1)');
    await page.waitForFunction(()=>Math.abs(qa.original.pixelRatio-1.5)<.0001);
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
    await page.waitForFunction(()=>Math.abs(qa.original.pixelRatio-1)<.0001,null,{timeout:5000});
  }
  record('fast DPR/transform round-trips do not leave the shared monitor at a stale density',true);
  await page.evaluate(()=>qa.wrapper.style.transform='scale(.875)');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1.5,mobile:false});
  await page.waitForFunction(()=>Math.abs(qa.original.pixelRatio-1.3125)<.0001);
  for(const dpr of [1,1.25,2,1.5]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:dpr,mobile:false});
    await page.waitForFunction(ratio=>Math.abs(qa.original.pixelRatio-ratio)<.0001,dpr*.875,{timeout:5000});
    await stable();
  }
  record('repeated fractional DPR changes recover even when resolution events are suppressed',true);
  await page.evaluate(()=>qa.wrapper.style.transform='rotate(15deg) scale(.875)');
  await page.waitForFunction(()=>Math.abs(qa.readCanvasViewport(qa.container).scaleX-.875)<.0001);
  assert.ok(Math.abs(await page.evaluate(()=>qa.original.pixelRatio)-1.3125)<.0001);
  await page.evaluate(()=>{qa.wrapper.style.transform='scale(.875)';qa.wrapper.style.zoom='1.25';});
  await page.waitForFunction(()=>Math.abs(qa.original.pixelRatio-1.640625)<.0001);await stable();record('rotation preserves density; CSS zoom participates in density',true);
  await page.evaluate(()=>{qa.wrapper.style.display='none';});await page.waitForTimeout(80);
  await page.evaluate(()=>qa.apply({version:9,ids:Array.from({length:40},(_,i)=>i)}));
  await page.evaluate(()=>qa.wrapper.style.display='block');
  await page.waitForFunction(()=>qa.original.getCellValue(0,0)==='动态报表标题 9'&&qa.original.tableNoFrameWidth>0);
  await stable();record('hidden update/reveal restores layout and the current data without remounting',true);
  await page.evaluate(()=>{qa.wrapper.style.zoom='';qa.wrapper.style.transform='scale(.875)';qa.apply({font:11,color:'#174EA6'});qa.original.setScrollTop(0);qa.original.setScrollLeft(0);});
  await page.waitForFunction(()=>Math.abs(qa.original.pixelRatio-1.3125)<.0001);
  await page.screenshot({path:path.join(output,'optimized-canvas.png')});
  const before=await page.evaluate(()=>({...qa.calls}));await page.evaluate(()=>qa.dispose());
  await page.evaluate(()=>{qa.wrapper.style.transform='scale(1.5)';qa.wrapper.style.width='600px';});await page.waitForTimeout(100);
  const after=await page.evaluate(()=>({...qa.calls}));assert.equal(after.release,1);assert.equal(after.density,before.density);assert.equal(after.resize,before.resize);
  record('unmount releases exactly once and detaches viewport observers',after);assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'native-runtime-checks.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),backend:'none',cases,pageErrors:errors},null,2)+'\n');
  console.log(JSON.stringify({passed:cases.length,output}));
}catch(error){
  console.error(JSON.stringify({cases,pageErrors:errors,state:await page.evaluate(()=>({ready:!!window.qa,text:document.body.innerText,
    visibility:document.visibilityState,focus:document.hasFocus(),dpr:window.devicePixelRatio,ratio:window.qa?.original.pixelRatio,
    appliedViewport:window.qa?.runtime.viewport,viewport:window.qa?.readCanvasViewport(qa.container),calls:window.qa?.calls})).catch(()=>null)}));
  throw error;
}finally{
  await browser.close();await new Promise(resolve=>server.close(resolve));
  const resolved=path.resolve(temporary),prefix=path.resolve(os.tmpdir())+path.sep;
  if(resolved.startsWith(prefix)&&path.basename(resolved).startsWith('micro-bi-vtable-native-'))await fs.rm(resolved,{recursive:true,force:true});
}
