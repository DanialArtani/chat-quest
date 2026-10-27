import "dotenv/config";

import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { ChatQuestGame, type TriggerUser } from "./game.js";
import { startOverlayServer } from "./overlay.js";

const DEVICE_ENDPOINT = "https://id.twitch.tv/oauth2/device";
const TOKEN_ENDPOINT = "https://id.twitch.tv/oauth2/token";
const VALIDATE_ENDPOINT = "https://id.twitch.tv/oauth2/validate";
const HELIX_ENDPOINT = "https://api.twitch.tv/helix";
const EVENTSUB_WS_URL = "wss://eventsub.wss.twitch.tv/ws";
const TOKEN_FILE = new URL("../.twitch-token.json", import.meta.url);
const SCOPE = "user:read:chat";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface TwitchTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface EventSubMessage {
  metadata?: { message_type?: string };
  payload?: {
    session?: { id?: string; reconnect_url?: string | null };
    event?: {
      chatter_user_id?: string;
      user_id?: string;
      chatter_user_name?: string;
      chatter_user_login?: string;
      user_name?: string;
      user_login?: string;
      message?: { text?: string };
    };
  };
}

function requiredEnv(name: "TWITCH_CLIENT_ID" | "TWITCH_CHANNEL"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

async function readToken(): Promise<TokenSet | undefined> {
  try {
    return JSON.parse(await readFile(TOKEN_FILE, "utf8")) as TokenSet;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function saveToken(response: TwitchTokenResponse): Promise<TokenSet> {
  const token: TokenSet = {
    access_token: response.access_token,
    refresh_token: response.refresh_token,
    expires_at: Date.now() + response.expires_in * 1000,
  };
  await writeFile(TOKEN_FILE, `${JSON.stringify(token, null, 2)}\n`, "utf8");
  return token;
}

async function postForm<T>(url: string, fields: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  const body = (await response.json()) as T & { message?: string; error?: string };
  if (!response.ok) {
    throw Object.assign(new Error(body.message ?? body.error ?? response.statusText), {
      status: response.status,
    });
  }
  return body;
}

async function validateToken(accessToken: string): Promise<{ user_id: string }> {
  const response = await fetch(VALIDATE_ENDPOINT, {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Token validation failed (${response.status}).`);
  return (await response.json()) as { user_id: string };
}

async function startDeviceAuthorization(clientId: string): Promise<TokenSet> {
  const device = await postForm<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  }>(DEVICE_ENDPOINT, { client_id: clientId, scopes: SCOPE });

  console.log("\nAuthorize Chat Quest with Twitch:");
  console.log(`  Open: ${device.verification_uri}`);
  console.log(`  Enter code: ${device.user_code}\n`);

  const deadline = Date.now() + device.expires_in * 1000;
  let interval = device.interval;
  while (Date.now() < deadline) {
    await delay(interval * 1000);
    try {
      const token = await postForm<TwitchTokenResponse>(TOKEN_ENDPOINT, {
        client_id: clientId,
        device_code: device.device_code,
        grant_type: DEVICE_GRANT,
      });
      return saveToken(token);
    } catch (error) {
      const message = (error as Error).message;
      if (message === "authorization_pending") continue;
      if (message === "slow_down") {
        interval += 5;
        continue;
      }
      throw error;
    }
  }
  throw new Error("Twitch device authorization expired. Run the app again to get a new code.");
}

async function getAccessToken(clientId: string): Promise<{ token: TokenSet; userId: string }> {
  const saved = await readToken();
  if (saved && saved.expires_at > Date.now() + 60_000) {
    try {
      const identity = await validateToken(saved.access_token);
      return { token: saved, userId: identity.user_id };
    } catch {
      // An expired or revoked access token can be replaced with the saved refresh token.
    }
  }

  if (saved?.refresh_token) {
    try {
      const refreshed = await postForm<TwitchTokenResponse>(TOKEN_ENDPOINT, {
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: saved.refresh_token,
      });
      const token = await saveToken(refreshed);
      const identity = await validateToken(token.access_token);
      return { token, userId: identity.user_id };
    } catch (error) {
      console.warn(`Could not refresh the saved Twitch token: ${(error as Error).message}`);
    }
  }

  const token = await startDeviceAuthorization(clientId);
  const identity = await validateToken(token.access_token);
  return { token, userId: identity.user_id };
}

async function getBroadcasterId(clientId: string, accessToken: string, channel: string): Promise<string> {
  const url = new URL(`${HELIX_ENDPOINT}/users`);
  url.searchParams.set("login", channel);
  const response = await fetch(url, {
    headers: {
      "Client-Id": clientId,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body = (await response.json()) as {
    data?: Array<{ id: string; login: string }>;
    message?: string;
  };
  if (!response.ok) throw new Error(`Could not look up channel: ${body.message ?? response.statusText}`);
  const broadcaster = body.data?.[0];
  if (!broadcaster) throw new Error(`Twitch channel "${channel}" was not found.`);
  return broadcaster.id;
}

async function subscribeToChat(
  clientId: string,
  accessToken: string,
  sessionId: string,
  broadcasterId: string,
  userId: string,
): Promise<void> {
  const response = await fetch(`${HELIX_ENDPOINT}/eventsub/subscriptions`, {
    method: "POST",
    headers: {
      "Client-Id": clientId,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "channel.chat.message",
      version: "1",
      condition: { broadcaster_user_id: broadcasterId, user_id: userId },
      transport: { method: "websocket", session_id: sessionId },
    }),
  });
  if (!response.ok) {
    const body = (await response.json()) as { message?: string };
    throw new Error(`Could not subscribe to chat: ${body.message ?? response.statusText}`);
  }
}

async function runEventSub(
  clientId: string,
  accessToken: string,
  broadcasterId: string,
  userId: string,
  game: ChatQuestGame,
): Promise<never> {
  let currentSocket: WebSocket | undefined;
  let stopped = false;

  const openSocket = (url: string, subscribe: boolean): void => {
    const socket = new WebSocket(url);
    currentSocket = socket;

    socket.on("message", (raw) => {
      let message: EventSubMessage;
      try {
        message = JSON.parse(raw.toString()) as EventSubMessage;
      } catch {
        console.warn("Received an unreadable EventSub message.");
        return;
      }

      const type = message.metadata?.message_type;
      if (type === "session_welcome") {
        const sessionId = message.payload?.session?.id;
        if (!sessionId) {
          console.error("Twitch welcome message did not include a session ID.");
          socket.close();
          return;
        }
        console.log(`Connected to Twitch EventSub (session ${sessionId}).`);
        if (subscribe) {
          void subscribeToChat(clientId, accessToken, sessionId, broadcasterId, userId)
            .then(() => console.log("Listening for chat messages.\n"))
            .catch((error: unknown) => {
              console.error((error as Error).message);
              socket.close();
            });
        } else {
          console.log("EventSub session resumed.");
        }
      } else if (type === "notification") {
        const event = message.payload?.event;
        if (event?.message?.text !== undefined) {
          const username = event.chatter_user_name ?? event.user_name ?? event.chatter_user_login ?? event.user_login ?? "unknown user";
          console.log(`[${new Date().toLocaleTimeString()}] ${username}: ${event.message.text}`);
          const user: TriggerUser = {
            id: event.chatter_user_id ?? event.user_id ?? "unknown",
            login: event.chatter_user_login ?? event.user_login ?? "unknown",
            displayName: username,
          };
          game.trigger({
            source: "twitch_chat",
            user,
            action: "chat_message",
            payload: { text: event.message.text },
          });
        }
      } else if (type === "session_reconnect") {
        const reconnectUrl = message.payload?.session?.reconnect_url;
        if (reconnectUrl) openSocket(reconnectUrl, false);
      } else if (type === "revocation") {
        console.error("Twitch revoked the chat subscription. Restart the app to reconnect.");
      }
    });

    socket.on("error", (error) => {
      console.error(`EventSub WebSocket error: ${error.message}`);
    });

    socket.on("close", () => {
      if (stopped || currentSocket !== socket) return;
      console.warn("EventSub disconnected. Reconnecting in 3 seconds...");
      void delay(3000).then(() => {
        if (!stopped && currentSocket === socket) openSocket(EVENTSUB_WS_URL, true);
      });
    });
  };

  process.once("SIGINT", () => {
    stopped = true;
    currentSocket?.close();
    process.exit(0);
  });

  openSocket(EVENTSUB_WS_URL, true);
  return new Promise<never>(() => undefined);
}

async function main(): Promise<void> {
  const clientId = requiredEnv("TWITCH_CLIENT_ID");
  const channel = requiredEnv("TWITCH_CHANNEL").replace(/^@/, "").toLowerCase();
  const { token, userId } = await getAccessToken(clientId);
  const broadcasterId = await getBroadcasterId(clientId, token.access_token, channel);
  const port = Number(process.env.PORT ?? 3000);
  await startOverlayServer(port);
  const game = new ChatQuestGame(broadcasterId);
  game.start();
  console.log(`Starting Chat Quest chat listener for #${channel}...`);
  await runEventSub(clientId, token.access_token, broadcasterId, userId, game);
}

main().catch((error: unknown) => {
  console.error(`Chat Quest could not start: ${(error as Error).message}`);
  process.exitCode = 1;
});
