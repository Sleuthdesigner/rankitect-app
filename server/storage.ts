import type { Project, InsertProject } from "@shared/schema";

export interface IStorage {
  createProject(data: InsertProject): Promise<Project>;
  getProject(id: number): Promise<Project | undefined>;
  updateProject(id: number, data: Partial<Project>): Promise<Project | undefined>;
  listProjects(): Promise<Project[]>;
}

export class MemStorage implements IStorage {
  private projects: Map<number, Project> = new Map();
  private nextId = 1;

  async createProject(data: InsertProject): Promise<Project> {
    const id = this.nextId++;
    const project: Project = {
      id,
      businessUrl: data.businessUrl,
      themeUrl: data.themeUrl ?? null,
      businessName: data.businessName ?? null,
      industry: data.industry ?? null,
      location: data.location ?? null,
      status: data.status ?? "pending",
      siteAnalysis: null,
      competitors: null,
      keywords: null,
      themeStructure: null,
      sopContent: null,
      createdAt: new Date(),
    };
    this.projects.set(id, project);
    return project;
  }

  async getProject(id: number): Promise<Project | undefined> {
    return this.projects.get(id);
  }

  async updateProject(id: number, data: Partial<Project>): Promise<Project | undefined> {
    const existing = this.projects.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.projects.set(id, updated);
    return updated;
  }

  async listProjects(): Promise<Project[]> {
    return Array.from(this.projects.values()).sort((a, b) => b.id - a.id);
  }
}

export const storage = new MemStorage();
