import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePanelToCellTemplate, compileCellReport, expandCellDrivenTemplate, resolveCellFormatOptions } from '../dist/esm/report-template/index.js';
import { syncDocumentFromWorkbookSnapshot, extractStyleFromUniver } from '../dist/esm/cell-designer/syncWorkbookToTemplate.js';
import { sourceStyleToPublished, BORDER_STYLES, normalizeCellStyle } from '../dist/esm/report/cellStyle.js';
import { publishedStyleToUniver } from '../dist/esm/report/buildBiGrid.js';
import { formatExcelValue, numberFormatOptions } from '../dist/esm/report/numberFormat.js';
import { adaptPublishedSheetToVTable } from '../dist/esm/ui/presentation/report/gridAdapter.js';
import { mapPublishedStyleToVTable } from '../dist/esm/ui/presentation/report/styleAdapter.js';
import { unsupportedToolbarCommand, shouldBlockGuidedCommand } from '../dist/esm/cell-designer/guidedEditing.js';
import { isHybridHistoryCommand } from '../dist/esm/cell-designer/hybridHistory.js';
import { collectHybridExtras, mergeHybridCells, applyHybridFormatPreset } from '../dist/esm/cell-designer/hybridTemplateState.js';
import { createAdvancedCellDraft, buildAdvancedCellUpdate } from '../dist/esm/cell-designer/advancedCellState.js';
import { compileReport } from '../dist/esm/univer/compileReport.js';
import { setPresentation } from './helpers/presentation.mjs';

const facts=[{team:'A',day:'2026-08-01',qty:1234.56},{team:'A',day:'2026-08-02',qty:-25.3},{team:'B',day:'2026-08-01',qty:0}];
const panel=()=>compilePanelToCellTemplate({datasetId:'facts',dimensions:{categories:['team'],columnTimeBucket:{field:'day',granularity:'day'}},columns:[{type:'aggregated',field:'qty',agg:'sum'}]},'facts',{showRowTotals:true});
const qty=d=>d.cells.find(c=>c.id==='meas-qty');
function design(d){return {type:'detail',rowCount:40,colCount:20,merges:[],bindings:[],cells:d.cells.map(c=>({row:c.position.row,col:c.position.column,value:c.content.kind==='literal'?c.content.value:c.content.kind==='sheet-formula'?c.content.formula:`{${c.id}}`,displayText:c.content.kind==='literal'?String(c.content.value??''):`{${c.id}}`,sourceCellId:c.id,role:'custom',style:{...sourceStyleToPublished(c.style),format:resolveCellFormatOptions(c).numberFormat||resolveCellFormatOptions(c).format}}))};}
function capture(d,c,patch,base=design(d)){
  const g=base.cells.find(g=>g.sourceCellId===c.id),s=patch===null?null:{...publishedStyleToUniver(g.style),...patch};
  const snapshot={sheets:{'sheet-1':{cellData:{[g.row]:{[g.col]:{v:g.value,s,custom:{biProjection:true}}}}}}};
  return syncDocumentFromWorkbookSnapshot(d,snapshot,'design',base);
}
function published(d,data=facts){const r=compileCellReport(d,data);assert.equal(r.valid,true,JSON.stringify(r.diagnostics));return r.publication;}
function metric(p,value=1234.56){const c=p.sheets[0].cells.find(c=>c.v===value&&c.role==='metric-value');assert.ok(c);return {cell:c,style:p.styles[c.styleId]||{}};}

