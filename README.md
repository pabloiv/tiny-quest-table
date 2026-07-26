# Tiny Quest Table

Mobile-first, QR-first tabletop roleplaying helper for fast shared play.

## Features

- No-login room creation
- Scannable QR join flow with room-code backup
- Simple point-buy heroes
- Four stats: Strong, Quick, Clever, Cool
- One-tap rolls and shared table log
- Heart tracker
- Guide controls for scene and difficulty

## Run Locally

```sh
npm install
npm run start
```

Open:

```text
http://localhost:8787
```

For phone testing on the same Wi-Fi, use the computer's LAN address instead of localhost, for example:

```text
http://192.168.1.12:8787
```

## Current Storage Model

Production rooms are stored in Supabase in a single `rooms` table. Each row stores the room state as JSON and expires after roughly 24 hours of inactivity.

Local development falls back to in-memory rooms unless these environment variables are set:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

## Deployment Notes

The app is deployed on Vercel. Supabase credentials must be configured as server-side Vercel environment variables.
