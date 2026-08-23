import { beforeEach, describe, expect, it, vi } from "vitest";
import { HTTPException } from "hono/http-exception";

vi.mock("../../repositories/crm_activities", () => ({
  createActivity: vi.fn(),
  listByCustomer: vi.fn(),
  listByDeal: vi.fn(),
  touchContact: vi.fn(),
}));

import { recordActivity, listActivities } from "../crm_activities";
import * as activitiesRepo from "../../repositories/crm_activities";

const db = {} as any;
const WS = "ws-1";

const createActivityMock = vi.mocked(activitiesRepo.createActivity);
const listByCustomerMock = vi.mocked(activitiesRepo.listByCustomer);
const listByDealMock = vi.mocked(activitiesRepo.listByDeal);
const touchContactMock = vi.mocked(activitiesRepo.touchContact);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordActivity", () => {
  it("creates an activity and touches the contact rollup", async () => {
    createActivityMock.mockResolvedValue({ id: "a1" } as any);
    await recordActivity(db, WS, {
      customerId: "c1",
      type: "EMAIL",
      subject: "Hello",
      createdBy: "user-1",
    });
    expect(createActivityMock).toHaveBeenCalledWith(db, {
      workspaceId: WS,
      customerId: "c1",
      type: "EMAIL",
      subject: "Hello",
      createdBy: "user-1",
    });
    expect(touchContactMock).toHaveBeenCalledWith(db, "c1");
  });

  it("does not touch when only a deal is linked", async () => {
    createActivityMock.mockResolvedValue({ id: "a2" } as any);
    await recordActivity(db, WS, { dealId: "d1", type: "STAGE_CHANGE" });
    expect(touchContactMock).not.toHaveBeenCalled();
  });

  it("rejects an activity with no customer or deal", async () => {
    await expect(recordActivity(db, WS, { type: "NOTE" })).rejects.toThrow(HTTPException);
    expect(createActivityMock).not.toHaveBeenCalled();
  });
});

describe("listActivities", () => {
  it("lists by customer with pagination", async () => {
    listByCustomerMock.mockResolvedValue({ rows: [{ id: "a1" }], total: 1 } as any);
    const result = await listActivities(db, WS, { customerId: "c1", offset: 0, limit: 50 });
    expect(result.results).toHaveLength(1);
    expect(listByCustomerMock).toHaveBeenCalledWith(db, "c1", {
      customerId: "c1",
      offset: 0,
      limit: 50,
    });
  });

  it("lists by deal", async () => {
    listByDealMock.mockResolvedValue({ rows: [], total: 0 });
    await listActivities(db, WS, { dealId: "d1", offset: 0, limit: 50 });
    expect(listByDealMock).toHaveBeenCalledWith(db, "d1", { dealId: "d1", offset: 0, limit: 50 });
  });

  it("rejects without a customer or deal filter", async () => {
    await expect(listActivities(db, WS, { offset: 0, limit: 50 })).rejects.toThrow(HTTPException);
  });
});