test('TB-01 underline and strike preserve on, off and JSON save without changing raw measures',()=>{
  for(const enabled of [1,0]){let d=panel();qty(d).style={...qty(d).style,underline:!enabled,strikethrough:!enabled};d=capture(d,qty(d),{ul:{s:enabled},st:{s:enabled}});d=JSON.parse(JSON.stringify(d));const p=published(d),m=metric(p);assert.equal(m.style.underline,!!enabled);assert.equal(m.style.strikethrough,!!enabled);assert.equal(m.cell.v,1234.56);const t=adaptPublishedSheetToVTable(p.sheets[0],p.styles);assert.equal(t.columns[m.cell.c].style({row:m.cell.r}).underline,!!enabled);assert.equal(t.columns[m.cell.c].style({row:m.cell.r}).lineThrough,!!enabled);}
});
test('TB-02 every native border style round-trips through neutral source without losing individual sides',()=>{
  for(let code=0;code<BORDER_STYLES.length;code++){const raw={bd:{t:{s:code,cl:{rgb:'#123456'}},r:{s:13,cl:{rgb:'#654321'}},b:{s:4,cl:{rgb:'#FF0000'}},l:{s:0,cl:{rgb:'#000000'}}}};const source=extractStyleFromUniver(raw),native=publishedStyleToUniver(sourceStyleToPublished(source));assert.equal(native.bd.t.s,code);assert.equal(native.bd.r.s,13);assert.equal(native.bd.b.s,4);assert.equal(native.bd.l.s,0);}
});
test('TB-03 VTable maps per-side colors, thickness and dash patterns and draws the second double line',()=>{
  let d=panel();d=capture(d,qty(d),{bd:{t:{s:7,cl:{rgb:'#123456'}},r:{s:13,cl:{rgb:'#654321'}},b:{s:4,cl:{rgb:'#FF0000'}},l:{s:0,cl:{rgb:'#000000'}}}});const p=published(d),{cell}=metric(p),t=adaptPublishedSheetToVTable(p.sheets[0],p.styles),s=t.columns[cell.c].style({row:cell.r});assert.deepEqual(s.borderLineWidth,[1,3,1,0]);assert.deepEqual(s.borderColor,['#123456','#654321','#FF0000','#000000']);assert.deepEqual(s.borderLineDash[2],[6,3]);assert.equal(t.columns[cell.c].customRender({row:cell.r,col:cell.c,rect:{width:100,height:30}}).elements[0].type,'line');
});
test('TB-04 clear format persists explicit defaults and General; binding, aggregation, values and formulas remain',()=>{
  let d=panel();const c=qty(d);c.style={...c.style,bold:true};d=capture(d,c,null);d=JSON.parse(JSON.stringify(d));const p=published(d),m=metric(p);assert.equal(m.style.bold,false);assert.equal(m.style.color,'#000000');assert.equal(m.style.align,'general');assert.equal(m.style.bgColor,undefined);assert.equal(m.cell.displayText,'1234.56');assert.equal(d.cells.find(x=>x.id===c.id).content.operation,'sum');assert.equal(d.cells.find(x=>x.id===c.id).content.fieldKey,'qty');assert.equal(mapPublishedStyleToVTable(m.style,m.cell.v).textAlign,'right');
});
test('TB-05 a native no-op snapshot does not manufacture source overrides or numeric defaults',()=>{
  const d=panel(),c=qty(d),next=capture(d,c,{});assert.deepEqual(next.styleRules,d.styleRules);assert.deepEqual(next.cells.find(x=>x.id===c.id).content,c.content);assert.equal(next.cells.find(x=>x.id===c.id).formatOptions,undefined);
});
test('TB-06 number formats support percent/currency/decimal/grouped/scientific/fractions while raw numbers remain',()=>{
  for(const [pattern,expected]of [['0.00%','123456.00%'],['¥#,##0.00','¥1,234.56'],['0.0','1234.6'],['#,##0','1,235'],['0.00E+00','1.23E+03'],['# ?/?','1234 5/9']]){const d=panel(),next=capture(d,qty(d),{n:{pattern}}),m=metric(published(next));assert.equal(m.cell.v,1234.56);assert.equal(m.cell.displayText,expected,pattern);assert.equal(m.style.format,pattern);}
});
test('TB-07 custom positive/negative/zero/text sections and format colors operate before condition rules',()=>{
  const pattern='[Green]0.0;[Red](0.0);"无产出";@';let d=panel();d=capture(d,qty(d),{n:{pattern}});const p=published(d);assert.equal(metric(p,-25.3).cell.displayText,'(25.3)');assert.equal(metric(p,-25.3).style.color,'#FF0000');assert.equal(metric(p,0).cell.displayText,'无产出');setPresentation(d,qty(d).id,{operator:'lt',threshold:0,text:'异常',style:{color:'#123456'}});assert.equal(metric(published(d),-25.3).cell.displayText,'异常');assert.equal(metric(published(d),-25.3).style.color,'#123456');
});
test('TB-08 date formats accept calendar strings and Excel serials without replacing source dates',()=>{
  const d=panel(),c=d.cells.find(c=>c.content.kind==='field'&&c.content.fieldKey==='day'),next=capture(d,c,{n:{pattern:'yyyy"年"mm"月"dd"日"'}}),p=published(next);assert.ok(p.sheets[0].cells.some(c=>c.v==='2026-08-01'&&c.displayText==='2026年08月01日'));assert.equal(formatExcelValue(46235,'yyyy-mm-dd'),'2026-08-01');assert.equal(next.cells.find(x=>x.id===c.id).content.timeBucket.granularity,'day');
});
test('TB-09 text identifiers and boolean values are not coerced by numeric formats',()=>{
  assert.equal(formatExcelValue('0012','0.00'),'0012');assert.equal(formatExcelValue(false,'0.00'),'false');assert.equal(formatExcelValue(true,'0%'),'true');
});
test('TB-10 formatting a sheet formula keeps both formula identity and raw result',()=>{
  let d=panel();const c={id:'formula',sheetId:'sheet-1',position:{row:19,column:9},parents:{row:'none',column:'none'},content:{kind:'sheet-formula',formula:'=SUM(C4:D4)'}};d.cells.push(c);d=capture(d,c,{n:{pattern:'0.0%'}});const p=published(d),cell=p.sheets[0].cells.find(x=>x.formula===c.content.formula);assert.ok(cell);assert.equal(d.cells.find(x=>x.id===c.id).content.formula,c.content.formula);assert.equal(cell.displayText,formatExcelValue(cell.v,'0.0%'));
});
test('TB-11 format painters may copy external styles into protected data but cannot copy raw values',()=>{
  const d=panel(),c=qty(d),selection={sheetId:'sheet-1',startRow:c.position.row,endRow:c.position.row,startColumn:c.position.column,endColumn:c.position.column};assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.command.set-range-values',params:{range:selection,value:{s:{ul:{s:1}}}}},selection),false);assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.command.set-range-values',params:{range:selection,value:{v:123}}},selection),true);
});
test('TB-12 toolbar commands share source history while activation and read-only commands do not create edits',()=>{
  for(const id of ['sheet.command.set-range-underline','sheet.command.set-range-strikethrough','sheet.command.set-border-basic','sheet.command.set-text-wrap','sheet.command.numfmt.set.percent','sheet.command.numfmt.set.numfmt','sheet.command.apply-format-painter','sheet.command.clear-selection-format'])assert.equal(isHybridHistoryCommand(id,0),true,id);
  for(const id of ['sheet.command.set-once-format-painter','sheet.command.set-infinite-format-painter','sheet.command.copy'])assert.equal(isHybridHistoryCommand(id,0),false,id);
});
test('TB-13 unsupported overflow, rotation and shrink commands are explicitly refused',()=>{
  for(const c of [{id:'sheet.command.set-text-wrap',params:{value:1}},{id:'sheet.command.set-text-rotation'},{id:'sheet.command.set-shrink-to-fit'}])assert.ok(unsupportedToolbarCommand(c));assert.equal(unsupportedToolbarCommand({id:'sheet.command.set-text-wrap',params:{value:2}}),undefined);assert.equal(unsupportedToolbarCommand({id:'sheet.command.set-text-wrap',params:{value:3}}),undefined);
});
test('TB-14 native formatting survives panel composition instead of being overwritten by previous extras',()=>{
  const panelDoc=panel(),c=qty(panelDoc),previous=[structuredClone(c)],next=capture(panelDoc,c,{n:{pattern:'0.000%'},ul:{s:1}});const extras=collectHybridExtras(next,panelDoc,previous,panelDoc,panelDoc),merged={...next,cells:mergeHybridCells(panelDoc,extras,panelDoc.cells)};assert.equal(merged.cells.find(x=>x.id===c.id).content.formatOptions.numberFormat,'0.000%');assert.equal(metric(published(merged)).cell.displayText,'123456.000%');
});
test('TB-15 advanced business scaling keeps toolbar patterns; ordinary format edits belong to the toolbar',()=>{
  let d=panel();d=capture(d,qty(d),{n:{pattern:'0.000%'}});const c=qty(d),draft=createAdvancedCellDraft(d,c);draft.format.precision=1;draft.dirtyFormat=['precision'];assert.throws(()=>buildAdvancedCellUpdate(d,c,draft,{fields:[{key:'qty',type:'number'}]}),/Excel 工具栏/);draft.format.precision=c.content.formatOptions.precision;draft.format.scale=1000;draft.dirtyFormat=['scale'];const u=buildAdvancedCellUpdate(d,c,draft,{fields:[{key:'qty',type:'number'}]});assert.equal(u.formatOptions.numberFormat,'0.000%');assert.equal(u.formatOptions.scale,1000);const next=applyHybridFormatPreset(c,'currency');assert.equal(next.content.formatOptions.numberFormat,undefined);assert.equal(next.content.format,'currency');
});
test('TB-16 data changes preserve source styles, number formats and unmerged static range rules',()=>{
  let d=panel();d=capture(d,qty(d),{n:{pattern:'#,##0.0'},ul:{s:1},bd:{t:{s:8,cl:{rgb:'#123456'}}}});d.cells.find(c=>c.id==='title').staticSpan.merge=false;const before=JSON.stringify(d);for(const data of [[...facts,{team:'C',day:'2026-09-01',qty:50}],[...facts].reverse(),facts.filter(f=>f.team!=='A'),[],facts]){published(d,data);assert.equal(JSON.stringify(d),before);assert.equal(d.cells.find(c=>c.id==='title').staticSpan.merge,false);}
});
test('TB-17 invalid format patterns and hidden static conditions block publication without compatibility conversion',()=>{
  const d=panel();qty(d).content.formatOptions={numberFormat:'['};assert.equal(compileCellReport(d,facts).valid,false);delete qty(d).content.formatOptions;setPresentation(d,'title',{threshold:5,text:'旧规则'});assert.ok(compileCellReport(d,facts).diagnostics.some(x=>x.code==='ERR_STATIC_CONDITION'));
});
test('TB-18 independent workbook compilation uses the same typed styles and number formatter',()=>{
  const s={ul:{s:1},st:{s:0},n:{pattern:'0.00%'},bd:{b:{s:8,cl:{rgb:'#123456'}}}};const p=compileReport({sheets:{'sheet-1':{id:'sheet-1',name:'sheet',cellData:{0:{0:{v:0.125,t:2,s},1:{v:0,t:3}}}}}}).publication;assert.equal(p.sheets[0].cells[0].displayText,'12.50%');assert.equal(p.sheets[0].cells[1].v,false);assert.equal(p.styles[p.sheets[0].cells[0].styleId].border.bottom.style,'medium');
});
test('TB-19 explicit font/background/border removals do not revive old source styling',()=>{
  let d=panel(),c=qty(d);d=capture(d,c,{bg:{rgb:'#123456'},cl:{rgb:'#ABCDEF'},ul:{s:1}});const projected=design(d),g=projected.cells.find(g=>g.sourceCellId===c.id);g.style={...g.style,bgColor:'#123456',color:'#ABCDEF',underline:true};d=capture(d,c,null,projected);const p=published(d),s=metric(p).style;assert.equal(s.bgColor,undefined);assert.equal(s.color,'#000000');assert.equal(s.underline,false);assert.deepEqual(normalizeCellStyle({}).border.top,{style:'none'});
});

