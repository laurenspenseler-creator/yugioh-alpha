# 0046: Card images come from the app's own cache on disk

## Status

Accepted. Closes the follow-up that [ADR 0001](0001-card-catalog-data-model.md) left open ("a local image proxy/cache").

## Context

The catalog stores YGOPRODeck's image URLs and every page loaded them straight from `images.ygoprodeck.com` (hotlinking).
Two things were wrong with that. YGOPRODeck asks not to be hotlinked, and the tester of the desktop app said: "Die Karten
Bilder scheinen nur bei Internet Verbindung verfügbar zu sein." The desktop app keeps all data on the PC and works without a
network, except that every card showed the card back.

## Decision

* **A route `GET /api/card-images/<size>/<id>.jpg`** (`server/api/card-images/[...path].get.ts`) answers with the scan from a
  folder on the disk, `card-images` next to the database (`%APPDATA%\YGO Alpha\data\card-images` in the desktop app). If the
  file is not there it fetches it from YGOPRODeck once, stores it (written beside the target and renamed, so nobody reads
  half a file) and answers. Later requests, and the browser's own cache (`max-age` 30 days, `immutable`), never reach the
  network again. With no connection and no file the answer is 404 and the page shows the card back, as before.
* **Only what the catalog has**: the sizes `cards`, `cards_small` and `cards_cropped` and a numeric `.jpg` name, fetched from
  the fixed host (`server/utils/card-image-cache.ts`). The route is no proxy for anything else and a path cannot leave the
  folder. It needs no sign-in, like the images it replaces: a shared deck page shows them to people who are not signed in.
  What is fetched must be an image (`image/*`, between 200 bytes and 5 MB).
* **Offline is quick**: the first fetch that fails (no network, or too slow, 6 seconds) makes the cache leave the network
  alone for 30 seconds, so a page of 24 tiles does not wait 24 times. Ten requests for the same scan make one fetch.
* **The pages ask the cache, not YGOPRODeck**: `cardImageSrc()` (`app/utils/card-image-url.ts`) rewrites a YGOPRODeck image
  URL to the route, in `CardThumb` and `CardFloatingImage`, where every scan is drawn. The catalog and the database keep the
  original URLs, so nothing is migrated and a sync does not touch the cache. The CSP still names the host (nothing else
  changed there). `CardThumb` shows the small scan when the large one is not available before it gives up for the card back.
* **The desktop app warms the cache up** (`server/plugins/card-image-warmup.ts`, switched on with
  `NUXT_CARD_IMAGE_WARMUP=1`, which only the desktop app sets): 20 seconds after the start it fetches the small scan of
  every card in any inventory, deck or wish list that is not cached yet, three at a time, and stops after five failures in
  a row (offline). So the cards a player owns have their pictures the next time there is no network, without having
  looked at each one before.

## Consequences

* The disk holds the scans that were seen (about 10 KB a small one, 50 KB a large one); the folder can be deleted at any time,
  it fills again. It moves with the data folder.
* A web host with this app also keeps its own copies now and asks YGOPRODeck once per image.
* Not built: downloading the whole catalog's images for browsing the catalog offline (about 15,000 small scans, roughly
  150 MB, and ten times that for the large ones), a "Bilder laden" button with progress, and clearing the cache from the menu.
  Cards the player never owned and never looked at show the card back offline.
