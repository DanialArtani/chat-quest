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
   ```

   `TWITCH_CHANNEL` is the channel's login name, without the `#` (for example, `twitchdev`). `.env` is ignored by Git.
3. Install dependencies and start the app:

   ```bash
   npm install
   npm run dev
   ```

4. On the first run, open the Twitch activation URL printed in the terminal and enter the displayed code. Sign in to the Twitch account that should read chat and approve the `user:read:chat` permission.
5. Open [http://localhost:3000/overlay](http://localhost:3000/overlay) in a browser. To use it in OBS, add a Browser Source with that URL and set its width to `1920` and height to `1080`. The page background is transparent.
6. Once connected, send a message in the configured channel's chat. Messages appear in the terminal and as animated overlay cards, which disappear after five seconds.

The server listens on `127.0.0.1:3000` by default. Set `PORT` in `.env` to change the port. The transparent overlay page is served at `/overlay`; its WebSocket endpoint is `/ws`.

The app stores the access and refresh tokens in `.twitch-token.json` in the project root. That file is ignored by Git. If authorization expires or is revoked, the app tries the refresh token and will prompt for device authorization again if needed.

For a compiled run instead of the TypeScript development runner:

```bash
npm run build
npm start
```

## Current scope

The overlay currently displays chat messages only. Viewer challenge submissions, voting, and Twitch chat commands are not implemented yet.
