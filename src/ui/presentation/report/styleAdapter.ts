/**
 * 报表样式转换适配器 (styleAdapter.ts)
 * 纯展示层映射，将 PublishedCellStyle 映射为 VTable 单元格样式配置。
 */
import type { PublishedCellStyle } from '../../../report/types.js';
import { BORDER_SIDES, borderWidth, borderDash } from '../../../report/cellStyle.js';

export interface VTableCellStyleResult {
  padding?: [number,number,number,number] | undefined;
  fontFamily?: string | undefined;
  fontSize?: number | undefined;
  fontWeight?: string | number | undefined;
  fontStyle?: string | undefined;
  underline?: boolean | undefined;
  lineThrough?: boolean | undefined;
  color?: string | undefined;
  bgColor?: string | undefined;
  textAlign?: 'left' | 'center' | 'right' | undefined;
  textBaseline?: 'top' | 'middle' | 'bottom' | undefined;
  autoWrapText?: boolean | undefined;
  textOverflow?: string | undefined;
  borderColor?: string | string[] | undefined;
  borderLineWidth?: number | number[] | undefined;
  borderLineDash?: number[][] | undefined;
}

export function mapPublishedStyleToVTable(
  style: PublishedCellStyle = {}, value?: unknown
): VTableCellStyleResult {
  const alignment = style.align ?? 'general';
  // 与中性网格的自动行高估算使用同一内边距，避免24号换行文本被主题默认大边距截断。
  const res: VTableCellStyleResult = {
    padding: [4, 6, 4, 6], fontFamily: 'Arial', fontSize: 11,
    textOverflow: 'clip', textBaseline: 'middle',
    // 以原值类型判断，格式化文本和条件文案不会把数值误判为文本。
    textAlign: alignment === 'general' ? (typeof value === 'number' ? 'right' : 'left') : alignment,
  };

  if (style.fontFamily) res.fontFamily = style.fontFamily;
  if (style.fontSize) res.fontSize = style.fontSize;
  if (style.bold !== undefined) res.fontWeight = style.bold ? 'bold' : 'normal';
  if (style.italic !== undefined) res.fontStyle = style.italic ? 'italic' : 'normal';
  if (style.underline!==undefined) res.underline = style.underline;
  if (style.strikethrough!==undefined) res.lineThrough = style.strikethrough;
  if (style.color) res.color = style.color;
  if (style.bgColor) res.bgColor = style.bgColor;

  if (style.verticalAlign) {
    res.textBaseline =
      style.verticalAlign === 'top'
        ? 'top'
        : style.verticalAlign === 'bottom'
        ? 'bottom'
        : 'middle';
  }

  if (style.wrapText !== undefined) {
    res.autoWrapText = style.wrapText;
  }

  // 边框映射
  if (style.border) {
    res.borderColor=BORDER_SIDES.map(side=>style.border?.[side]?.color||'#000000');
    res.borderLineWidth=BORDER_SIDES.map(side=>borderWidth(style.border?.[side]));
    res.borderLineDash=BORDER_SIDES.map(side=>borderDash(style.border?.[side]));
  }

  return res;
}
