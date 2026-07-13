import { z } from 'zod'
import type { DbClient } from '../db/index'
import { hashPassword, comparePassword } from '../lib/password'
import { generateToken } from '../lib/token'
import * as usersRepo from '../repositories/users'
import { HTTPException } from 'hono/http-exception'

export const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(2).max(50),
  password: z.string().min(8).max(128),
})

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

export async function register(db: DbClient, data: z.infer<typeof registerSchema>) {
  const existing = await usersRepo.findByEmail(db, data.email)
  if (existing) {
    throw new HTTPException(409, { message: 'Email already registered' })
  }
  const passwordHash = await hashPassword(data.password)
  const token = generateToken()
  const user = await usersRepo.createUser(db, {
    email: data.email,
    username: data.username,
    passwordHash,
    token,
  })
  if (!user) throw new HTTPException(500, { message: 'Failed to create user' })
  return { user: { id: user.id, email: user.email, username: user.username }, token }
}

export async function login(db: DbClient, data: z.infer<typeof loginSchema>) {
  const user = await usersRepo.findByEmail(db, data.email)
  if (!user || !user.passwordHash) {
    throw new HTTPException(401, { message: 'Invalid email or password' })
  }
  const valid = await comparePassword(data.password, user.passwordHash)
  if (!valid) {
    throw new HTTPException(401, { message: 'Invalid email or password' })
  }
  const token = generateToken()
  await usersRepo.updateUser(db, user.id, { token })
  return { user: { id: user.id, email: user.email, username: user.username }, token }
}

export async function getProfile(db: DbClient, userId: string) {
  const user = await usersRepo.findById(db, userId)
  if (!user) throw new HTTPException(404, { message: 'User not found' })
  return { id: user.id, email: user.email, username: user.username }
}

