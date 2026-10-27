# Chat Quest

Chat Quest is an interactive Twitch overlay for viewer-suggested and viewer-voted streamer challenges. This first step connects to Twitch chat and prints each message in the terminal; the overlay and challenge/voting features will build on this connection later.

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
5. Once connected, send a message in the configured channel's chat. Messages appear in the terminal as `time username: message`.

The app stores the access and refresh tokens in `.twitch-token.json` in the project root. That file is ignored by Git. If authorization expires or is revoked, the app tries the refresh token and will prompt for device authorization again if needed.

For a compiled run instead of the TypeScript development runner:

```bash
npm run build
npm start
```

## Step 1 scope

This version only connects to chat and logs messages. It does not yet provide a browser overlay, challenge submissions, voting, or Twitch chat commands.
