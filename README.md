# Chat Quest

Chat Quest is an interactive Twitch overlay for viewer-suggested and viewer-voted streamer challenges. The app connects to Twitch chat and sends messages to a browser overlay while also printing them in the terminal.

## Requirements

- Node.js 20 or newer
- A Twitch developer application configured as a **public client**

The app uses Twitch's Device Code Grant Flow, so it does not need a client secret.

## Setup

1. Create a Twitch application in the [Twitch Developer Console](https://dev.twitch.tv/console/apps) and copy its Client ID.
2. Copy `.env.example` to `.env` and fill in the values:

   ```dotenv
   TWITCH_CLIENT_ID=your_public_twitch_client_id
   TWITCH_CHANNEL=your_channel_login
   OPENAI_API_KEY=your_openai_api_key
   ```

   `TWITCH_CHANNEL` is the channel's login name, without the `#` (for example, `twitchdev`). Set `OPENAI_API_KEY` to an API key from the OpenAI platform. `.env` is ignored by Git; the key is used by the server and is never sent to the overlay browser. `OPENAI_MODEL` is optional and defaults to `gpt-6-astra`.
3. Install dependencies and start the app:

   ```bash
   npm install
   npm run dev
   ```

4. On the first run, open the Twitch activation URL printed in the terminal and enter the displayed code. Sign in to the Twitch account that should read chat and approve the `user:read:chat` permission.
5. Open [http://localhost:3000/overlay](http://localhost:3000/overlay) in a browser. To use it in OBS, add a Browser Source with that URL and set its width to `1920` and height to `1080`. The page background is transparent.
6. In chat, viewers can submit suggestions with `!challenge <text>` (one per viewer per round, up to 60 characters). The app collects suggestions for three minutes, then asks OpenAI to reject unsafe or Twitch-rule-violating ideas, rewrite the best three safe challenges, and rate their difficulty. The overlay shows “AI is picking challenges...” while it works, then opens a 45-second vote with `!vote 1`, `!vote 2`, or `!vote 3`. If fewer than three suggestions are available, it keeps collecting for another three-minute window. Each viewer, including the streamer, has one vote and can change it before voting ends.
7. The winning challenge appears with a two-minute timer. The streamer can finish it early with `!done` or `!fail`. After the result appears briefly, the next suggestion period begins.

For a solo test or demo, the streamer can use `!testfill` to add three sample suggestions from fake viewers, then `!startround` to start voting immediately. During voting, `!testvotes` adds ten randomly distributed votes from fake viewers over five seconds so the overlay bars animate. These commands remain enabled in production and are accepted only from the configured channel's broadcaster account.

If the OpenAI key is missing or the API request fails, the vote falls back to three raw suggestions marked `UNRATED`; this fallback does not perform the AI safety review.

The server listens on `127.0.0.1:3000` by default. Set `PORT` in `.env` to change the port. The transparent overlay page is served at `/overlay`; its WebSocket endpoint is `/ws`.

The app stores the access and refresh tokens in `.twitch-token.json` in the project root. That file is ignored by Git. If authorization expires or is revoked, the app tries the refresh token and will prompt for device authorization again if needed.

For a compiled run instead of the TypeScript development runner:

```bash
npm run build
npm start
```

## Current scope

All game inputs use a single trigger contract with `source`, `user`, `action`, and `payload` fields. Twitch chat, AI curation results, demo actions, and game timers use it; future integrations such as tips or donations can submit the same trigger shape.
