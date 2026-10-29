import { format, formatColor, getFormatInfo, isDateFormat, isValidFormat, dateToSerial } from 'numfmt';
import type { CellFormatOptions } from '../report-template/types.js';
import { dateComparable } from '../report-template/cellCapabilities.js';

export function isValidNumberFormat(pattern:unknown):pattern is string {
  return typeof pattern==='string'&&pattern.length>0&&pattern.length<=1024&&isValidFormat(pattern);
}
export function numberFormatOptions(pattern:string):Partial<CellFormatOptions>{
  const info=getFormatInfo(pattern);
  return {numberFormat:pattern,format:info.type==='percent'?'percent':info.type==='currency'?'currency':info.type==='general'?'default':info.isDate?'date':info.minDecimals===0?'integer':'number',
    precision:info.type==='general'||info.isDate||info.isText?undefined:Math.min(20,info.maxDecimals),useGrouping:info.type==='general'||info.isDate||info.isText?undefined:info.grouped===1,
    // 一次工具栏格式修改完整接管普通格式，避免前后缀、零值和负数又叠加一次。
    prefix:undefined,suffix:undefined,zeroDisplay:undefined,negativeFormat:undefined,dateFormat:undefined};
}
export function displayedNumber(value:number,options:CellFormatOptions):number{
  const multiplier=options.numberFormat?getFormatInfo(options.numberFormat).scale:['percent','percentage'].includes(options.format||'')?100:1;
  return value/(options.scale||1)*multiplier;
}
function excelValue(value:unknown,pattern:string):unknown{
  if(typeof value!=='string'||!isDateFormat(pattern))return value;
  const stamp=dateComparable(value);
  if(stamp===undefined)return value;
  const d=new Date(stamp);
  return dateToSerial([d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate(),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds()])??value;
}
export function formatExcelValue(value:unknown,pattern:string):string{
  if(value===null||value===undefined)return '';
  if(typeof value==='boolean')return String(value);
  return format(pattern,excelValue(value,pattern));
}
export function excelFormatColor(value:unknown,pattern:string|undefined):string|undefined{
  if(!pattern)return undefined;
  const c=formatColor(pattern,excelValue(value,pattern));
  const colors:Record<string,string>={black:'#000000',white:'#FFFFFF',red:'#FF0000',green:'#008000',blue:'#0000FF',yellow:'#FFFF00',magenta:'#FF00FF',cyan:'#00FFFF'};
  return typeof c==='string'?colors[c.toLowerCase()]||c:undefined;
}
