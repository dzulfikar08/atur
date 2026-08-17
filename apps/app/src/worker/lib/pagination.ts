import type { Context } from "hono";
import type { Env } from "../lib/env";

export function paginationParams(c: Context<{ Bindings: Env }>) {
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  return { offset, limit };
}

export function paginatedResponse<T>(data: T[], total: number, offset: number, limit: number) {
  return {
    results: data,
    total,
    offset,
    limit,
    next_offset: offset + limit < total ? offset + limit : null,
  };
}

export function nowISO(): string {
  return new Date().toISOString();
}
