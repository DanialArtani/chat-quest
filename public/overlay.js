const messageList = document.querySelector("#message-list");
const MESSAGE_LIFETIME_MS = 5000;

function showChatMessage({ username, message }) {
  const card = document.createElement("article");
  card.className = "message-card";

  const content = document.createElement("div");
  content.className = "message-content";

  const name = document.createElement("p");
  name.className = "message-username";
  name.textContent = username;

  const text = document.createElement("p");
  text.className = "message-text";
  text.textContent = message;

  content.append(name, text);
  card.append(content);
  messageList.prepend(card);

  window.setTimeout(() => card.remove(), MESSAGE_LIFETIME_MS);
}

function connectOverlaySocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

  socket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "chat_message") showChatMessage(payload);
    } catch (error) {
      console.error("Could not read a Chat Quest event.", error);
    }
  });

  socket.addEventListener("close", () => window.setTimeout(connectOverlaySocket, 1500));
  socket.addEventListener("error", () => socket.close());
}

connectOverlaySocket();
