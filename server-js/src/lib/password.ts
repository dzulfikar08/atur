export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const encoder = new TextEncoder()
  const data = encoder.encode(password)

  const combined = new Uint8Array(data.length + salt.length)
  combined.set(data)
  combined.set(salt, data.length)

  const hashBuffer = await crypto.subtle.digest('SHA-256', combined)
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return `${hashHex}:${saltHex}`
}

export async function comparePassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts.length !== 2) return false

  const storedHash = parts[0]
  const saltHex = parts[1]
  const salt = new Uint8Array(saltHex.length / 2)
  for (let i = 0; i < salt.length; i++) {
    salt[i] = parseInt(saltHex.substring(i * 2, i * 2 + 2), 16)
  }

  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const combined = new Uint8Array(data.length + salt.length)
  combined.set(data)
  combined.set(salt, data.length)

  const hashBuffer = await crypto.subtle.digest('SHA-256', combined)
  const computedHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return computedHash === storedHash
}
