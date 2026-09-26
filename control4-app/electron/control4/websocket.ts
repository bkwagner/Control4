// Director item-change feed. The Director speaks the legacy Socket.IO v2
// protocol (Engine.IO 3), so this uses socket.io-client 2.x — v3+ clients
// can't talk to it at all. Handshake mirrors pyControl4:
//   connect on the ROOT namespace -> director emits `clientId` ->
//   GET a subscriptionId from SUBSCRIPTION_PATH -> emit `startSubscription`
//   -> item updates arrive as events named after the subscriptionId.
// Note the director rejects SUBSCRIPTION_PATH as a socket.io namespace
// ("Invalid namespace"); it is only an HTTP endpoint.

import * as https from "node:https";
import io from "socket.io-client";

const SUBSCRIPTION_PATH = "/api/v1/items/datatoui";

export type ItemChangedCallback = (itemId: number) => void;

export class Control4WebSocket {
  private socket: SocketIOClient.Socket | null = null;
  private subscriptionId: string | null = null;
  private callbacks: Set<ItemChangedCallback> = new Set();

  constructor(
    private readonly ip: string,
    private readonly token: string,
    // Pinned director agent (see director.ts) — used for both the socket and
    // the subscription fetch so neither ever trusts an unpinned cert.
    private readonly agent: https.Agent,
  ) {}

  onItemChanged(cb: ItemChangedCallback): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  connect(): void {
    const socket = io(`wss://${this.ip}`, {
      transports: ["websocket"],
      // forceNode: engine.io-client 3 otherwise prefers a global WebSocket
      // (present in newer Node/Electron), which ignores headers and agent.
      // The typings only describe the browser options.
      ...({ forceNode: true, extraHeaders: { JWT: this.token }, agent: this.agent } as object),
      autoConnect: false,
      forceNew: true,
    });
    this.socket = socket;

    socket.on("disconnect", () => {
      // The subscription dies with the connection; a fresh one is requested
      // when the director sends a new clientId after reconnect.
      if (this.subscriptionId) socket.off(this.subscriptionId);
      this.subscriptionId = null;
    });

    socket.on("clientId", (clientId: string) => {
      socket.emit("2probe");
      if (this.subscriptionId) return;
      this.handshake(socket, clientId).catch((err: unknown) => {
        console.warn("[ws] subscription handshake failed; retrying in 5s", err);
        setTimeout(() => {
          if (this.socket === socket) socket.disconnect().connect();
        }, 5_000);
      });
    });

    socket.connect();
  }

  private async handshake(socket: SocketIOClient.Socket, clientId: string): Promise<void> {
    const subId = await this.fetchSubscriptionId(clientId);
    if (this.socket !== socket) return;
    this.subscriptionId = subId;
    socket.on(subId, (message: unknown) => this.handleMessage(message));
    socket.emit("startSubscription", subId);
  }

  private fetchSubscriptionId(clientId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const path =
        `${SUBSCRIPTION_PATH}` +
        `?JWT=${encodeURIComponent(this.token)}` +
        `&SubscriptionClient=${encodeURIComponent(clientId)}`;
      const req = https.request(
        {
          hostname: this.ip,
          port: 443,
          path,
          method: "GET",
          agent: this.agent,
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
    const socket = this.socket;
    this.socket = null;
    this.subscriptionId = null;
    socket?.disconnect();
  }
}
