# Happy Desktop (goudan mod)

Mac desktop client for self-hosted Happy. One app = the familiar webapp UI
**plus** a local executor, so remote Claude Code sessions can run commands on
this machine — each one gated by a native approval dialog.

```
remote CC ──(encrypted relay)──> Happy Desktop (this app)
                                   │  native dialog:
                                   │  "Remote session wants to run: npm test"
                                   │  [Deny] [Allow once] [Always allow]
                                   ▼
                              runs locally, output encrypted back
```

## How it works

- The window just loads the self-hosted webapp (`HAPPY_WEBAPP_URL`).
- On launch the app spawns `happy daemon start-sync` with
  `HAPPY_EXEC_APPROVER_SOCKET` pointing at a unix socket the app listens on.
- The (modified) happy-cli bash RPC handler asks that socket before executing
  anything; no answer or denial ⇒ command rejected (fail-safe).
- "Always allow" stores the exact command in
  `~/Library/Application Support/happy-desktop/exec-whitelist.json`.
  Commands matching dangerous patterns (rm / sudo / dd / …) can never be
  whitelisted — always a manual dialog.

## Prereqs on the Mac

- `happy-coder` (this fork) installed globally, logged in (`happy` once).
- Or set `HAPPY_CLI_PATH=/path/to/happy`.

## Dev

```bash
cd packages/happy-desktop
npm install          # not part of the pnpm workspace on purpose (electron deps)
npm start            # build + launch shell (works on Linux for UI dev too)
npm run dist:mac     # unsigned arm64 zip in dist/ (right-click → Open on first launch)
```
