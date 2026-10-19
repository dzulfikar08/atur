import { beforeEach, describe, expect, it, vi } from "vitest";
import { HTTPException } from "hono/http-exception";

vi.mock("../../repositories/customers", () => ({
  getContact: vi.fn(),
  updateContact: vi.fn(),
  findByIdentity: vi.fn(),
}));

import { createContactSchema, updateContactSchema, updateContact } from "../crm";
import * as customersRepo from "../../repositories/customers";
import type { CustomerRow } from "../../repositories/customers";

const db = {} as Parameters<typeof updateContact>[0];
const WS = "ws-1";

function row(partial: Partial<CustomerRow>): CustomerRow {
  return partial as CustomerRow;
}

const getContactMock = vi.mocked(customersRepo.getContact);
const updateContactMock = vi.mocked(customersRepo.updateContact);
const findByIdentityMock = vi.mocked(customersRepo.findByIdentity);

beforeEach(() => {
  vi.clearAllMocks();
  findByIdentityMock.mockResolvedValue(null);
  updateContactMock.mockResolvedValue(row({ id: "c1" }));
});

describe("threads_username input", () => {
  it.each([
    ["@JoyoRogo", "joyorogo"],
    ["joyo.rogo_", "joyo.rogo_"],
    ["https://www.threads.com/@Joyo.Rogo", "joyo.rogo"],
    ["https://www.threads.net/@joyorogo/post/DAbc?xmt=1", "joyorogo"],
  ])("normalizes %s to %s", (input, handle) => {
    expect(createContactSchema.parse({ threads_username: input }).threads_username).toBe(handle);
  });

  it("rejects a handle with characters Threads does not allow", () => {
    expect(createContactSchema.safeParse({ threads_username: "joyo rogo!" }).success).toBe(false);
  });

  it("creates a contact from a Threads handle alone, with a blank email", () => {
    const parsed = createContactSchema.parse({ email: "", threads_username: "@joyorogo" });
    expect(parsed).toMatchObject({ email: null, threads_username: "joyorogo" });
  });

  it("requires email or a Threads handle", () => {
    expect(createContactSchema.safeParse({ name: "No identity" }).success).toBe(false);
    expect(createContactSchema.safeParse({ email: "", threads_username: "" }).success).toBe(false);
  });

  it("treats a blank handle on update as clearing it", () => {
    expect(updateContactSchema.parse({ threads_username: "  " }).threads_username).toBeNull();
  });
});

describe("updateContact identity guards", () => {
  it("refuses to clear the last identity key", async () => {
    getContactMock.mockResolvedValue(row({ id: "c1", email: null, threadsUsername: "joyorogo" }));
    await expect(
      updateContact(db, WS, "c1", updateContactSchema.parse({ threads_username: "" })),
    ).rejects.toMatchObject({ status: 400 });
    expect(updateContactMock).not.toHaveBeenCalled();
  });

  it("allows clearing the handle when an email remains", async () => {
    getContactMock.mockResolvedValue(
      row({ id: "c1", email: "a@b.co", threadsUsername: "joyorogo" }),
    );
    await updateContact(db, WS, "c1", updateContactSchema.parse({ threads_username: "" }));
    expect(updateContactMock).toHaveBeenCalledWith(
      db,
      WS,
      "c1",
      expect.objectContaining({ threadsUsername: null }),
    );
  });

  it("returns 409 when another contact already has the handle", async () => {
    getContactMock.mockResolvedValue(row({ id: "c1", email: "a@b.co", threadsUsername: null }));
    findByIdentityMock.mockResolvedValue(row({ id: "c2", name: "Sari", threadsUsername: "sari" }));
    const err = await updateContact(
      db,
      WS,
      "c1",
      updateContactSchema.parse({ threads_username: "@Sari" }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HTTPException);
    expect((err as HTTPException).status).toBe(409);
    expect(findByIdentityMock).toHaveBeenCalledWith(db, WS, { threadsUsername: "sari" });
    expect(updateContactMock).not.toHaveBeenCalled();
  });

  it("lets a contact keep its own handle", async () => {
    getContactMock.mockResolvedValue(row({ id: "c1", email: null, threadsUsername: "sari" }));
    findByIdentityMock.mockResolvedValue(row({ id: "c1", threadsUsername: "sari" }));
    await updateContact(db, WS, "c1", updateContactSchema.parse({ threads_username: "sari" }));
    expect(updateContactMock).toHaveBeenCalled();
  });
});
