export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 24;
export const DEFAULT_FONT_SIZE = 11;
/** JetBrains Mono's advance width is 600/1000 em. */
export const CELL_WIDTH_EM = 0.6;
export const LINE_HEIGHT_EM = 1.35;

/** Pinch results land on half-point steps inside the allowed range. */
export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size * 2) / 2));
}

/** The size at which `cols` columns exactly fill `width` px, clamped. */
export function fitFontSize(width: number, cols: number): number {
  if (!(width > 0) || !(cols > 0)) return DEFAULT_FONT_SIZE;
  return clampFontSize(Math.floor((width / (cols * CELL_WIDTH_EM)) * 2) / 2);
}
