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

Rooms are kept in server memory and expire after roughly 24 hours of inactivity. This is good for quick local demos, but production should use a hosted data store.

## Deployment Notes

The app needs a Node host because rooms are shared through server state. Static-only hosting is not enough unless room sync is moved to a backend service.