test('TB-20 new native value plus style snapshot is captured atomically including formula, type and number pattern',()=>{
  const d=panel();
  const snapshot={sheets:{'sheet-1':{cellData:{
    19:{9:{v:46235,t:2,s:{n:{pattern:'yyyy-mm-dd'},ul:{s:1}}}},
    20:{9:{v:1350,f:'=SUM(C4:D4)',s:{n:{pattern:'#,##0.000'}}}},
  }}}};
  const s=syncDocumentFromWorkbookSnapshot(d,snapshot,'design',design(d));
  const p=published(s);
  assert.ok(p.sheets[0].cells.some(c=>c.v===46235&&c.displayText==='2026-08-01'));
  assert.ok(p.sheets[0].cells.some(c=>c.formula==='=SUM(C4:D4)'&&/\.\d{3}$/.test(c.displayText)));
  assert.equal(s.cells.find(c=>c.position.row===19&&c.position.column===9).style.underline,true);
});
test('TB-21 display-number conditions use the Excel pattern scale while formulas keep their original numeric input',()=>{
  const d=panel(),c=qty(d);c.content.formatOptions={numberFormat:'0.0%',format:'number',scale:1000};setPresentation(d,c.id,{predicate:{kind:'comparison',left:{kind:'current',basis:'display-number'},operator:'gt',right:{kind:'literal',value:100}},text:'达标'});const m=metric(published(d));assert.equal(m.cell.v,1234.56);assert.equal(m.cell.displayText,'达标');
});
test('TB-22 clearing normal format does not remove condition rules or change aggregation',()=>{
  const d=panel(),c=qty(d);setPresentation(d,c.id,{operator:'gt',threshold:1000,text:'达标',style:{color:'#123456'}});const next=capture(d,c,null),m=metric(published(next));assert.equal(m.cell.displayText,'达标');assert.equal(m.style.color,'#123456');assert.deepEqual(next.presentationRules,d.presentationRules);assert.equal(qty(next).content.operation,'sum');
});
test('TB-23 default General format has no invented precision and date buckets format at their calendar start',()=>{
  assert.equal(numberFormatOptions('General').precision,undefined);assert.equal(formatExcelValue('2026-Q3','yyyy-mm-dd'),'2026-07-01');assert.equal(formatExcelValue('2026-08-03 (第1周)','yyyy-mm-dd'),'2026-08-03');
});
test('TB-24 Excel pattern colors override ordinary font colors while conditional colors remain final',()=>{
  let d=panel();d=capture(d,qty(d),{n:{pattern:'0.0;[Red](0.0)'}});d.styleRules.push({id:'font',sheetId:'sheet-1',targetId:qty(d).id,scope:'template-cell',style:{color:'#123456'},priority:100});assert.equal(metric(published(d),-25.3).style.color,'#FF0000');setPresentation(d,qty(d).id,{operator:'lt',threshold:0,style:{color:'#654321'}});assert.equal(metric(published(d),-25.3).style.color,'#654321');
});
test('TB-25 custom double-border drawing is confined to double-border cells and never creates empty overlays',()=>{
  let d=panel();d=capture(d,qty(d),{bd:{t:{s:7,cl:{rgb:'#123456'}}}});const p=published(d),m=metric(p),t=adaptPublishedSheetToVTable(p.sheets[0],p.styles);assert.equal(t.columns[0].customRender,undefined);assert.equal(t.columns[m.cell.c].customRender({row:2,col:m.cell.c,rect:{width:100,height:30}}),undefined);assert.equal(t.columns[m.cell.c].customRender({row:m.cell.r,col:m.cell.c,rect:{width:100,height:30}}).renderDefault,true);
});

