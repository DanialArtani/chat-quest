# Chat Quest

Chat Quest is a Twitch stream game where viewers suggest challenges, vote on the next one, and watch the streamer attempt it on a transparent OBS overlay. The overlay runs locally in a browser source at 1920×1080.

The app reads Twitch chat through EventSub over WebSocket. Before a vote, it can send the submitted challenge text to the OpenAI API to screen and rewrite the options. The app does not send messages back to Twitch chat.

## What happens in a round

1. Viewers submit one challenge each with `!challenge <text>`. Suggestions are limited to 60 characters.
2. Chat Quest collects suggestions for three minutes. If there are fewer than three, it opens another three-minute collection window. It also asks OpenAI to review suggestions, reject unsafe or rule-breaking ideas, and rewrite the best three safe options with difficulty ratings.
3. The overlay shows a 45-second vote. Viewers use `!vote 1`, `!vote 2`, or `!vote 3`; each viewer has one active vote and can change it before time runs out.
4. The winning challenge appears with a two-minute timer. The streamer can end the attempt early with `!done` or `!fail`.
5. The result appears briefly, then a new round begins.

If the AI approves fewer than three suggestions, Chat Quest asks for more suggestions before opening a vote. If the OpenAI key is missing or the API request fails, it falls back to raw suggestions marked **UNRATED**. That fallback does not apply the AI safety review. The AI review is a best-effort screen, not a guarantee that every challenge complies with Twitch rules.

## Requirements

- Node.js 20 or newer and npm
- A Twitch account for the channel, with two-factor authentication enabled
- An OpenAI API key if you want AI screening and rewriting
- OBS Studio if you want to use the overlay on stream

Chat Quest uses Twitch's Device Code Grant Flow as a public client. It needs a Client ID but does not need a Twitch client secret.

## Setup from scratch

### 0. Get the project

Install Node.js 20 or newer, then clone the repository and enter its folder:

```bash
git clone https://github.com/DanialArtani/chat-quest.git
cd chat-quest
```

### 1. Register a Twitch application

1. Sign in to the [Twitch Developer Console](https://dev.twitch.tv/console/apps). Twitch requires two-factor authentication on the developer account.
2. Open **Applications** and choose **Register Your Application**.
3. Give the app a unique name, such as `Chat Quest`, enter a local redirect URL such as `http://localhost:3000` if the form requires one, and choose the category that best fits your app. Chat Quest uses Device Code Grant, so it does not redirect to that URL.
4. Create the application, open **Manage**, and copy its **Client ID**. Do not create or use a client secret for this setup.

See Twitch's [app registration guide](https://dev.twitch.tv/docs/authentication/register-app) and [Device Code Grant documentation](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/). Chat Quest requests the `user:read:chat` scope for the `channel.chat.message` EventSub subscription.

### 2. Create an OpenAI API key

Create an API key in the [OpenAI API key settings](https://platform.openai.com/api-keys). The key is used by the local Node.js server and is never sent to the browser overlay. You can skip this for now; the game will fall back to raw, unrated suggestions if no key is configured.

### 3. Configure `.env`

From the project folder, copy the example file:

```powershell
Copy-Item .env.example .env
```

Then edit `.env` and fill in your values:

```dotenv
TWITCH_CLIENT_ID=your_twitch_client_id
TWITCH_CHANNEL=your_channel_login
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-6-astra
```

- `TWITCH_CLIENT_ID`: Client ID from your Twitch application.
- `TWITCH_CHANNEL`: Twitch login name for the channel, without `#` or `@`.
- `OPENAI_API_KEY`: OpenAI API key. It can be left blank to use raw suggestions.
- `OPENAI_MODEL`: Optional. Defaults to `gpt-6-astra`.
- `PORT`: Optional local web server port. Defaults to `3000`.

`.env` and the cached Twitch tokens are ignored by Git. Do not commit your OpenAI API key.

### 4. Install and start Chat Quest

In a terminal opened in the project folder, run:

```bash
npm install
npm run dev
```

On the first run, the terminal prints a Twitch activation URL and a code. Open the URL, enter the code, sign in to the channel's streamer account, and approve `user:read:chat`. Authorizing the broadcaster account lets Chat Quest recognize streamer-only commands. The app saves the access and refresh tokens locally in the ignored `.twitch-token.json` file. Later runs refresh the access token automatically when possible.

Once Twitch authorization succeeds, the local server starts. It serves the overlay at [http://localhost:3000/overlay](http://localhost:3000/overlay) and sends game-state updates over its `/ws` WebSocket endpoint. If you set a custom `PORT`, use that port in the URL.

### 5. Add the overlay to OBS

1. In OBS, add a **Browser** source to the scene.
2. Set the URL to `http://localhost:3000/overlay`.
3. Set **Width** to `1920` and **Height** to `1080`.
4. Confirm the source background is transparent, then place and scale the source in your scene.

The page is transparent outside the game panel, so the video remains visible behind it. The overlay stays compact in the top-right corner during suggestion, AI review, and result phases; it expands for the live vote and winning challenge reveal. Keep Chat Quest running on the same computer as OBS.

## Chat commands

| Command | Who can use it | What it does |
| --- | --- | --- |
| `!challenge <text>` | Anyone | Submit a challenge during the suggestion phase; one per viewer per round, maximum 60 characters. |
| `!vote 1`, `!vote 2`, `!vote 3` | Anyone, including the streamer | Vote during the 45-second vote. A later vote replaces your previous vote. |
| `!startround` | Streamer only | Run AI curation and start the vote immediately once at least three suggestions have been collected. |
| `!done` | Streamer only | Mark the active challenge complete and end its timer. |
| `!fail` | Streamer only | Mark the active challenge failed and end its timer. |
| `!testfill` | Streamer only | Add three sample suggestions from fake viewers during the suggestion phase. |
| `!testvotes` | Streamer only | Add ten random fake votes over five seconds during a vote, animating the vote bars. |

The test commands remain enabled in production and check the broadcaster's Twitch user ID. Avoid `!testvotes` during a real vote because its fake votes count toward the result.

For a solo demo, use `!testfill`, then `!startround`, then `!testvotes`. You can also vote yourself with `!vote 1`, `!vote 2`, or `!vote 3`, and finish the winning challenge with `!done` or `!fail`.

## Running a production build

The development command runs TypeScript directly. To compile and run the JavaScript build instead:

```bash
npm run build
npm start
```

The server binds to `127.0.0.1` by default. Set `PORT` in `.env` if port 3000 is already in use.

## How the app is structured

- Twitch chat messages, game timers, AI results, and demo actions enter the game through one trigger interface: `source`, `user`, `action`, and `payload`. A future donations or tips integration can submit that same shape.
- The game engine owns suggestion, curation, voting, challenge, and result phases.
- Express serves the static overlay page, and a WebSocket pushes each game-state update to the browser source.
- OpenAI curation runs on the server using Structured Outputs. Only challenge text is sent for curation; the browser never receives the API key.

## How Codex helped build it

Chat Quest was built in iterative steps with Codex: first Twitch Device Code authentication and EventSub chat, then the Express/WebSocket OBS overlay, the challenge and voting game, solo test commands, AI curation, and this setup documentation. Codex edited and explained the project files; the streamer supplies their own Twitch and OpenAI credentials and runs the app locally.

Codex session ID for this project: `01a17da8-538a-7cc1-8416-e92b12372fd2`.
