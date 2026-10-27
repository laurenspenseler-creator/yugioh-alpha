# 0041: Cards on a photo are recognized by their artwork

## Status

Accepted. Extends [ADR 0040](0040-on-device-photo-and-speech-input.md): the reading of
printed names stays and the artwork is looked at beside it.

## Context

Reading the name printed on a card finds too little on real photos. The names are set in
a small-caps font, foil and sleeves reflect, a photo of a table is small, and names are
in German or English. Of the fifteen cards on a tester's photo the OCR found three; the
ones it missed (Gold-Sarkophag, Mystische Tomate, both foil) it could not read at any
size or with any preprocessing. A person recognizes a card at once, by its picture.

## Decision

### Compare the picture, not the letters

The cropped artwork of every card in the catalog (`catalog_card_image.image_url_cropped`,
YGOPRODeck, 14.6 thousand pictures) is turned into two vectors of 384 numbers by DINOv2-small
(`Xenova/dinov2-small`, input 224 px): the model's class token and the mean of its patch
tokens. A window cut out of a photo gets its vectors the same way; the card whose vectors are
closest (mean of the two cosines) is the card in the window, and the gap to the next *other*
card (the margin) tells a certain match from a lucky one. The artwork is the same in every
language, survives foil and glare far better than thin lettering, and every card has one.

### A photo is not a scan

Plain cosine against the whole catalog does not work on photographs: of the 36 cards on three
real photos it found 5 before it began to name wrong ones. Light, mat and sleeves move all
windows of a photo the same way, and a few generic pictures are close to everything. Two
corrections, both in `shared/card-art.ts`, fix this and are what makes the method work:

- **The catalog is centred**: the mean of all index vectors is taken off (per part) and the
  vectors are made unit vectors again (`centerArtIndex`, when the index is loaded).
- **The photo is centred on itself**: the mean of the vectors of all its windows is taken
  off, and so are the three directions in which they vary most (`photoCorrection`). That is
  what every window shares (the photo), not what makes a window a card. Nothing is known
  about which cards are on the photo; only the shape of the windows of the photo is used.

With these, cards are found that plain cosine never named. Things that did not help: whitening the catalog, correcting hubs by how close a catalog picture is to its
neighbours or to the windows of this photo (the second even hurts, because a real card is close
to many overlapping windows), and a colour layout check (not stable under light and foil).

### A closer look

No window of a first pass sits exactly on an artwork, and one that does matches it much better.
So the places that matched are looked at again: windows around the best window of each place,
moved by a fifth of its size and zoomed by 0.85 and 1.2 (`refinementWindows`), corrected with
what was learned from the first pass, and matched. For true cards this raises the margin by
half (0.12 to 0.17) and the similarity from 0.48 to 0.54; for the cards that matched by chance
hardly at all. That is what separates the two: a card on the photo is matched by many windows
around it, a lucky one by one or two. `cardsFromHits` lists a card when its best window is
0.07 ahead of every other card and 0.35 close and at least four windows matched it, and calls
it sure from 0.10, 0.40 and six windows. Places far apart with the same card are copies. A
place holds one card: a card that claims the place of a clearer one is not sure (a look-alike
or a generic picture), and neither of two that claim it about equally clearly is.

### The index

`pnpm ai:art` (`scripts/art-index.mjs`) downloads the artworks the index does not have yet,
embeds them with the same model and code (`artVectorFromTokens`) the browser uses and writes
`public/ai/art/index.json` (card id, artwork id and kind of each vector) and `index.bin` (per vector
two float32 scales and 768 int8 values: 23 MB). A rerun after a catalog sync fetches only the new
cards; a first run downloads about 2.5 GB and takes an hour or two. The index is committed: its
inputs are too big to fetch on every checkout. A new card is recognized only after the index
was rebuilt for it.

Every artwork has two vectors: the picture as it is, and a copy blurred by 1.5 pixels, which is
what a photo that is not quite sharp makes of it. The matching takes the better of the two for
a card. Without the blurred copies a photo blurred by 1.2 pixels found 4 or 5 of 6 cards and one
blurred by 1.6 pixels and made smaller found 4 or 5; with them 5 or 6, and on the sharp real
photos 10 and 11 of 15 cards instead of 8 and 10. (A photo that is blurred and smaller and
compressed to the point that a person has to guess is still not recognized.)

### The scan, in a worker, on the graphics card

`app/workers/art-vision.worker.ts` draws the photo with a long edge of 1600 px (turned a
quarter if it lies on its side: the most textured windows of each of the three ways are
compared by how clearly they match, which found the right way on every photo) and cuts square
windows of four sizes out of it, three fifths of a window apart, about 400 of them. The most
textured windows go first (paper, mats and sleeves are flat). Then the closer look, up to 30
places and about 700 windows.

A pass of the model in WebAssembly takes a second per window, which would make a photo a matter
of ten minutes. On a graphics card with WebGPU and half precision it takes 40 milliseconds, so the
worker runs the model there (`model_fp16.onnx`, 44 MB) and compares the windows with the index
there too (`app/workers/art-gpu.ts`, one compute shader: 400 windows against 14,600 vectors in
a tenth of a second where JavaScript needs twenty). Without WebGPU it uses the 8-bit model on
the processor with a sparser first pass and a shorter closer look, and gets a few minutes;
`localStorage['ygo-art-device'] = 'processor'` forces that way for testing.

The page talks to the worker through `recognizeArt()` (`app/utils/art-vision.ts`), the photo
goes over as a bitmap, and only card ids come back.

`PhotoImport.vue` runs this and the text reading at the same time, each in its own thread,
and sends the text lines and the recognized cards to `POST /api/cards/match-fragments`, which
puts them together: a card found both ways keeps the better score and the larger count, one
found by its artwork alone is listed under its catalog name, as sure or as doubtful.

## Consequences

- Recognition no longer depends on legible lettering. On three real photos (6 and 2 × 15
  cards) the artwork alone found 22 of 36 cards sure and 2 more doubtful, with no wrong sure card
  and 1 wrong doubtful one (the lettering found 3 of 15 on the same photos); on four synthetic
  photos of 6 cards it found all 24, with 2 wrong sure cards among them. The five that
  the artwork misses on the real photos are the two printed with an older picture, a
  near-black one (Schwarzes Loch) and two that are only weakly matched.
- A card printed with an older artwork than the catalog's current one is not found by its
  picture (Don Zaloog in the first prints shows swords, the catalog guns), and families with
  near-identical pictures can blur (Magic Jammer and Trap Jammer, which differ mostly in
  colour, which the model ignores). The printed name covers those: the two ways make up for each
  other's blind spots.
- The shipped data grows by 24 MB and 44 MB (the two models), 23 MB (index); the first photo
  loads them. The installer gets 68 MB bigger.
- A photo takes about a minute on a laptop's integrated graphics and a few minutes without
  WebGPU.
