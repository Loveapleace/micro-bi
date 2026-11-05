/** Report font sizes follow Excel/Univer points; layout dimensions remain CSS pixels. */
export const DEFAULT_REPORT_FONT_PT = 11;
export const pointsToPixels = (points: number = DEFAULT_REPORT_FONT_PT): number =>
  (Number.isFinite(points) && points > 0 ? points : DEFAULT_REPORT_FONT_PT) * 96 / 72;
export const pixelsToPoints = (pixels: number): number => pixels * 72 / 96;
