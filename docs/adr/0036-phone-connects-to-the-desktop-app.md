# 0036: A phone connects to the desktop app over the home network

## Status

Accepted.

## Context

The desktop app (ADR 0035) keeps the data on the PC. A phone should use that
data instead of a second copy: the same account, the same inventory and decks.
The phone gets the app as a PWA from the PC's address; there is no sync between
two databases.

Three facts shape it:

- The desktop server listens on `127.0.0.1` only, so nothing else can reach it.
- A phone reaches the PC by its home-network address (`192.168.x.x`). Better
  Auth checks the `Origin` of requests against its configured base URL, and
  does so for every request that carries an `Origin` header (a browser's sign-in
  included), so the phone would be refused with `INVALID_ORIGIN`.
- A browser installs a PWA only from HTTPS or `localhost`. A plain-HTTP address
  in the home network gets a shortcut, not an installed app.

## Decision

### Sharing is a switch, off by default

"Datei → Mit Handy verbinden …" opens a window with the switch, a QR code with
the PC's address, the address as text and an invite code. Switching it on
restarts the server (same port) with:

- `NITRO_HOST=0.0.0.0`: it listens on the whole home network, not only locally;
- `NUXT_INVITE_CODE=<code>`: new accounts need the code, so a stranger in the
  same Wi-Fi can't register (ADR 0027). The code is made once per installation
  and kept in `config.json`; signing in with an existing account needs none.
- `NUXT_TRUST_LOCAL_NETWORK=true` (below).

Switching it off restarts the server on `127.0.0.1` again with no code. The
setting is remembered. The window lists every private address of the PC, real
Wi-Fi and Ethernet adapters first, virtual ones (WSL, Docker, VirtualBox, VPN)
last, and the QR code carries the first one.

### Trusting the home network's origins

`runtimeConfig.trustLocalNetwork` (`NUXT_TRUST_LOCAL_NETWORK`, default `false`)
adds a `trustedOrigins` function to Better Auth (`server/utils/local-origin.ts`).
It trusts the request's `Origin` only when all of these hold:

1. the origin is plain `http` and a private IPv4 address written as digits
   (`10.x`, `172.16–31.x`, `192.168.x`, `127.x`),
2. and it is exactly the `Host` the request was sent to.

So a page on another site (`Origin` ≠ `Host`) and a public name pointed at the
PC's address (DNS rebinding: a name is never a digit address) are still
refused, with no list of addresses to maintain when the router hands out a new
one. A public deployment leaves the option off.

`createAuth` also sets `advanced.disableOriginCheck: false` explicitly. Better
Auth switches the check off in a test run, which hid exactly this behavior from
the tests; production already has it on.

### Security stance

The connection is plain HTTP. In a shared or public Wi-Fi others could read the
password and the session cookie. The window says so, and sharing is meant for
the user's own home network. Anyone on that network can open the sign-in page;
data is protected by the account's password, and registration by the code.

## Consequences

- Installing the app on the phone as a real PWA needs HTTPS. Options for later:
  a certificate the phone trusts (installing a local CA on the phone), or a
  tunnel with real certificates such as Tailscale (`tailscale cert`) or a
  Cloudflare tunnel. Until then the phone adds a shortcut from its browser
  ("Zum Startbildschirm hinzufügen"). Nothing in this ADR rules those out; the
  trusted-origin rule would need to learn their host names.
- The PC has to be on, awake and in the same network for the phone to work.
- Windows asks on the first start with sharing on whether `node.exe` may
  receive connections; "Private networks" must be allowed, which the window
  tells the user.
- The phone's session and the PC's window are separate sessions of the same
  account; there is no limit on devices.
- `YGO_ALPHA_USER_DATA` (a folder) replaces `%APPDATA%\YGO Alpha` for the
  settings, database and logs: a second profile, or a throwaway one for tests.
