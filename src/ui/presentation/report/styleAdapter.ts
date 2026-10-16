/**
 * 报表样式转换适配器 (styleAdapter.ts)
 * 纯展示层映射，将 PublishedCellStyle 映射为 VTable 单元格样式配置。
 */
import type { PublishedCellStyle } from '../../../report/types.js';

export interface VTableCellStyleResult {
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
  borderColor?: string | undefined;
  borderLineWidth?: number | undefined;
}

export function mapPublishedStyleToVTable(
  style?: PublishedCellStyle
): VTableCellStyleResult {
  if (!style) return {};

  const res: VTableCellStyleResult = {};

  if (style.fontFamily) res.fontFamily = style.fontFamily;
  if (style.fontSize) res.fontSize = style.fontSize;
  if (style.bold) res.fontWeight = 'bold';
  if (style.italic) res.fontStyle = 'italic';
  if (style.underline) res.underline = true;
  if (style.strikethrough) res.lineThrough = true;
  if (style.color) res.color = style.color;
  if (style.bgColor) res.bgColor = style.bgColor;
  if (style.align) res.textAlign = style.align;

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
    const borderColor =
      style.border.top?.color ||
      style.border.bottom?.color ||
      style.border.left?.color ||
      style.border.right?.color;
    if (borderColor) {
      res.borderColor = borderColor;
      res.borderLineWidth = 1;
    }
  }

  return res;
}
