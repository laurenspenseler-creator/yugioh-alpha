# 0035: A desktop app with its own server and local data

## Status

Accepted (Windows installer). Connecting a phone: [ADR 0036](0036-phone-connects-to-the-desktop-app.md).

## Context

Players asked for YGO Alpha as a program on the PC, with their data on that PC
and without the web host. The app is a Nuxt server with SQLite
(ADR 0001, ADR 0028), so "an app" means running that server next to a window.
Phones are served by the PWA (the manifest and icons exist); they are meant to
connect to the PC's app rather than hold a second copy of the data.

## Decision

### Electron around the existing production server

`desktop/` is a separate package (own `package.json`, installed with `npm`, not
part of the pnpm install or the web deploy; ESLint ignores it). Electron starts
the app's production build (`.output/server/index.mjs`) and shows it in a window.
Nothing in the web app changed for this: the same server, the same migrations at
startup (`server/plugins/migrate.ts`), the same database file.

- **The server is a child process with a Node we ship**, not code inside
  Electron. `better-sqlite3` is a native addon compiled for the Node that ran
  `pnpm install`; running the server with that same Node binary
  (`desktop/build/server/node.exe`, copied from the build machine by
  `desktop/scripts/prepare-server.mjs`) keeps the ABI matching without a second
  native build. It costs about 90 MB in the installer.
- **Local only.** The server listens on `127.0.0.1` (port 3737, or a free one),
  so nothing else on the network can reach it. Data lives in
  `%APPDATA%\YGO Alpha\data\app.db`; the logs in `...\logs\server.log`.
- **Settings made on first run**, in `%APPDATA%\YGO Alpha\config.json`: a random
  secret for the sign-in cookies and a random admin token, passed to the server
  as `NUXT_BETTER_AUTH_SECRET` and `NUXT_ADMIN_TOKEN`. There is no invite code
  (`NUXT_INVITE_CODE` empty): one person on one PC creates their own account.
- **The card catalog** is not in the installer (it is fetched, ADR 0001). On the
  first run the app offers to load it; the menu "Datei → Kartenkatalog laden /
  aktualisieren" does it any time, through `POST /api/admin/catalog/sync` with the
  admin token (ADR 0027). It needs internet, like the card images.
- One window per installation (second start focuses the first). Links outside the
  app open in the browser; a same-origin link, such as an opened PDF, gets its
  own window.

### Building it

```bash
cd desktop
npm install
npm run prepare-server -- --build   # pnpm build, then collect the server
npm start                           # try it
npm run dist                        # installer in desktop/dist
```

The production build needs more than Node's default heap: with about 2 GB it
failed with "JavaScript heap out of memory" after 25 minutes. The script sets
`--max-old-space-size=3584`; a machine with less than 4 GB free memory is slow.

## Consequences

- The installer is about 145 MB (Electron, the server and Node) and unsigned:
  Windows SmartScreen shows "Unknown publisher" until a code-signing
  certificate is bought. "More info → Run anyway" starts it.
- The data is per PC. Moving to another PC means copying `data/app.db`
  (the menu opens the folder). Several PCs do not sync.
- Better Auth logs a warning that it cannot determine a client IP and uses one
  shared rate-limit bucket per route: behind localhost every request comes from
  the same place. Harmless for one user; revisit when a phone connects.
- The phone opens the PC's app over the Wi-Fi through an explicit menu switch
  with a QR code (ADR 0036); installing it as a PWA there needs HTTPS.
- macOS and Linux builds are not set up (`electron-builder` supports them, but
  the bundled Node and native addon must come from a build on that system).