test('TB-26 new detail, grouped, hierarchical and pivot templates use General for metric cells', () => {
  const columns = [{ type: 'aggregated', field: 'qty', agg: 'sum' }];
  for (const dimensions of [{}, { categories: ['team'] },
    { categories: ['team'], timeBucket: { field: 'day', granularity: 'day' } },
    { categories: ['team'], columnTimeBucket: { field: 'day', granularity: 'day' } }]) {
    const doc = compilePanelToCellTemplate({ datasetId: 'facts', dimensions, columns }, 'facts', { showRowTotals: true });
    const measures = doc.cells.filter(c => c.content.kind === 'field' && ['measure', 'detail-column'].includes(c.content.role));
    assert.ok(measures.length);
    for (const c of measures) {
      assert.equal(c.style.textAlign, 'general', c.id);
      const native = publishedStyleToUniver(sourceStyleToPublished(c.style));
      assert.equal(native.ht, 0, c.id);
    }
    for (const c of doc.cells.filter(c => c.id === 'hdr-m-qty' || c.id === 'hdr-qty')) {
      assert.equal(publishedStyleToUniver(sourceStyleToPublished(c.style)).ht, 0);
    }
  }
});

test('TB-27 General preserves numeric types and right alignment in preview and publication including zero', () => {
  const doc = panel();
  const preview = expandCellDrivenTemplate(doc, facts).grid;
  const p = published(doc);
  for (const value of [1234.56, -25.3, 0]) {
    const previewCell = preview.cells.find(c => c.metricId === 'metric-qty' && c.value === value);
    assert.ok(previewCell);
    assert.equal(previewCell.style.align, 'general');
    assert.equal(publishedStyleToUniver(previewCell.style).ht, 0);
    const { cell, style } = metric(p, value);
    assert.equal(style.align, 'general');
    assert.equal(publishedStyleToUniver(style).ht, 0);
    assert.equal(typeof cell.v, 'number');
    const table = adaptPublishedSheetToVTable(p.sheets[0], p.styles);
    assert.equal(table.columns[cell.c].style({ row: cell.r }).textAlign, 'right');
  }
});

