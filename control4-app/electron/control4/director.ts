// Local director HTTP client. The controller ships a self-signed cert, so we
// use a node:https Agent with rejectUnauthorized:false. This only reaches the
// configured LAN IP.

import * as https from "node:https";
import { URL } from "node:url";

export class Director {
  private readonly ip: string;
  private readonly bearer: string;
  private readonly agent: https.Agent;

  constructor(ip: string, directorBearerToken: string) {
    this.ip = ip;
    this.bearer = directorBearerToken;
    this.agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = new URL(path, `https://${this.ip}`);
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    return new Promise<T>((resolve, reject) => {
      const req = https.request(
        {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          method,
          agent: this.agent,
          headers: {
            Authorization: `Bearer ${this.bearer}`,
            Accept: "application/json",
            ...(payload
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(payload).toString(),
                }
              : {}),
          },
          timeout: 10000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              reject(
                new Error(
                  `Director ${method} ${path} -> ${status}: ${text.slice(0, 400)}`,
                ),
              );
              return;
            }
            if (!text) {
              resolve(undefined as T);
              return;
            }
            try {
              resolve(JSON.parse(text) as T);
            } catch (err) {
              reject(
                new Error(
                  `Director ${method} ${path}: invalid JSON (${(err as Error).message})`,
                ),
              );
            }
          });
        },
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy(new Error(`Director ${method} ${path}: timeout`));
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  async sendGet<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async sendCommand<T = unknown>(
    itemId: number,
    command: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    return this.request<T>("POST", `/api/v1/items/${itemId}/commands`, {
      async: true,
      command,
      tParams: params,
    });
  }

  async getAllItems(): Promise<DirectorItem[]> {
    return this.sendGet<DirectorItem[]>("/api/v1/items");
  }

  async getItemsByCategory(category: string): Promise<DirectorItem[]> {
    return this.sendGet<DirectorItem[]>(`/api/v1/categories/${category}`);
  }

  async getItemVariables(itemId: number): Promise<DirectorVariable[]> {
    return this.sendGet<DirectorVariable[]>(
      `/api/v1/items/${itemId}/variables`,
    );
  }

  async getItemVariable<T = unknown>(
    itemId: number,
    varName: string,
  ): Promise<T | null> {
    const data = await this.sendGet<DirectorVariable[]>(
      `/api/v1/items/${itemId}/variables?varnames=${encodeURIComponent(varName)}`,
    );
    if (!Array.isArray(data) || data.length === 0) return null;
    const value = data[0].value;
    if (value === "Undefined" || value === undefined) return null;
    return value as T;
  }

  close(): void {
    this.agent.destroy();
  }
}

export interface DirectorItem {
  id: number;
  name?: string;
  typeName?: string;
  categories?: string[];
  roomId?: number | null;
  roomName?: string | null;
  floorName?: string | null;
  floorId?: number | null;
  parentId?: number | null;
  proxy?: string | null;
  [key: string]: unknown;
}

export interface DirectorVariable {
  varName: string;
  value: unknown;
  [key: string]: unknown;
}

export interface DirectorBindingConnection {
  id: number;
  name: string;
  roomId: number;
  roomName: string;
  bindingId: number;
  bindingName: string;
}

export interface DirectorBinding {
  id: number;
  name: string;
  bindingId: number;
  bindingName: string;
  bindingType: string;
  bindingClass: string;
  inputoutput: string;
  hidden: number;
  connections: DirectorBindingConnection[];
}
