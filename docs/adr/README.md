# Architecture Decision Records

Records of structural decisions (data schema, persistence, auth, core
dependencies, cross-cutting patterns). See
[`docs/WORKFLOW.md` §5](../WORKFLOW.md#5-when-to-write-an-adr) for when to
add one. Don't rewrite an accepted ADR to reverse it — add a new one and
mark the old as superseded.

| # | Title | Status |
|---|-------|--------|
| [0001](0001-card-catalog-data-model.md) | Card catalog data model and YGOPRODeck import | Accepted (admin endpoint gate superseded by [0027](0027-invite-code-and-admin-token.md)) |
| [0002](0002-owned-card-inventory-data-model.md) | Owned-card inventory data model | Accepted (collector parts superseded by [0017](0017-inventory-without-collector-details.md)) |
| [0003](0003-client-side-ocr-and-speech-entry.md) | Client-side OCR and speech entry, server-side matching | Accepted |
| [0004](0004-deck-data-model.md) | Deck data model | Accepted |
| [0005](0005-rule-format-model.md) | Rule format model | Accepted |
| [0006](0006-ai-deck-assistant.md) | AI deck assistant | Superseded by [0011](0011-deck-assistance-in-chat.md) |
| [0007](0007-sharing-and-profile-model.md) | Sharing and profile model | Accepted |
| [0008](0008-tournament-model.md) | Tournament model | Accepted (scoring, byes, draws and pairing swaps partially superseded by [0031](0031-tournament-league-scoring.md)) |
| [0009](0009-openai-compatible-assistant-provider.md) | OpenAI-compatible assistant provider | Accepted (structured-output parts superseded by [0011](0011-deck-assistance-in-chat.md), the no-SDK transport by [0020](0020-assistant-on-the-ai-sdk.md)) |
| [0010](0010-chat-assistant-with-tools.md) | Chat assistant with tools | Accepted (partly superseded by [0011](0011-deck-assistance-in-chat.md); engine parts by [0020](0020-assistant-on-the-ai-sdk.md)) |
| [0011](0011-deck-assistance-in-chat.md) | Deck assistance in the chat assistant | Accepted (deck link superseded by [0021](0021-no-deck-link-in-assistant-conversations.md)) |
| [0012](0012-deck-cover-card.md) | Deck cover card chosen by the user | Accepted |
| [0013](0013-english-url-scheme.md) | English URL scheme and permanent redirects from German paths | Accepted (`/decks/assistent` target changed by [0021](0021-no-deck-link-in-assistant-conversations.md)) |
| [0014](0014-ui-internationalisation.md) | UI internationalisation (German and English) | Accepted |
| [0015](0015-german-card-data.md) | German card data and card display language | Accepted (implemented: F3a–F3c); UI credit superseded by [0017](0017-inventory-without-collector-details.md) |
| [0016](0016-visual-design-system.md) | Visual design system and theming (Duel Arena) | Accepted |
| [0017](0017-inventory-without-collector-details.md) | Inventory without collector details | Accepted |
| [0018](0018-product-name-ygo-alpha.md) | Product name "YGO Alpha" | Accepted |
| [0019](0019-retired-catalog-cards.md) | Retired catalog cards | Accepted (extended by [0024](0024-passcode-aliases-and-catalog-cleanup.md)) |
| [0020](0020-assistant-on-the-ai-sdk.md) | The chat assistant on the Vercel AI SDK | Accepted, implemented (84a–84c); per-turn deck context removed by [0021](0021-no-deck-link-in-assistant-conversations.md); proposals end the turn: [0026](0026-proposal-ends-the-assistant-turn.md) |
| [0021](0021-no-deck-link-in-assistant-conversations.md) | No deck link in assistant conversations | Accepted (`deck_id` dropped by migration 0017, #137) |
| [0022](0022-classic-plus-format.md) | Classic Plus as a built-in format with its own banlist | Accepted |
| [0023](0023-markdown-in-assistant-answers.md) | Markdown in assistant answers | Accepted |
| [0024](0024-passcode-aliases-and-catalog-cleanup.md) | Passcode aliases and catalog cleanup | Accepted (extended by [0025](0025-primary-artwork-and-set-facet.md)) |
| [0025](0025-primary-artwork-and-set-facet.md) | Primary artwork and the set facet | Accepted |
| [0026](0026-proposal-ends-the-assistant-turn.md) | A proposal ends the assistant turn | Accepted |
| [0027](0027-invite-code-and-admin-token.md) | Invite-only sign-up and an admin token for the catalog syncs | Accepted |
| [0028](0028-plesk-deployment.md) | Deployment to the Plesk host | Accepted |
| [0029](0029-security-headers.md) | Security headers and a hash-based Content Security Policy | Accepted |
| [0030](0030-edison-format.md) | Edison as a built-in format with a static banlist | Accepted |
| [0031](0031-tournament-league-scoring.md) | Tournament scoring, byes, no draws, league tables and withdrawing | Accepted |
| [0032](0032-collections-built-by-moving-copies.md) | Collections are built by moving copies out of the inventory | Accepted |
| [0033](0033-inventory-files.md) | Files kept with the inventory | Accepted |
| [0034](0034-card-list-from-spreadsheet.md) | Card lists from spreadsheets are read in the browser | Accepted |
| [0035](0035-desktop-app.md) | A desktop app with its own server and local data | Accepted |
| [0036](0036-phone-connects-to-the-desktop-app.md) | A phone connects to the desktop app over the home network | Accepted |
| [0037](0037-format-from-a-rulebook.md) | A format is created from a written rulebook, and the app says what it can check | Accepted |
| [0038](0038-card-text-filters-and-handtrap-definitions.md) | Card-text filters, exceptions, and what "hand traps" means | Accepted |
| [0039](0039-decks-of-tournament-participants.md) | Several decks per tournament participant, set by the organizer | Accepted |
| [0040](0040-on-device-photo-and-speech-input.md) | Photo and speech input run on the device, without an account or key | Accepted |
| [0041](0041-card-recognition-by-artwork.md) | Cards on a photo are recognized by their artwork | Accepted |
| [0042](0042-tournament-duel-queue.md) | A tournament with tables and a queue (round robin, Champions League, Swiss) | Accepted |
| [0043](0043-tournament-spieltage-and-best-of.md) | Spieltage, best of 3 and the players named when a tournament is created | Accepted |
| [0044](0044-tournament-ranking-extension-and-table-view.md) | The ranking ladder, one more Spieltag, the pinnable table, decks at creation | Accepted |
| [0045](0045-classic-plus-v3-1.md) | Classic Plus v3.1: the card list and rule 8 for the Extra Deck | Accepted |
| [0046](0046-card-image-cache.md) | Card images come from the app's own cache on disk | Accepted |
| [0047](0047-card-kind-filter-leaving-out-and-own-inventory.md) | The kinds divide the cards; leaving kinds out; only my inventory | Accepted |
| [0048](0048-tournament-spielabend.md) | The Spielabend: duels paired by hand, a best-of for each duel | Accepted |
| [0049](0049-archetypes-from-the-game-and-one-sort.md) | Deckthemen from the game's data, one sort for every card list, the card window | Accepted |
| [0050](0050-classic-plus-handover-16-november.md) | Classic Plus: the hand-over of 16 November 2026 | Accepted |
