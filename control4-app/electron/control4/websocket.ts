import * as https from "node:https";
import { io, Socket } from "socket.io-client";

const NAMESPACE = "/api/v1/items/datatoui";

export type ItemChangedCallback = (itemId: number) => void;

export class Control4WebSocket {
  private socket: Socket | null = null;
  private subscriptionId: string | null = null;
  private callbacks: Set<ItemChangedCallback> = new Set();

  constructor(
    private readonly ip: string,
    private readonly token: string,
  ) {}

  onItemChanged(cb: ItemChangedCallback): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  connect(): void {
    this.socket = io(`wss://${this.ip}${NAMESPACE}`, {
      transports: ["websocket"],
      extraHeaders: { JWT: this.token },
      rejectUnauthorized: false,
      autoConnect: false,
    });

    this.socket.on("clientId", (clientId: string) => {
      this.socket?.emit("2probe");
      void this.handshake(clientId);
    });

    this.socket.onAny((event: string, message: unknown) => {
      if (event !== this.subscriptionId) return;
      this.handleMessage(message);
    });

    this.socket.connect();
  }

  private async handshake(clientId: string): Promise<void> {
    const subId = await this.fetchSubscriptionId(clientId);
    this.subscriptionId = subId;
    this.socket?.emit("startSubscription", subId);
  }

  private fetchSubscriptionId(clientId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const path =
        `/api/v1/items/datatoui` +
        `?JWT=${encodeURIComponent(this.token)}` +
        `&SubscriptionClient=${encodeURIComponent(clientId)}`;
      const req = https.request(
        {
          hostname: this.ip,
          port: 443,
          path,
          method: "GET",
          rejectUnauthorized: false,
          timeout: 10_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            try {
              const data = JSON.parse(
                Buffer.concat(chunks).toString("utf8"),
              ) as { subscriptionId?: string };
              if (data.subscriptionId) resolve(data.subscriptionId);
              else reject(new Error("No subscriptionId in response"));
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on("error", reject);
      req.on("timeout", () =>
        req.destroy(new Error("subscription fetch timeout")),
      );
      req.end();
    });
  }

  private handleMessage(message: unknown): void {
    const msgs = Array.isArray(message) ? message : [message];
    for (const m of msgs) {
      if (!m || typeof m !== "object") continue;
      const msg = m as Record<string, unknown>;
      if ("status" in msg) {
        this.socket?.emit("2");
        continue;
      }
      const itemId = msg["iddevice"];
      if (typeof itemId === "number") {
        this.callbacks.forEach((cb) => cb(itemId));
      }
    }
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.subscriptionId = null;
  }
}
