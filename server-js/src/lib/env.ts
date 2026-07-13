export type Env = {
  DB: D1Database
  R2: R2Bucket
  ASSETS: Fetcher
  RATE_LIMIT?: KVNamespace
}
