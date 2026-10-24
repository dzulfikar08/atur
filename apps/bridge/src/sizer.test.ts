import { describe, expect, test } from "bun:test";

import { clampGrid } from "./sizer";

describe("clampGrid", () => {
  test("accepts a phone grid and truncates fractions", () => {
    expect(clampGrid(56.9, 39.2)).toEqual({ cols: 56, rows: 39 });
  });

  test("refuses grids no terminal UI can use", () => {
    expect(clampGrid(10, 40)).toBeNull();
    expect(clampGrid(56, 2)).toBeNull();
    expect(clampGrid("x", 40)).toBeNull();
    expect(clampGrid(undefined, undefined)).toBeNull();
  });

  test("caps absurd sizes instead of allocating them", () => {
    expect(clampGrid(10_000, 10_000)).toEqual({ cols: 400, rows: 200 });
  });
});
