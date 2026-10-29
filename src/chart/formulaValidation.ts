import { extractReferencedFields, parseFormula } from '../engine/formula/parser.js';
import type { ComputedColumnConfig, FieldMeta } from '../engine/types.js';
export function validateAndParseFormula(metric:ComputedColumnConfig,fields?:readonly FieldMeta[]):string[]{
  try{
    const ast=parseFormula(metric.expression);
    const names=new Set(fields?.map(f=>f.key.toLowerCase()));
    return fields?extractReferencedFields(ast).map(field=>field.replace(/^(SUM|AVG|MIN|MAX|COUNT)\(\s*(.*?)\s*\)$/i,'$2')).filter(field=>!names.has(field.toLowerCase())).map(field=>`公式引用字段不存在：${field}`):[];
  }catch(error){return [(error as Error).message];}
}
