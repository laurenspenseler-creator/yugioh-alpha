# 0040: Photo and speech input run on the device, without an account or key

## Status

Accepted. Brings back what [ADR 0003](0003-client-side-ocr-and-speech-entry.md) decided
and [ADR 0010](0010-chat-assistant-with-tools.md) removed, with a different matcher and
a different speech engine. Amends [ADR 0029](0029-security-headers.md).

## Context

Tester feedback (round 2) asked for photos of several cards or whole decks to be read
in (deck import, "Schnellerfassung", upload via files, a guest's deck in a tournament)
and for dictating card names. The wish was: "somehow AI, but without costs and inside
the app". Everyone should be able to use it without an account at a provider.

A ChatGPT or Claude subscription can't be linked to another app: those plans are not
API access, and there is no sign-in flow that lets a third-party app spend them. What
exists is an API key, which bills per use (a free tier exists at some providers, for
example Gemini). The app already has such an optional setup for the assistant
(`NUXT_ASSISTANT_BASE_URL`, `…_API_KEY`, `…_MODEL`, ADR 0010); it stays the choice for
people who want a stronger model, but nothing here depends on it.

## Decision

### Photos: OCR in the browser, matching on the server

`tesseract.js` (WebAssembly) reads the photo in the browser, in English and German
together; the picture never leaves the device. `app/utils/photo-ocr.ts` makes three
passes over the image (the red channel at 2900 px, the red channel with a local
threshold at 2600 px, the grey picture at 3200 px) and keeps each text line with its
height relative to the median word height of the page. Only these lines go to
`POST /api/cards/match-fragments`. The set was chosen by measuring (the browser, five
photos with 30 cards: four composed of catalog images and one real photo of
laminated cards): 27 found, 3 wrong. The first set (two thresholds of the grey picture
and the grey picture) found 21; what one pass finds depends on small things like the
size it is read at, so the passes differ in channel, threshold and size. Names in foil
lettering on a reflective card are still often not read, and a small photo (a screenshot
of 900 px) loses more than a phone's own picture.

**Orientation.** A photo of cards lying on their side is read as nothing. When the first
pass finds fewer than three confident words, the same pass is made with the photo turned a
quarter each way and the way with the most confident words is the way the photo is read
(an upright photo pays nothing for this). On a real photo with 15 sideways cards this took
the result from 0 to 3 cards.

The matcher (`server/utils/card-fragments.ts`) compares them with the English names
of all cards (a bigram index, scored without order and tolerant to misread letters):

- A line counts as **a card name** when its text is big (height ≥ 1.5× the median) and
  either matches with a score ≥ 0.85 and its rarest word occurs in at most 150 card
  texts, or matches with ≥ 0.97; or when the same name is read at least twice with
  ≥ 0.92. Everyday words and names quoted inside effect texts therefore don't count.
- The **count** of a card is the largest number of name headers seen in one pass.
- Matches ≥ `SURE_SCORE` (0.85) are marked "sicher"; everything else is shown for
  review. Nothing is written without the user's review table (as in ADR 0003).

### Speech: Whisper in the browser

`@huggingface/transformers` runs `Xenova/whisper-base` (multilingual, 8-bit) as WASM.
The recording is transcribed, `spoken-card-lines.ts` turns "dreimal Ash Blossom" or
"2x Maxx C" into lines (also when a recognizer wrote digits and no commas, dropping
"[Music]" and the like, and keeping "D.D." together), and the quick capture's lookup and
review table take over. The browser's own `SpeechRecognition` (ADR 0003) was not used
again: it sends the audio to the browser vendor's servers and is missing in Firefox and
in Electron.

A recognizer writes a name it does not know the way it sounds ("Goldsako-Fark",
"Don Saluk"), and no word of that is in the card's name. So the lookup of
`server/utils/card-entry.ts` adds, when nothing near-sure was found by words, a search
over the letters of all English and German names (`closestCards` of
`card-fragments.ts`, the photo matcher's bigram index) and, below 0.6 there, over the
sound: the consonant skeleton of a name without its vowels (`phoneticKey`), whose score
is capped at 0.8 so it is never taken for sure. On synthetic dictation of 21 cards
this took base from 8 to 14 cards found and `whisper-small` from 14 to 18.

A card named twice is two copies, wherever in the list and however it was spelled: the
lines are merged by the card their best candidate is (from a score of 0.6), and a quantity
that comes from merging equal lines is no longer taken back by `resolveEntryLine` (it
was: "Kuriboh" said twice was one copy). `whisper-small` is far better (238 MB, about three
times slower: 33 s for 9 s of speech with four threads) and is the option if the
accuracy of base is not enough.

### Where the engines and models live

`pnpm ai:assets` (also part of `postinstall`) copies the OCR core and the ONNX runtime
into `public/ai` (git-ignored). The speech model and the English OCR data are not in
the repository (English and German OCR data): `pnpm ai:assets --models` downloads them (about 95 MB) into
`public/ai/models`, which the desktop build does (`desktop/scripts/prepare-server.mjs`),
so the installed app works offline from the first use. On the web the browser fetches
them from Hugging Face / the Tesseract data host on first use and keeps them in its
HTTP cache. `public/ai` is excluded from the service worker's precache.

### Security headers (amends ADR 0029)

- `Permissions-Policy`: `microphone=(self)` and `camera=(self)` instead of `()`.
- CSP: `script-src … 'wasm-unsafe-eval'` (WebAssembly may compile; no `eval` of
  strings), and `connect-src` additionally allows the model hosts (Hugging Face and its
  content hosts, the Tesseract data host). They deliver plain files, no script.
- Electron: a permission handler allows only audio capture, and only for the app's own
  pages.

### Entry points

- Deck import dialog (also for a participant's deck in a tournament, which creates the
  deck in the organizer's account first and then adds it with the format check),
  `Schnellerfassung` and the files page (`inventory/files`): `PhotoImport` (several
  photos at once) and `SpeechInput`; both append lines to the list the page already
  parses, so the existing review table decides what is added.

## Consequences

- No cost, no account, no key; the photos and the voice stay on the device.
- The recognition is **not perfect**. Measured on test photos: a photo of one card is
  read reliably; in a photo of six cards about two thirds of the names are found, with
  a few wrong hits that the review table (with "sicher" marking) lets the user remove.
  Dictation of a single, rarely used word can be misheard. This is why the result is
  always a review list, never a direct write.
- The first use downloads the model on the web (about 95 MB), unless the build ships it.
  The installer is about 100 MB larger.
- The microphone needs a secure context (HTTPS, `localhost`, or the desktop app). A
  phone that opens the laptop's address over plain HTTP gets a file input
  (`accept="audio/*" capture`) that records with the phone's own recorder instead.
- A model on the server (or the assistant's key) could read photos better, but costs
  money per picture and sends the pictures out. It can be added later as an option,
  next to this, through the assistant's existing configuration.
