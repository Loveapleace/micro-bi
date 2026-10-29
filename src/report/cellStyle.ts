import type { CellStyleDefinition } from '../report-template/types.js';
import type { BorderStyle, CellBorderConfig, PublishedCellStyle } from './types.js';

export const BORDER_STYLES = ['none','thin','hair','dotted','dashed','dash-dot','dash-dot-dot','double','medium','medium-dashed','medium-dash-dot','medium-dash-dot-dot','slant-dash-dot','thick'] as const;
export const BORDER_SIDES = ['top','right','bottom','left'] as const;
const sdkSides = {top:'t',right:'r',bottom:'b',left:'l'} as const;
export const EMPTY_BORDER: CellBorderConfig = {top:{style:'none'},right:{style:'none'},bottom:{style:'none'},left:{style:'none'}};
export const DEFAULT_CELL_STYLE: CellStyleDefinition = {fontFamily:'Arial',fontSize:11,bold:false,italic:false,underline:false,strikethrough:false,color:'#000000',textAlign:'general',verticalAlign:'middle',wrapText:false};

export function sourceStyleToPublished(s: CellStyleDefinition = {}): PublishedCellStyle {
  const {backgroundColor,textAlign,...rest}=s;
  return {...rest,...(backgroundColor!==undefined?{bgColor:backgroundColor}:{}),...(textAlign!==undefined?{align:textAlign}:{})};
}
export function publishedStyleToSource(s: PublishedCellStyle = {}): CellStyleDefinition {
  const {bgColor,align,format,...rest}=s;
  return {...rest,...(bgColor!==undefined?{backgroundColor:bgColor}:{}),...(align!==undefined?{textAlign:align}:{})};
}
export function normalizeCellStyle(style: CellStyleDefinition = {}): CellStyleDefinition {
  const color=(v:string|undefined)=>v?.startsWith('#')?v.toUpperCase():v;
  const border:CellBorderConfig={};
  for(const side of BORDER_SIDES){const b=style.border?.[side];border[side]=b?.style&&b.style!=='none'?{style:b.style,color:color(b.color)||'#000000'}:{style:'none'};}
  return {...DEFAULT_CELL_STYLE,...Object.fromEntries(Object.entries(style).filter(([,v])=>v!==undefined)),color:color(style.color)||'#000000',backgroundColor:color(style.backgroundColor),border};
}
/** 读取显式原生属性；完整默认值由normalizeCellStyle统一补齐，以便识别删除/清除。 */
export function readUniverStyle(s: any): CellStyleDefinition | undefined {
  if(!s||typeof s!=='object')return undefined;
  const style:CellStyleDefinition={};
  if(s.ff)style.fontFamily=s.ff;if(typeof s.fs==='number')style.fontSize=s.fs;
  for(const [native,key] of [['bl','bold'],['it','italic']] as const)if(s[native]===0||s[native]===1)style[key]=s[native]===1;
  for(const [native,key] of [['ul','underline'],['st','strikethrough']] as const)if(s[native]?.s===0||s[native]?.s===1)style[key]=s[native].s===1;
  if(s.cl?.rgb)style.color=s.cl.rgb;if(s.bg?.rgb)style.backgroundColor=s.bg.rgb;
  if(s.ht===0)style.textAlign='general';else if(s.ht>=1&&s.ht<=3)style.textAlign=(['left','center','right'] as const)[s.ht-1];
  if(s.vt>=1&&s.vt<=3)style.verticalAlign=(['top','middle','bottom'] as const)[s.vt-1];
  if(s.tb===3)style.wrapText=true;else if(s.tb===1||s.tb===2)style.wrapText=false;
  if(s.bd&&typeof s.bd==='object'){
    const border:CellBorderConfig={};
    for(const side of BORDER_SIDES){const value=s.bd[sdkSides[side]];if(value!==undefined)border[side]=value&&BORDER_STYLES[value.s]?{style:BORDER_STYLES[value.s],...(value.cl?.rgb?{color:value.cl.rgb}:{})}:{style:'none'};}
    if(Object.keys(border).length)style.border=border;
  }
  return Object.keys(style).length?style:undefined;
}
export function cellStyleToUniver(style: PublishedCellStyle): Record<string,unknown> {
  const s=normalizeCellStyle(publishedStyleToSource(style));
  const bd:Record<string,unknown>={};
  for(const side of BORDER_SIDES){const b=s.border?.[side];const code=BORDER_STYLES.indexOf(b?.style||'none');bd[sdkSides[side]]={s:Math.max(0,code),cl:{rgb:b?.color||'#000000'}};}
  return {ff:s.fontFamily,fs:s.fontSize,bl:s.bold?1:0,it:s.italic?1:0,ul:{s:s.underline?1:0},st:{s:s.strikethrough?1:0},cl:{rgb:s.color},bg:s.backgroundColor?{rgb:s.backgroundColor}:null,
    ht:{general:0,left:1,center:2,right:3}[s.textAlign!],vt:{top:1,middle:2,bottom:3}[s.verticalAlign!],tb:s.wrapText?3:2,bd};
}
export function borderWidth(border: BorderStyle | undefined): number {
  const s=border?.style;if(!s||s==='none')return 0;if(s==='hair')return 0.5;if(s==='thick')return 3;if(s.startsWith('medium'))return 2;return 1;
}
export function borderDash(border:BorderStyle|undefined): number[] {
  const s=border?.style||'none';if(s==='dotted')return [1,2];if(s.includes('dash-dot-dot'))return [6,2,1,2,1,2];if(s.includes('dash-dot'))return [6,2,1,2];if(s.includes('dashed'))return [6,3];return [];
}
