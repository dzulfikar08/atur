// Where "previous / next prompt" takes the terminal view. The list is inverted: scroll offset 0 is
// the bottom of the pane, and row index i (0 = newest) sits `pad + lineHeight * i` above it, so an
// absolute row (the numbering of `ScreenState.historyBase`) is `end - 1 - i`.

import { nextPrompt, previousPrompt, type ScreenState } from "./terminal-screen";

type RowsState = Pick<ScreenState, "history" | "historyBase" | "lines" | "prompts">;

export interface ViewGeometry {
  /** Distance of the view's bottom edge from the bottom of the content. */
  offset: number;
  viewport: number;
  lineHeight: number;
  /** Padding above and below the rows. */
  pad: number;
}

/** Offsets are fractional on some densities: a row clipped by this much still counts as in view. */
const TOP_SLACK = 2;
/** A jump that moves the view by less than this has not moved it. */
const MOVED = 1;

function rowCount(state: RowsState): number {
  return state.history.length + state.lines.length;
}

/** The absolute row of the first row wholly in view, counting from the top edge. */
export function topRow(state: RowsState, view: ViewGeometry): number {
  const count = rowCount(state);
  const edge = view.offset + view.viewport;
  const index = Math.floor((edge - view.pad + TOP_SLACK) / view.lineHeight) - 1;
  return state.historyBase + count - 1 - Math.min(Math.max(index, 0), Math.max(count - 1, 0));
}

/** The scroll offset that puts absolute `row` at the top edge, kept inside the content. */
export function offsetForTopRow(state: RowsState, row: number, view: ViewGeometry): number {
  const count = rowCount(state);
  const index = state.historyBase + count - 1 - row;
  const wanted = view.pad + view.lineHeight * (index + 1) - view.viewport;
  const furthest = Math.max(0, 2 * view.pad + view.lineHeight * count - view.viewport);
  return Math.min(Math.max(wanted, 0), furthest);
}

export type PromptPlan =
  | { kind: "scroll"; offset: number }
  | { kind: "bottom" }
  /** No prompt above in what is loaded, but older scrollback could hold one. */
  | { kind: "older" }
  | { kind: "none" };

/**
 * What a press of "previous prompt" / "next prompt" does. Previous: the nearest prompt above the
 * first row in view goes to the top; with none loaded, `older` says whether to read further back.
 * Next: the nearest prompt below that moves the view; one the end of the pane keeps from the top
 * (it would only scroll to the bottom) or that is already there means the bottom of the pane.
 */
export function planPrompt(
  direction: "previous" | "next",
  state: RowsState,
  view: ViewGeometry,
  older: boolean,
): PromptPlan {
  const top = topRow(state, view);
  if (direction === "previous") {
    const row = previousPrompt(state, top);
    if (row !== null) return { kind: "scroll", offset: offsetForTopRow(state, row, view) };
    return older ? { kind: "older" } : { kind: "none" };
  }
  let from = top;
  for (;;) {
    const row = nextPrompt(state, from);
    if (row === null) return { kind: "bottom" };
    const offset = offsetForTopRow(state, row, view);
    if (offset <= 0) return { kind: "bottom" };
    if (offset < view.offset - MOVED) return { kind: "scroll", offset };
    from = row;
  }
}
