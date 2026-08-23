import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repositories/customers", () => ({
  getContact: vi.fn(),
  updateContact: vi.fn(),
  markEmailSent: vi.fn(),
}));
vi.mock("../../repositories/crm_email_log", () => ({
  logSend: vi.fn(),
  listByCustomer: vi.fn(),
}));
vi.mock("../../repositories/crm_email_variants", () => ({ resolveVariant: vi.fn() }));
vi.mock("../../repositories/deals", () => ({
  listByCustomer: vi.fn(),
}));
vi.mock("../../repositories/supportTickets", () => ({
  listByCustomer: vi.fn(),
}));
vi.mock("../../repositories/crm_activities", () => ({
  listByCustomer: vi.fn(),
}));
vi.mock("../../repositories/contact_facts", () => ({
  listFacts: vi.fn(),
}));
vi.mock("../../repositories/companies", () => ({
  getCompany: vi.fn(),
}));
vi.mock("../crm_activities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  recordActivity: vi.fn(),
}));
vi.mock("../email", () => ({
  sendCustomerEmail: vi.fn(),
}));

import { getContact, updateContact, sendTemplateEmail } from "../crm";
import * as customersRepo from "../../repositories/customers";
import * as emailLogRepo from "../../repositories/crm_email_log";
import * as supportTicketsRepo from "../../repositories/supportTickets";
import * as activitiesRepo from "../../repositories/crm_activities";
import * as factsRepo from "../../repositories/contact_facts";
import * as companiesRepo from "../../repositories/companies";
import * as activitiesService from "../crm_activities";
import * as emailService from "../email";
import * as emailVariantsRepo from "../../repositories/crm_email_variants";

const db = {} as any;
const WS = "ws-1";

const getContactMock = vi.mocked(customersRepo.getContact);
const updateContactMock = vi.mocked(customersRepo.updateContact);
const markEmailSentMock = vi.mocked(customersRepo.markEmailSent);
const logSendMock = vi.mocked(emailLogRepo.logSend);
const recordActivityMock = vi.mocked(activitiesService.recordActivity);
const listActivitiesMock = vi.mocked(activitiesRepo.listByCustomer);
const listFactsMock = vi.mocked(factsRepo.listFacts);
const getCompanyMock = vi.mocked(companiesRepo.getCompany);
const sendCustomerEmailMock = vi.mocked(emailService.sendCustomerEmail);

const CONTACT = {
  id: "c1",
  workspaceId: WS,
  companyId: "comp1",
  email: "a@b.com",
  name: "Ada",
  lastEmailAt: null,
};

const WS_ROW = { id: WS, slug: "acme", emailFooter: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getContact enrichment payload", () => {
  it("includes company, activities, facts, and suggestions", async () => {
    getContactMock.mockResolvedValue(CONTACT as any);
    vi.mocked((await import("../../repositories/deals")).listByCustomer).mockResolvedValue([]);
    vi.mocked(supportTicketsRepo.listByCustomer).mockResolvedValue({ rows: [], total: 0 });
    vi.mocked(emailLogRepo.listByCustomer).mockResolvedValue([]);
    getCompanyMock.mockResolvedValue({ id: "comp1", name: "Acme" } as any);
    listActivitiesMock.mockResolvedValue({ rows: [{ id: "a1" }], total: 1 } as any);
    listFactsMock.mockResolvedValue({ rows: [{ id: "f1" }], total: 1 } as any);

    const result = await getContact(db, WS, "c1");

    expect(result.company).toEqual({ id: "comp1", name: "Acme" });
    expect(result.activities).toHaveLength(1);
    expect(result.facts).toHaveLength(1);
    expect(result.suggestions).toHaveLength(1);
    expect(listFactsMock).toHaveBeenCalledWith(db, WS, {
      customerId: "c1",
      status: "PROPOSED",
      offset: 0,
      limit: 10,
    });
  });
});

describe("updateContact enrichment fields", () => {
  it("translates snake_case wire keys to repo patch", async () => {
    updateContactMock.mockResolvedValue({ id: "c1" } as any);
    await updateContact(db, WS, "c1", {
      title: "CEO",
      seniority: "executive",
      linkedin_url: "https://linkedin.com/in/x",
      company_id: "comp1",
    });
    expect(updateContactMock).toHaveBeenCalledWith(
      db,
      WS,
      "c1",
      expect.objectContaining({
        title: "CEO",
        seniority: "executive",
        linkedinUrl: "https://linkedin.com/in/x",
        companyId: "comp1",
      }),
    );
  });
});

describe("sendTemplateEmail activity emission", () => {
  it("records an EMAIL activity on the contact timeline after sending", async () => {
    getContactMock.mockResolvedValue(CONTACT as any);
    vi.mocked(emailVariantsRepo.resolveVariant).mockResolvedValue(null);
    logSendMock.mockResolvedValue(undefined);
    markEmailSentMock.mockResolvedValue(undefined);
    recordActivityMock.mockResolvedValue({ id: "a1" } as any);
    sendCustomerEmailMock.mockResolvedValue({ sent: true } as any);

    const result = await sendTemplateEmail(
      db,
      {} as any,
      WS_ROW as any,
      "c1",
      { purpose: "welcome" },
      "user-1",
    );

    expect(result.sent).toBe(true);
    expect(recordActivityMock).toHaveBeenCalledWith(db, WS, {
      customerId: "c1",
      type: "EMAIL",
      subject: expect.any(String),
      body: "welcome",
      createdBy: "user-1",
    });
    expect(markEmailSentMock).toHaveBeenCalledWith(db, "c1");
  });
});
