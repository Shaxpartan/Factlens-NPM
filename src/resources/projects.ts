import type { HttpTransport } from "../http.js";
import type { Project, ProjectInput, RequestOptions } from "../types/index.js";

export class ProjectsResource {
  private selectedProjectId?: string;

  constructor(private readonly transport: HttpTransport) {}

  select(projectId: string) {
    const value = String(projectId ?? "").trim();
    if (!value) throw new TypeError("projectId is required.");
    this.selectedProjectId = value;
    return this;
  }

  selected() {
    return this.selectedProjectId;
  }

  async list(options?: RequestOptions): Promise<Project[]> {
    const body = await this.transport.request<{ projects: Project[] }>("/v1/projects", {
      method: "GET",
      auth: "management",
      timeout: 60_000,
      ...(options === undefined ? {} : { options }),
    });
    return body.projects;
  }

  async create(input: ProjectInput, options?: RequestOptions): Promise<Project> {
    const body = await this.transport.request<{ project: Project }>("/v1/projects", {
      method: "POST",
      auth: "management",
      body: input,
      timeout: 60_000,
      automaticRequestId: true,
      ...(options === undefined ? {} : { options }),
    });
    return body.project;
  }

  async update(projectId: string, input: ProjectInput, options?: RequestOptions): Promise<Project> {
    const body = await this.transport.request<{ project: Project }>(`/v1/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      auth: "management",
      body: input,
      timeout: 60_000,
      automaticRequestId: true,
      ...(options === undefined ? {} : { options }),
    });
    return body.project;
  }

  delete(projectId: string, options?: RequestOptions) {
    return this.transport.request<{ ok: boolean; project_id: string }>(`/v1/projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
      auth: "management",
      timeout: 60_000,
      automaticRequestId: true,
      ...(options === undefined ? {} : { options }),
    });
  }
}
