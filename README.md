# Tiny Quest Table

Mobile-first, QR-first tabletop roleplaying helper for fast shared play.

## Features

- No-login room creation
- Scannable QR join flow with room-code backup
- Simple point-buy heroes
- Four stats: Strong, Quick, Clever, Cool
- Named Special Thing attached to one stat, usable once per scene for +1
- One-tap rolls and shared table log
- Heart tracker
- Guide controls for scene and difficulty

## Design Resources

- Fonts: Fredoka and Atkinson Hyperlegible from Google Fonts.
- Visual direction: lightweight quest-map interface, tactile mobile controls, and game-icon silhouettes inspired by free tabletop/game UI resources.

## Validate

```sh
npm install
npm run check
```

## Current Storage Model

Rooms are stored in Supabase in a single `rooms` table. Each row stores the room state as JSON and expires after roughly 24 hours of inactivity. The Vercel API handler is the backend source of truth and requires these server-side environment variables:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

## Deployment Notes

The app is deployed on Vercel. Supabase credentials must be configured as server-side Vercel environment variables.
