import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repositories/workspaces", () => ({ findBySlug: vi.fn() }));
vi.mock("../../repositories/projects", () => ({
  create: vi.fn(),
  update: vi.fn(),
  identifierExists: vi.fn(),
  findById: vi.fn(),
}));
vi.mock("../states", () => ({
  seedSalesStates: vi.fn(),
  seedDefaultStates: vi.fn(),
}));

import * as projectService from "../projects";
import * as projectRepo from "../../repositories/projects";
import * as workspaceRepo from "../../repositories/workspaces";
import * as statesService from "../states";

const db = {} as any;
const WS = { id: "ws-1" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(workspaceRepo.findBySlug).mockResolvedValue(WS as any);
  vi.mocked(statesService.seedSalesStates).mockResolvedValue("lead-state" as any);
});

describe("create with is_pipeline", () => {
  it("stores the flag as 1 and seeds sales stages", async () => {
    vi.mocked(projectRepo.identifierExists).mockResolvedValue(false);
    vi.mocked(projectRepo.create).mockResolvedValue({ id: "p1" } as any);

    const data = projectService.createProjectSchema.parse({
      name: "Q4 Sales Pipeline",
      isPipeline: true,
    });
    await projectService.create(db, "ws", data);

    expect(projectRepo.create).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ isPipeline: 1, workspaceId: "ws-1" }),
    );
    expect(statesService.seedSalesStates).toHaveBeenCalledWith(db, "p1");
  });

  it("without the flag stores 0 and does NOT seed", async () => {
    vi.mocked(projectRepo.identifierExists).mockResolvedValue(false);
    vi.mocked(projectRepo.create).mockResolvedValue({ id: "p2" } as any);

    const data = projectService.createProjectSchema.parse({ name: "Website" });
    await projectService.create(db, "ws", data);

    expect(projectRepo.create).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ isPipeline: 0 }),
    );
    expect(statesService.seedSalesStates).not.toHaveBeenCalled();
  });
});

describe("identifier auto-derivation", () => {
  it("derives uppercase alnum from the name when absent", async () => {
    vi.mocked(projectRepo.identifierExists).mockResolvedValue(false);
    vi.mocked(projectRepo.create).mockResolvedValue({ id: "p3" } as any);

    const data = projectService.createProjectSchema.parse({ name: "Q4 Sales-Pipeline!" });
    await projectService.create(db, "ws", data);

    expect(projectRepo.create).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ identifier: "Q4SALESPIPEL" }),
    );
  });

  it("suffixes on collision, staying within 12 chars", async () => {
    // First probe (derived base) collides; the suffixed candidate is free.
    vi.mocked(projectRepo.identifierExists)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    vi.mocked(projectRepo.create).mockResolvedValue({ id: "p4" } as any);

    const data = projectService.createProjectSchema.parse({ name: "Sales" });
    await projectService.create(db, "ws", data);

    const identifier = vi.mocked(projectRepo.create).mock.calls[0][1].identifier;
    expect(identifier).toBe("SALES2");
    expect(identifier.length).toBeLessThanOrEqual(12);
  });
});

describe("update with is_pipeline", () => {
  it("converts the boolean to a 0/1 int and never seeds states", async () => {
    vi.mocked(projectRepo.findById).mockResolvedValue({
      id: "p1",
      workspaceId: "ws-1",
    } as any);
    vi.mocked(projectRepo.update).mockResolvedValue({ id: "p1", isPipeline: 1 } as any);

    const data = projectService.updateProjectSchema.parse({ isPipeline: true });
    await projectService.update(db, "ws", "p1", data);

    expect(projectRepo.update).toHaveBeenCalledWith(
      db,
      "p1",
      expect.objectContaining({ isPipeline: 1 }),
    );
    expect(statesService.seedSalesStates).not.toHaveBeenCalled();
    expect(statesService.seedDefaultStates).not.toHaveBeenCalled();
  });

  it("unflagging converts to 0", async () => {
    vi.mocked(projectRepo.findById).mockResolvedValue({
      id: "p1",
      workspaceId: "ws-1",
    } as any);
    vi.mocked(projectRepo.update).mockResolvedValue({ id: "p1" } as any);

    const data = projectService.updateProjectSchema.parse({ isPipeline: false });
    await projectService.update(db, "ws", "p1", data);

    expect(projectRepo.update).toHaveBeenCalledWith(
      db,
      "p1",
      expect.objectContaining({ isPipeline: 0 }),
    );
  });
});
