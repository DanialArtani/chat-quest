import express from "express";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
let overlaySockets: WebSocketServer | undefined;
let latestOverlayEvent: Record<string, unknown> | undefined;

export function broadcastOverlayEvent(event: Record<string, unknown>): void {
  latestOverlayEvent = event;
  if (!overlaySockets) return;
  const payload = JSON.stringify(event);
  for (const client of overlaySockets.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

export function startOverlayServer(port: number): Promise<void> {
  const app = express();
  const server = createServer(app);
  overlaySockets = new WebSocketServer({ server, path: "/ws" });
  overlaySockets.on("connection", (client) => {
    if (latestOverlayEvent) client.send(JSON.stringify(latestOverlayEvent));
  });

  app.get("/overlay", (_request, response) => {
    response.sendFile(join(publicDirectory, "overlay.html"));
  });
  app.use(express.static(publicDirectory));

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      console.log(`Overlay ready at http://localhost:${port}/overlay`);
      resolve();
    });
  });
}
