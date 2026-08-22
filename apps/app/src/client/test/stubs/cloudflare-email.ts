// Test stub for Cloudflare's `cloudflare:email` module. Outside the Workers
// runtime there is no EmailMessage binding — a plain data class is enough
// for unit tests (send paths without the binding never construct it anyway).
export class EmailMessage {
  constructor(
    public from: string,
    public to: string,
    public raw: string,
  ) {}
}