test('TB-28 native explicit alignment survives JSON save, panel refresh, sorting and changed data', () => {
  for (const [native, alignment] of [[0, 'general'], [1, 'left'], [2, 'center'], [3, 'right']]) {
    const original = panel();
    let edited = capture(original, qty(original), { ht: native });
    edited = JSON.parse(JSON.stringify(edited));
    const regenerated = panel();
    const extras = collectHybridExtras(edited, original, [], regenerated, original);
    edited.cells = mergeHybridCells(regenerated, extras, original.cells);
    const source = JSON.stringify(edited);
    for (const data of [facts, [...facts].reverse(), facts.filter(f => f.team === 'A'),
      [...facts, { team: 'C', day: '2026-08-03', qty: 10 }]]) {
      const { cell, style } = metric(published(edited, data));
      assert.equal(style.align, alignment);
      assert.equal(mapPublishedStyleToVTable(style, cell.v).textAlign, alignment === 'general' ? 'right' : alignment);
      assert.equal(JSON.stringify(edited), source);
    }
  }
});

test('TB-29 conditional text replacement retains General alignment based on the original number', () => {
  const doc = panel();
  setPresentation(doc, qty(doc).id, { operator: 'gt', threshold: 1000, text: '达标' });
  const { cell, style } = metric(published(doc));
  assert.equal(cell.v, 1234.56);
  assert.equal(cell.displayText, '达标');
  assert.equal(style.align, 'general');
  assert.equal(mapPublishedStyleToVTable(style, cell.v).textAlign, 'right');
});

test('TB-30 unstyled VTable cells use raw types rather than formatted or numeric-looking text', () => {
  const values = [0, -2, 1.25, '00123', '2026-08', '合计'];
  const sheet = { id: 'sheet-1', name: '类型', rowCount: 1, colCount: values.length,
    cells: values.map((v, c) => ({ r: 0, c, v, displayText: String(v) })), merges: [] };
  const table = adaptPublishedSheetToVTable(sheet, {});
  values.forEach((v, c) => {
    const expected = typeof v === 'number' ? 'right' : 'left';
    assert.equal(table.columns[c].style({ row: 0 }).textAlign, expected);
    assert.equal(mapPublishedStyleToVTable({ color: '#123456' }, v).textAlign, expected);
    assert.equal(table.rawRecords[0][`col_${c}`], v);
  });
  assert.equal(mapPublishedStyleToVTable({ align: 'center' }, 123).textAlign, 'center');
});
