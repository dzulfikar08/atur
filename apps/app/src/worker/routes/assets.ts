import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware, extractToken, resolveRequestUser } from "../middleware/auth";
import * as assetsService from "../services/assets";
import { authorizeFeedbackAsset } from "../services/feedback_attachments";
import { HTTPException } from "hono/http-exception";
import { getCookie } from "hono/cookie";
import { PORTAL_COOKIE } from "../middleware/portalAuth";
import * as customersRepo from "../repositories/customers";
import * as membersRepo from "../repositories/members";

export const assetRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .post("/upload", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");

    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      throw new HTTPException(400, { message: "File is required" });
    }

    const entityId = formData.get("entityId") as string | null;
    const entityType = formData.get("entityType") as string | null;

    const result = await assetsService.upload(
      db,
      c.env,
      user.sub,
      file,
      entityId ?? undefined,
      entityType ?? undefined,
    );
    return c.json(result, 201);
  })
  .get("/:id", async (c) => {
    const db = getDb(c.env.DB);
    const id = c.req.param("id")!;

    // Resolve the requester: a main-app user (API key or session token) or,
    // failing that, a portal customer (portal-session cookie). Asset IDs are
    // NOT public — anonymous requests are rejected.
    const token = extractToken(c);
    let userId: string | null = null;
    if (token) {
      const u = await resolveRequestUser(db, token);
      if (u) userId = u.id;
    }
    let customer: customersRepo.CustomerRow | null = null;
    if (!userId) {
      const portalToken = getCookie(c, PORTAL_COOKIE);
      if (portalToken) customer = await customersRepo.findBySessionToken(db, portalToken);
    }
    if (!userId && !customer) {
      throw new HTTPException(401, { message: "Authentication required" });
    }

    // Feedback attachments (widget / native uploads, created by the feedback
    // bot) have their own rule: workspace members, or the customer who filed the
    // issue they're attached to. null = not a feedback attachment.
    const feedbackAccess = await authorizeFeedbackAsset(
      db,
      id,
      customer
        ? {
            kind: "customer",
            customerId: customer.id,
            workspaceId: customer.workspaceId,
            email: customer.email,
          }
        : {
            kind: "member",
            isMember: (workspaceId) => membersRepo.isWorkspaceMember(db, workspaceId, userId!),
          },
    );
    if (feedbackAccess === false) throw new HTTPException(403, { message: "Forbidden" });

    const result = await assetsService.getAsset(db, c.env, id);
    const ownerId = result.asset.createdById;

    if (feedbackAccess === null) {
      // Authorize. Assets are either portal-uploaded (owner is a customer) or
      // internal (owner is a workspace user).
      const ownerCustomer = await customersRepo.findById(db, ownerId);
      if (customer) {
        if (ownerCustomer) {
          // Another customer's upload: only the owner may view it.
          if (ownerCustomer.id !== customer.id) {
            throw new HTTPException(403, { message: "Forbidden" });
          }
        } else {
          // Internal asset: allow only if its owner is a member of this
          // customer's workspace (support staff sharing in their ticket).
          const ok = await membersRepo.isWorkspaceMember(db, customer.workspaceId, ownerId);
          if (!ok) throw new HTTPException(403, { message: "Forbidden" });
        }
      } else if (ownerCustomer) {
        // Portal asset requested by a main-app user: allow only for members of
        // the owning customer's workspace.
        const ok = await membersRepo.isWorkspaceMember(db, ownerCustomer.workspaceId, userId!);
        if (!ok) throw new HTTPException(403, { message: "Forbidden" });
      }
      // Internal asset requested by a main-app user: allowed.
    }

    // On-the-fly image optimization: when the client asks for a resized or
    // reformatted variant (?w=, ?format=webp), hand the image to Cloudflare's
    // edge Image Resizing via the header instead of serving the raw R2 bytes.
    // Works on any plan; the worker simply delegates the transform to the edge.
    const wants = c.req.query();
    const imgParams: string[] = [];
    if (wants.w) imgParams.push(`width=${Math.min(Number(wants.w) || 0, 4000)}`);
    if (wants.h) imgParams.push(`height=${Math.min(Number(wants.h) || 0, 4000)}`);
    if (wants.fit && ["scale-down", "contain", "cover", "crop", "pad"].includes(wants.fit))
      imgParams.push(`fit=${wants.fit}`);
    if (wants.q) imgParams.push(`quality=${Math.min(Math.max(Number(wants.q) || 0, 1), 100)}`);
    const format = wants.format === "webp" || wants.format === "avif" ? wants.format : "webp";
    if (imgParams.length > 0 && (result.contentType || "").startsWith("image/")) {
      const options = [...imgParams, `format=${format}`].join(",");
      c.header("Cloudflare-Image-Resizing", options);
    }
    // The stored type is untrusted (uploads come from users, portal customers
    // and API callers). Serve the TRUE stored MIME — <img> refuses to render
    // images labelled application/octet-stream (nosniff blocks them outright),
    // which broke every SVG workspace logo — and gate execution with
    // Content-Disposition instead: attachment forces a download on direct
    // navigation, so inline-SVG scripts never run on our origin. <img> embeds
    // ignore Content-Disposition, so svg and raster images still render.
    // Render-without-execution allowlist (inline) lives in serveInline.
    const storedType = assetsService.storedContentType(result.contentType);
    const inline = assetsService.serveInline(storedType);

    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Type", storedType);
    c.header("Content-Disposition", inline ? "inline" : "attachment");
    c.header("Content-Length", result.size?.toString() || "0");
    return c.body(result.body as ReadableStream);
  });
