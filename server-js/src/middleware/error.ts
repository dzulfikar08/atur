import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'

export async function errorMiddleware(_c: Context, next: Next) {
  try {
    await next()
  } catch (err) {
    if (err instanceof HTTPException) {
      throw err
    }
    console.error('Unhandled error:', err)
    throw new HTTPException(500, { message: 'Internal server error' })
  }
}

export function notFoundHandler(c: Context) {
  return c.json({ error: 'Not found' }, 404)
}
