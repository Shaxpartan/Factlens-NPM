import type { HttpTransport } from "../http.js";
import type { Account } from "../types/index.js";

export class AccountResource {
  constructor(private readonly transport: HttpTransport) {}

  async get(): Promise<Account> {
    const body = await this.transport.request<{ account: Account }>("/v1/account", {
      method: "GET",
      auth: "management",
      timeout: 60_000,
    });
    return body.account;
  }
}
