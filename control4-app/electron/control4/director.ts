// Local director HTTP client. The controller ships a self-signed cert, so we
// pin it: on first connect we record the cert (trust on first use), then
// every connection trusts exactly that cert as its CA and must present the
// same SHA-256 fingerprint. A different device answering on the director IP
// is rejected before any bearer token is sent.

import * as https from "node:https";
import * as tls from "node:tls";
import { X509Certificate } from "node:crypto";
import { URL } from "node:url";

export class DirectorCertMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(
      `Director certificate changed (expected ${expected}, got ${actual}). ` +
        "If you replaced the controller, open Settings and save again to trust the new certificate.",
    );
    this.name = "DirectorCertMismatchError";
  }
}

export function certFingerprint(pem: string): string {
  return new X509Certificate(pem).fingerprint256;
}

// Read the director's certificate without sending anything else. Used once
// to establish the pin.
export function fetchDirectorCertPem(ip: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: ip, port: 443, rejectUnauthorized: false, timeout: 10_000 },
      () => {
        const raw = socket.getPeerCertificate().raw;
        socket.end();
        if (!raw) {
          reject(new Error("Director presented no certificate"));
          return;
        }
        const b64 = raw.toString("base64").match(/.{1,64}/g)!.join("\n");
        resolve(`-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`);
      },
    );
    socket.on("error", reject);
    socket.on("timeout", () => socket.destroy(new Error("Director TLS probe timeout")));
  });
}

// https.Agent that only accepts the pinned self-signed certificate. The
// hostname check is replaced by a fingerprint comparison because the cert's
// CN is the controller name, not its LAN IP.
export function createPinnedAgent(certPem: string): https.Agent {
  const expected = certFingerprint(certPem);
  return new https.Agent({
    keepAlive: true,
    ca: certPem,
    rejectUnauthorized: true,
    checkServerIdentity: (_host, cert) =>
      cert.fingerprint256 === expected
        ? undefined
        : new DirectorCertMismatchError(expected, cert.fingerprint256),
  });
}

export class Director {
  private readonly ip: string;
  private readonly bearer: string;
  private readonly agent: https.Agent;

  constructor(ip: string, directorBearerToken: string, agent: https.Agent) {
    this.ip = ip;
    this.bearer = directorBearerToken;
    this.agent = agent;
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

  // Most commands accept tParams as a dict (SET_LEVEL, SELECT_AUDIO_DEVICE, …).
  // SELECT_*_MEDIA specifically crashes with "cond.params.push is not a
  // function" unless tParams is an array of {name, value}. Callers that hit
  // that path pass an array directly.
  async sendCommand<T = unknown>(
    itemId: number,
    command: string,
    params: Record<string, unknown> | Array<{ name: string; value: unknown }> = {},
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

  // The agent is owned by Control4Client and shared with the websocket, so
  // closing a Director (on token refresh) must not tear it down.
  close(): void {}
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
