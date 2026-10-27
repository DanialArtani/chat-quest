const panel = document.querySelector("#game-panel");

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function header(state, phase, showCountdown = true) {
  const countdown = showCountdown && state.endsAt !== null
    ? `<div class="countdown" data-countdown="${state.endsAt}">--:--</div>`
    : "";
  return `<div class="game-header">
    <div class="brand"><span class="brand-mark">★</span> CHAT QUEST LIVE</div>
    <div class="round-label">ROUND ${String(state.round).padStart(2, "0")} · ${phase}</div>
    ${countdown}
  </div>`;
}

function renderSuggestions(state) {
  const noun = state.suggestionsCount === 1 ? "SUGGESTION" : "SUGGESTIONS";
  return `${header(state, "SUGGESTIONS")}
    <h1>What should the streamer do?</h1>
    <p class="subtitle">Add a challenge for the next round in Twitch chat.</p>
    <div class="suggestion-count">${state.suggestionsCount} ${noun} · ONE PER VIEWER</div>
    <p class="footer-hint" style="margin-top: 18px">VIEWERS: !challenge &lt;idea&gt; · STREAMER: !startround</p>`;
}

function renderCurating(state) {
  return `${header(state, "AI REVIEW", false)}
    <div class="ai-wait">
      <span class="ai-spinner" aria-hidden="true"></span>
      <div><h1>AI is picking challenges...</h1>
      <p class="subtitle">Checking safety and choosing fun options.</p></div>
    </div>`;
}

function renderVoting(state) {
  const totalVotes = state.options.reduce((total, option) => total + option.votes, 0);
  const options = state.options.map((option) => {
    const share = totalVotes ? Math.round((option.votes / totalVotes) * 100) : 0;
    const voteLabel = option.votes === 1 ? "VOTE" : "VOTES";
    return `<div class="option" data-option="${option.number}">
      <div class="option-bar" style="width:${share}%"></div>
      <div class="option-content">
        <span class="option-number">${option.number}</span>
        <span class="option-text">${escapeText(option.text)}</span>
        <span class="difficulty-badge difficulty-${escapeText(option.difficulty)}">${escapeText(option.difficulty)}</span>
        <span class="option-votes">${option.votes} ${voteLabel}</span>
      </div>
    </div>`;
  }).join("");
  return `${header(state, "VOTE")}
    <h1>Choose the challenge</h1>
    <p class="subtitle">Vote in chat. You can change your vote until the timer ends.</p>
    <div class="option-list">${options}</div>
    <p class="footer-hint">TYPE !VOTE 1, !VOTE 2, OR !VOTE 3</p>`;
}

function renderChallenge(state) {
  return `${header(state, "CHALLENGE")}
    <div class="phase-label">THE VIEWERS CHOSE</div>
    <div class="challenge-card">
      <span class="difficulty-badge difficulty-${escapeText(state.winner?.difficulty ?? "unrated")}">${escapeText(state.winner?.difficulty ?? "unrated")}</span>
      <h2>${escapeText(state.winner?.text ?? "Challenge")}</h2>
    </div>
    <p class="footer-hint" style="margin-top: 20px">STREAMER: TYPE !DONE OR !FAIL TO FINISH</p>`;
}

function renderResult(state) {
  const label = state.result === "done" ? "Challenge complete!"
    : state.result === "failed" ? "Challenge failed"
      : "Time's up";
  return `${header(state, "RESULT", false)}
    <div class="phase-label">CHALLENGE RESULT</div>
    <div class="challenge-card">
      <span class="difficulty-badge difficulty-${escapeText(state.winner?.difficulty ?? "unrated")}">${escapeText(state.winner?.difficulty ?? "unrated")}</span>
      <h2>${escapeText(state.winner?.text ?? "Challenge")}</h2>
    </div>
    <div class="result-banner result-${state.result}">${label}</div>`;
}

function render(state) {
  if (!state) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  if (state.phase === "voting"
      && panel.dataset.phase === "voting"
      && panel.dataset.endsAt === String(state.endsAt)) {
    updateVotingBars(state);
    updateCountdown();
    return;
  }
  if (state.phase === "suggestions") panel.innerHTML = renderSuggestions(state);
  if (state.phase === "curating") panel.innerHTML = renderCurating(state);
  if (state.phase === "voting") panel.innerHTML = renderVoting(state);
  if (state.phase === "challenge") panel.innerHTML = renderChallenge(state);
  if (state.phase === "result") panel.innerHTML = renderResult(state);
  panel.dataset.phase = state.phase;
  panel.dataset.endsAt = String(state.endsAt);
  updateCountdown();
}

function updateVotingBars(state) {
  const totalVotes = state.options.reduce((total, option) => total + option.votes, 0);
  for (const option of state.options) {
    const row = panel.querySelector(`[data-option="${option.number}"]`);
    if (!row) continue;
    const share = totalVotes ? Math.round((option.votes / totalVotes) * 100) : 0;
    const voteLabel = option.votes === 1 ? "VOTE" : "VOTES";
    row.querySelector(".option-bar").style.width = `${share}%`;
    row.querySelector(".option-votes").textContent = `${option.votes} ${voteLabel}`;
  }
}

function updateCountdown() {
  const countdown = panel.querySelector("[data-countdown]");
  if (countdown) countdown.textContent = formatTime(Number(countdown.dataset.countdown) - Date.now());
}

function connectOverlaySocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

  socket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "game_state") render(payload.state);
    } catch (error) {
      console.error("Could not read a Chat Quest event.", error);
    }
  });

  socket.addEventListener("close", () => window.setTimeout(connectOverlaySocket, 1500));
  socket.addEventListener("error", () => socket.close());
}

window.setInterval(updateCountdown, 250);
connectOverlaySocket();
