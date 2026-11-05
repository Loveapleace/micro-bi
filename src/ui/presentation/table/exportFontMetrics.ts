import { pixelsToPoints } from '../../../report/fontMetrics.js';

const pixelFontTables = new WeakSet<object>();
/** The official exporter copies fontSize verbatim; report canvases expose CSS pixels. */
export function registerPixelFontTable(table: object): void { pixelFontTables.add(table); }
export function usesPixelFonts(table: object): boolean { return pixelFontTables.has(table); }
export function exportedFontSize(table: object, size: number): number {
  return pixelFontTables.has(table) ? pixelsToPoints(size) : size;
}
