import { z } from "zod";
import type { DbClient } from "../db/index";
import * as webhooksRepo from "../repositories/webhooks";
import { HTTPException } from "hono/http-exception";

export const createWebhookSchema = z.object({
  url: z.string().url(),
  secret: z.string().optional(),
  events: z.string().optional(),
});

export async function create(
  db: DbClient,
  workspaceId: string,
  data: z.infer<typeof createWebhookSchema>,
) {
  return webhooksRepo.create(db, { ...data, workspaceId });
}

export async function getById(db: DbClient, id: string) {
  const webhook = await webhooksRepo.findById(db, id);
  if (!webhook) throw new HTTPException(404, { message: "Webhook not found" });
  return webhook;
}

export async function list(db: DbClient, workspaceId: string) {
  return webhooksRepo.listByWorkspace(db, workspaceId);
}

export async function update(
  db: DbClient,
  id: string,
  data: Partial<z.infer<typeof createWebhookSchema>>,
) {
  const webhook = await webhooksRepo.findById(db, id);
  if (!webhook) throw new HTTPException(404, { message: "Webhook not found" });
  return webhooksRepo.update(db, id, data);
}

export async function remove(db: DbClient, id: string) {
  const webhook = await webhooksRepo.findById(db, id);
  if (!webhook) throw new HTTPException(404, { message: "Webhook not found" });
  await webhooksRepo.remove(db, id);
}
