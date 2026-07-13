// Converts all JSON response keys to snake_case so the frontend (which consumes
// the Rust worker's snake_case API) sees the field names it expects, e.g.
// descriptionHtml -> description_html, stateId -> state_id.
import type { Context, Next } from 'hono'

function toSnake(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

function convert(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(convert)
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[toSnake(k)] = convert(v)
    }
    return out
  }
  return obj
}

export async function snakeCaseMiddleware(c: Context, next: Next) {
  await next()
  const ct = c.res.headers.get('Content-Type') || ''
  if (!ct.includes('application/json')) return
  const text = await c.res.text()
  if (!text) return
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return
  }
  const body = JSON.stringify(convert(data))
  const headers = new Headers(c.res.headers)
  headers.delete('Content-Length')
  headers.delete('Content-Encoding')
  c.res = new Response(body, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers,
  })
}
