import { targetForCell, emptyPresentationRules } from '../../dist/esm/report-template/presentationTypes.js';
/** 新模型测试夹具：显式指定目标和动作，不接收/转换历史条件结构。 */
export function setPresentation(doc, cellId, { operator='lt', threshold=90, style={}, text, scope='cell', predicate, rules, roles, targetKind='source' }={}) {
  const cell=doc.cells.find(c=>c.id===cellId);
  if(!cell)throw new Error('missing test source '+cellId);
  const model=emptyPresentationRules();
  model.ruleSets=[{id:'set-'+cellId,order:0,target:{...targetForCell(cell),kind:targetKind,...(roles?{roles}:{})},rules:rules||[{
    id:'rule-'+cellId,name:'test rule',enabled:true,order:0,predicate:predicate||{kind:'comparison',left:{kind:'current'},operator,right:{kind:'literal',value:threshold}},
    style:{scope,style},...(text!==undefined?{text}:{}),stopIfTrue:true,
  }]}];
  doc.presentationRules=model;
  return model;
}
