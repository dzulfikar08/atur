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

/** TerminalView's list padding: 6 px each side, 4 px top and bottom. */
const PAD_X = 12;
const PAD_Y = 8;
/** TerminalView sizes rows 3% wider than the grid (fallback glyph slack). */
const WIDTH_SLACK = 1.03;

/**
 * The terminal grid that fills a `width` × `height` view at `fontSize` with no
 * horizontal scrolling: what the pane is resized to on a phone.
 */
export function gridForViewport(
  width: number,
  height: number,
  fontSize: number,
): { cols: number; rows: number } {
  const cell = fontSize * CELL_WIDTH_EM * WIDTH_SLACK;
  const line = Math.round(fontSize * LINE_HEIGHT_EM);
  return {
    cols: Math.max(0, Math.floor((width - PAD_X) / cell)),
    rows: Math.max(0, Math.floor((height - PAD_Y) / line)),
  };
}
