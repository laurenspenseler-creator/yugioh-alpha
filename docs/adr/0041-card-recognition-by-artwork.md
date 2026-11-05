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
to many overlapping windows), and a colour layout check as a filter (not stable under light and
foil; as a soft tie-break between the closest cards, with the tint of the light taken off, colour
does help, see below).

A photo of one card (or two) breaks the second correction: most of its windows show that card, so
the photo's own mean is the card, and taking it off takes the card off (exact catalog pictures
placed in a photo found 0 to 1 of 8 that way). When the windows differ mostly along one direction
(their strongest direction holds 32 % of their variance or more; a photo of many cards 9 to 20 %) the
index's `photoMean` is used instead, the mean window vector of ten photos of several cards, and in
between the two are mixed. Such a photo lists only its sure cards: all 8 were found, with no doubtful
junk from the frame and the text. The windows also include sizes up to 1,100 px, for the art of a
card that fills the frame.

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

A card that is listed also gets its copies counted by a looser measure: every place where it is
the closest card of at least two windows that are 0.35 close and 0.03 ahead is a copy, unless one
window holds two places (`looseCopies`). On a grid of twelve identical cards a look-alike is a hair
behind at every place, so no place is clear enough for the strict measure, which saw one or two
copies; the loose one sees four to nine. On 20 real photos (286 cards) the copies found went from
67 to 112 with none counted too many, and on eleven older photos from 74 to 75.

The places that get a closer look are the 48 best (it was 24) down to a similarity of 0.25 (it was
0.35), as many as the time allows (140 seconds in all on the graphics card, usually 30 to 40
places). On the hardest photos most of the cards that are missed are a card that no window of the
first pass sits on: it matches at 0.25 to 0.35, and with a window moved and zoomed onto it, at 0.5.
On five such photos (62 cards) it raised the cards found from 21 to 27 and the copies from 25 to 32
at about half as many windows again. The places after the 24th are the poorer ones: of 106 sure
right cards, 44 were found by the first pass, 43 by the first twelve places, 10 by the next twelve and
9 by the 24 after those, which took two fifths of the windows. A photo of one card or of the same
card twelve times (its windows share one direction, the `own` of the correction is below 0.5) gets
at most twelve places, and calls a card sure only from twice the windows (the cards of such photos
had 17 to 161 windows, a card that was not there but that the frame or the glare of a card put at
the top of a few windows 6 to 11): on four photos of twelve identical cards that found the same 22
of 48 copies with none wrong in about a minute instead of two.

### Colour, a second cue

The model sees shapes and is almost blind to colour, so two artworks with the same swirl or the same
blob in other colours are a hair apart for it: twelve Polymerization cards (a blue swirl with orange
dragons) were taken for Dowsing Fusion (green and purple) at half their windows. The colour of a
window of the photo and of an artwork of the catalog tell them apart (`shared/card-color.ts`): per
cell of a 3 × 3 grid, log(red / green) and log(blue / green), which does not depend on brightness.
The colour of every artwork is in `colors.bin` (18 int8 numbers each, 0.5 MB). Both sides have what
they share taken off first, the photo's windows their own mean (the tint of the light), the catalog
its mean; with the agreement of the two colours between -1 and 1, `rerankByColor` orders the best
eight cards of a window by similarity plus 0.1 times that agreement. The similarity stays the
model's, so the thresholds hold, and the margin is the gap of the scores. On 20 photos it made the
cards found 59 of 146 → 64, the sure ones 46 → 57, the wrong sure ones 25 → 20 and the wrong doubtful
ones 32 → 16. Other designs gave the same within two cards (a grid of 2 × 2, 4 × 4 or 6 × 6, the Lab
colour space, a hue histogram, the brightness of the cells); taking off the catalog's mean instead
of the photo's own was worse. An index without `colors.bin` works without the colour.

### Hubs

All 25 sure cards that were not on their photo (on the 20 photos) were hubs: cards that win windows
of photo after photo that they are not on, 40 to 500 windows each (Yum☆Yum☆Yummys, The Kaiju Files,
Millennium Revelation: generic pictures that match a sleeve, a shadow or the table). `index.json` has a
list of them (`hubs`, 86 cards since round 7 (50 before) that won at least five windows of at least four of 35 photos
without being on them), and `cardsFromHits` calls such a card sure only with a lead of 0.15, a
similarity of 0.5 and ten windows (a card needs 0.10, 0.40 and six). Taking the list from the other 19
photos for each photo in turn (leave one out) kept all 46 sure true cards and left 6 of the 25 wrong
sure ones. The list is estimated from photos with a known list of cards, like `photoMean`, and
`scripts/art-index.mjs` keeps it (`pnpm ai:art:hubs <folder>` estimates it, see the header of `scripts/art-hubs.mjs`); a card that is really on a photo and a hub is still listed as a
doubtful one, and confirmed by a name read from the photo or by the user in the review.

Round 7 (the same tester's 27 WhatsApp photos, 15 of them run again): the list grew to 86 cards
(Sacred Beasts Released, Red Medicine, Book of Moon, Maxx "C" … joined: half-covered windows of white
sleeves and dark arts win them). Taking the list from the photos of the other card sets only (35 photos,
14 groups of photos that show the same cards) kept all 114 sure true cards and left 8 of the 28 wrong
sure ones; before, a half-covered Marshmallon in a white sleeve was called Sacred Beasts Released
three times, "sure". Measured and not adopted the same day: a global photo-to-catalog shift of the
window vectors (mean of the oracle pairs; with the card sets of the test left out the right card is at
rank 1 for 63 % of the oracle windows instead of 55 %, but in the first pass it lists three times as
many wrong cards as doubtful, and it is the same bias a hub list corrects); a kernel-ridge version of it
did no better than the mean; runners-up of a place confirmed by some text (0 cards rescued on two
photos); beams in Whisper (the pipeline of transformers.js ignores `num_beams`: same text, same time);
levelling a window's light before the model (lifting dark windows to a usual brightness: oracle rank 1
on 8 photos 64 → 67 %, first pass unchanged; stretching each channel between its 2nd and 98th percentile:
63 %); a frame-class prior (spell / trap / monster / other): even with the class known exactly, rank 1 at
the oracle windows only goes from 85 to 93 of 146 cards, because most look-alikes share the class.

### Where the artworks are (round 8)

The sliding windows never sit on an artwork: a card is matched from windows half a window off, from the
side of the neighbouring card, and the evidence for it is spread over a hundred windows of which a few
count. The model itself knows where the artworks are. Looked at in tiles of 224 × 224 pixels (16 × 16
patches of 14 pixels, 48 tiles for a photo of 1200 × 1600), its patch tokens separate the table, the
cards and the pictures on them, also where sleeved cards touch (their borders are patches of their
own). `shared/card-art-boxes.ts` takes the tokens of the brightest quarter of the patches for the table,
calls the patches unlike it cards (Otsu on the cosine), and among them the patches like an artwork
(`artPrototype` in `index.json`: the mean token of the patches of 300 random catalog artworks) the
pictures; connected regions of a certain size and shape are the boxes. They sit within a patch of the real
artwork: 15 to 18 boxes on photos of 13 to 18 cards, 11 or 12 on a grid of twelve of one card. A few windows
(two sizes, five shifts of half a patch) are put on every box, about 150 for a photo, and **a box is a card**:
its clearest window decides, and a card on several boxes is that many copies (`cardsFromBoxes`).

What the windows are corrected by changed with it. They are all on artworks, so the strongest directions of
their variation are the cards themselves and `photoCorrection` takes the cards away; only the mean of the
windows is taken off (`alignedCorrection`). On seven photos of a deck of sixteen cards that found 63 cards sure
with 2 wrong where the same photos found 32 with 1 by sliding windows (the mean of many photos instead: 46 with
8 wrong). A photo of one card many times has a mean that is that card (its length is 0.89 to 0.94, that of
the windows of many different cards 0.78 to 0.84): there the mean of many photos is used, as `photoCorrection`
does for a photo of few cards, with a stretch between 0.85 and 0.88. Boxes of the same card look alike
(0.83 to 0.98, median 0.93, 63 pairs), those of different cards less so (median 0.65, 95 % below 0.78, at most
0.88 in 369 pairs); a box that is 0.85 alike a box that is sure for a card and not sure for another card is
one more copy of it, whatever it matched itself (in a grid of twelve of one card a look-alike is often a hair ahead).

Compared with the sliding scan, on the graphics card, over 44 photos with a known list of cards: 13 to 18
seconds a photo instead of 90 to 150; the 11 photos of 13 to 18 different cards (q set) 85 of 137 kinds sure
with 2 wrong sure, 118 of 178 copies; the 24 WhatsApp photos of the tester 116 of 182 kinds sure
with 4 wrong sure; the 9 photos of twelve of one card all sure, none wrong, 91 of 108 copies
(2 of 9 sure with the mean of the windows alone). A box is sure with a lead of 0.08 and a closeness of 0.4:
the first guess, 0.05, gave 91 and 125 kinds sure with 6 and 14 wrong ones; the table of leads is in
`ALIGNED_SURE_MARGIN` (on 16 photos 127 sure / 12 wrong at 0.05, 126 / 8 at 0.06, 125 / 7 at 0.07, 121 / 3 at 0.08,
110 / 1 at 0.10, the same in both groups of photos), and what falls between 0.03 and 0.08 is a doubtful card, listed
when a name read from the photo confirms it. Missed are cards the tokens do not set apart from the table
(foil in a sleeve, overexposed) and boxes that are cut by the edge or by another card; the wrong sure ones
are look-alikes of a hair's lead, as with sliding windows. Measured and not adopted: a larger input for the windows (336 instead of 224 pixels, to give the model finer patches: the ONNX
graph of the model has its position embeddings for 224 only, `/embeddings/Add` fails); more copies of the catalog's pictures made
to look like a photo (darker, hazy, less colour: 199, 198 and 198 of 251 boxes right against 200, on a catalog of 1,548
vectors with the cards of 16 photos and 1,500 others); finding the boxes the filters drop (on a phone photo of 16 cards three had none: a dark picture
split in two by a band, a bright one split by its glow, a third 9 x 6 patches, just too wide for the ratio of 1.5): putting pieces
with at most one patch between them together and letting the ratio go to 1.7 gave the boxes (13 → 16 on that
photo) and, on 15 photos, 80 to 82 kinds sure with 2 to 3 wrong for all four combinations of the two changes (without both: 81 and 2),
and over all 44 photos 5 kinds fewer sure and 2 more wrong ones: the cards that were missing are the ones the model has
trouble with anyway; a larger weight for the colour on the windows on the artworks (0.2 and 0.3 for 0.1: 97 and
90 kinds sure with 12 and 10 wrong ones, 11 photos, against 98 with 5); the true card among the first four of
a box that was wrong (8 of 35 wrong boxes, 3 of them a kind not found otherwise: the model does not have these
pictures, dark ones mostly, among its first guesses); the card most windows of a box agree on instead of the
clearest window's (117 vs 119 kinds sure on 14 photos, the same boxes right); four windows per box instead of ten, which
loses little (95 against 98 kinds sure on 11 photos) and is what the processor's plan takes: a photo took 262 seconds
there (10 of 13 cards sure, none wrong), where ten windows did not fit in the 240 seconds (5 of 13). Also tried: reading the name printed above each box (a strip a
little wider than the box, from a third of its height above to a tenth below its top edge, twice the working
size, as one line with Tesseract, grey and as ink on paper): on a photo of 13 cards it read 1 name correctly
(with the first cut, a third higher, 2 names); the text of these WhatsApp photos is about 15 pixels high. Where
the card is wrong it is nearly always a dark picture or a look-alike, and the boxes themselves are not the
problem: 220 boxes for 224 cards on 14 photos, 161 of them with a card of the photo as the clearest window's
(142 of them sure). A photo with fewer than three boxes (one card or two, no table to tell
it from) is read by the sliding windows as before, so is a photo of an index without `artPrototype`
(`scripts/art-index.mjs` keeps it like `photoMean` and `hubs`).

### What a photo does to a picture: the adapter (round 8b)

The blurred copy of the catalog (above) is one guess at the difference between a clean catalog picture and a window on a
photo; the model's vectors show the rest of it. A linear map from the vectors of windows on photos to the vectors of the
catalog pictures they show learns it, the same way for every card: a ridge regression towards the identity (`W = (T Xᵀ + λI)(X Xᵀ + λI)⁻¹`,
`fitArtAdapter` in `shared/card-art-adapter.ts`; 768 × 768 numbers, `public/ai/art/adapter.bin`, 2.4 MB, loaded like
`colors.bin` and left out when it is not there). The windows on the artworks (after `alignedCorrection`) are moved by it and each part is made a
unit vector again (`applyArtAdapter`); the sliding windows of the fallback are not. The pairs: every window of a box that was
sure and a card on the photo's known list (32 photos, 2,940 windows), against the vector of that card in the centred index (the
better of its two copies). No label is needed beyond the list of cards of a photo.

Held out by deck family (the cards of the photos that are tested are not in the pairs of the map that is tested; 5 families: the
three decks of the tester's 44 photos, 3 real phone photos of the tester's 15-card deck, 3 of the Dark Magician deck): with
the whole catalog and the plain matching, 477 boxes of 32 photos, the cards sure / wrong sure / kinds found were 294 / 14 / 248
without it and 358 / 2 / 285 with λ = 12 (360 / 1 / 284 with 6); on 16 photos the table over λ was 183 / 2 (λ 2), 184 / 2 (6),
184 / 1 (12), 180 / 2 (20), 175 / 3 (50), 169 / 5 (150) against 154 / 4. In the worker itself (colour and hub rule on), with a map of
its own for every family: 260 / 10 sure / wrong sure without, 288 / 6 with (λ = 10), copies counted 363 → 387, 17 seconds a photo
either way; the 18 photos of twelve of one card stayed at 18 of 18 sure, none wrong. The map in the repository is trained on all 32 photos
(λ = 10), so those photos are no longer a fair test of it: new photos of new decks are, and the first measurement to repeat
on them is the plan with `boxAdapter: false` against the usual. The pairs can be taken from more boxes (the doubtful ones whose card is the only one of the photo's list among the first four
of at least two windows: 3,550 windows instead of 2,660): 383 cards sure with 8 wrong ones against 358 with 2, so the sure ones
are not the same quality (the same at the same number of wrong ones); a softmax over the 60 closest vectors as a second fit on top of it
(fine-tuned from the map, Adam, 4 to 6 rounds) learns the training photos by heart (loss 0.001) and gives 362 to 392 sure with 13 wrong; a
shift per photo, the mean of what its sure boxes lack of the vectors of their cards, taken without any list: 380 sure with 5 wrong (367 at half of it).
The mean of each quarter of a picture's patch tokens, besides the vector of the whole, told the artworks apart
better on a mini catalog of 1,548 vectors without the adapter (216 of 251 boxes right against 204, 181 against 165 sure), and as a second look at
the closest 100 vectors of a window (`layout.bin`, 45 MB for all 29,162 vectors) in the worker, held out by family as above, with the adapter: 384 boxes right without
it, 391 with the quarters at a weight of 0.8 and 395 at 0.3, 288 / 294 cards sure with 6 wrong at the usual thresholds (0.3): not adopted, the
adapter has taken most of what the quarters add and the quarters themselves are not adapted. The same windows embedded again changed in light and sharpness (darker, lighter, blurred by a pixel, less colour, hazy, warm: 6 times
as many pairs) gave, held out by family and at the closeness of 0.45, 349 cards sure with 7 wrong for the lambda of 10 and 357 with 2
for a lambda of 40 against 354 with 2: no gain. A second and a third round of the fit, with the pairs taken from what the map of the round before
recognizes (3,600 windows instead of 2,700), gave 365 and 367 cards sure with 2 and 5 wrong ones against 358 and 2 for the first
(held out by family as above): within what these photos can tell, not adopted. A map from more photos should help (the pairs here are the
windows the pipeline already knew; it was 5 families only), and it can be refitted with `fitArtAdapter` from a
list of (window vector, centred catalog vector) pairs.

### Which way a photo lies (round 9)

The probe that turns a photo (the 40 most textured sliding windows, matched upright and turned, with the margins above 0.05 added
up; an upright photo had to score 0.3) was made for the sliding scan and no longer separates anything with the box pipeline: the
upright photos of 5 decks scored 0.0 to 0.1, so did the same photos turned, and a photo turned a quarter was left lying (10 and 9 of
12 cards sure, 12 of 12 with the right turn). A photo turned half way was not turned at all (the probe tried only a quarter each way);
it is read a little worse as it lies (7 sure against 8 and 11 against 12), and not with the whole of the time saved by the box pipeline.

The boxes tell it better. After the tiles are read upright (the boxes do not care much which way the cards lie), one window per box
(the two sizes of `alignedWindows`, shift 0) is matched with the photo as it is and with the same windows on the photo turned 90,
180 and 270 degrees (`turnWindow`: the window where it lies on the turned photo; the windows are cut from a canvas the photo is drawn
on turned, so they show what a turned photo would). The mean similarity of each box's clearest window is 0.62 to 0.83 the right way
up on 27 upright photos of 7 decks and 3 real phone photos, and at most 0.69 any other way on them (0.33 to 0.69 half a turn away,
0.48 to 0.67 a quarter away); the photo is turned when another way is at least 0.08 more similar than the way it lies (`chooseBoxTurn`). All 15
photos of 5 decks turned a quarter, a half or three quarters were turned back (8 of 11 cards for w01 and w05, 11 of 12, 12 of 12 and 12 of
12 for the others, the same as upright, none wrong more than upright), no upright photo was turned (42 photos), and the two real
phone photos of the tester's deck that lie on their side (rot1, rot2) were turned a quarter and read 11 of 15 sure instead of 10.
A photo that lies upright pays about one second for the three other ways; a turned photo pays the second read of the tiles too (23 to
26 seconds in all instead of 18). The sure count, the number of boxes above the sure thresholds, was the first score
tried and separated worse (a turned photo showed 11 sure boxes upright and 13 turned). The processor judges on at most 8 boxes
(`Plan.turnBoxes`, 64 windows instead of the up to 120 of the old probe): a photo turned a quarter was turned back and read 11 of 12
sure in 262 seconds, the same photo upright 12 of 12 in 196. A photo with fewer than three boxes upright still takes the old probe, and the sliding scan.

Smaller photos (five decks' photos, 2,000 pixels on the long edge, shrunk to 1,200, 900, 700 and 500 and saved at JPEG quality 85;
drawn up to the 1,600 pixels of the working picture), kinds found / sure on the five photos (11, 11, 12, 12 and 12 kinds): 8 / 8, 8 / 8,
11 / 11, 12 / 12 and 11 / 10 at 2,000 pixels; the same within one card at 1,200 and 900 pixels (one fewer sure on the third photo);
9 / 8, 8 / 8, 11 / 10, 12 / 12 and 11 / 10 at 700; 9 / 9, 8 / 8, 11 / 10, 11 / 10 and 9 / 9 at 500. A photo down to 700 pixels reads
as well as a large one; the warning about small photos in the hint is about much smaller ones than a phone sends. (The runs took
50 to 110 seconds instead of 18 because the browser pane was hidden: not a measure of the speed.)

Photos without a card (six wallpaper photos, pure noise, twelve plain coloured rectangles on a white table, a page of text) gave no
card sure on seven of the nine; a landscape and the noise gave one each (a card that won 50 and 151 of the roughly 450 sliding windows),
which is what the table of cards to check is for; not looked at further (a stricter rule for the sliding scan would have to be weighed
against the photos of a single card, which it also reads).

### The index

`pnpm ai:art` (`scripts/art-index.mjs`) downloads the artworks the index does not have yet,
embeds them with the same model and code (`artVectorFromTokens`) the browser uses and writes
`public/ai/art/index.json` (card id, artwork id and kind of each vector) and `index.bin` (per vector
two float32 scales and 768 int8 values: 23 MB), next to `colors.bin` (the colour of each vector's
artwork, 0.5 MB) and `adapter.bin` (what a photo does to a picture, 2.4 MB, learned from photos, see above; the
tool does not touch it). A rerun after a catalog sync fetches only the new cards; a first run downloads
about 2.5 GB and takes an hour or two (with `ART_CROPS_DIR` pointing at a folder of the cropped
artworks they are read from there, and `--colors-only` gives an index without colours its colours
and nothing else). The index is committed: its inputs are too big to fetch on every checkout. A new
card is recognized only after the index was rebuilt for it.

Every artwork has two vectors: the picture as it is, and a copy blurred by 1.5 pixels, which is
what a photo that is not quite sharp makes of it. The matching takes the better of the two for
a card. Without the blurred copies a photo blurred by 1.2 pixels found 4 or 5 of 6 cards and one
blurred by 1.6 pixels and made smaller found 4 or 5; with them 5 or 6, and on the sharp real
photos 10 and 11 of 15 cards instead of 8 and 10. (A photo that is blurred and smaller and
compressed to the point that a person has to guess is still not recognized.)

Round 8 made the copy blurrier, 3 pixels instead of 1.5: the artworks of a photo are only 130 to 190 pixels wide
and are enlarged to the 224 of the model, which is soft. On a catalog of 1,548 vectors (the cards of 16 photos and
1,500 others) the boxes found right were 200 of 251 with 1.5 pixels, 204 with 3, 200 with 4.5 and 199 with 6 (a copy
made small and enlarged again: 197 and 198), and with the index rebuilt for it (`blur(3px)` of the graphics card
for all 14,581 artworks, 15 minutes) the 44 photos with a known list of cards had 231 kinds sure instead of 210, with
8 wrong ones instead of 6, and the copies counted rose from 469 to 495 (the 11 photos of different cards 131 of 178 instead
of 118, none too many instead of 6). The tester's phone photos (rot1, rot2, user, three of a deck) stayed as they were, within a card.
With that index, 15 photos of 13 to 18 different cards, the windows on a box: sizes 1 and 1.15 of the box and five shifts found
132 kinds sure with 3 wrong ones; with a third size of 0.9 130 and 7, of 1.3 129 and 3 (7 copies too many), size 1.15 alone 101,
nine shifts instead of five 133 and 5. `scripts/art-index.mjs` builds the blurred copy with `BLURS = [0, 3]` now; `index.bin` was patched in place (the vectors with
`variants[i] === 1` replaced, the rest untouched).

### The scan, in a worker, on the graphics card

`app/workers/art-vision.worker.ts` first looks for the artworks in tiles and reads a photo that has three or
more of them by the windows on them (see above); what follows is the scan for the rest (and for every photo
before round 8). It draws the photo with a long edge of 1600 px (turned a
quarter if it lies on its side: the most textured windows of each of the three ways are
compared by how clearly they match, which found the right way on every photo; the upright way
comes first and a score of 0.3 or more ends the probe, because upright photos scored 0.26 to
0.91 and the two real photos on their side 0.07 and 0.16) and cuts square
windows of seven sizes (150 to 1,100 px: the art of a card is a tenth to two thirds of the
photo, depending on how many cards are on it) out of it, three fifths of a window apart, about
450 of them. The most textured windows go first (paper, mats and sleeves are flat). Then the
closer look, up to 48 places and about 1,250 windows (a photo of sixteen cards takes about two
minutes on a laptop's integrated graphics; the closer look is the last thing to be cut when the
140 seconds run out).

A pass of the model in WebAssembly takes a second per window, which would make a photo a matter
of ten minutes. On a graphics card with WebGPU and half precision it takes 40 to 55 milliseconds,
so the worker runs the model there (`model_fp16.onnx`, 44 MB; a card or browser that cannot do
half precision gets the 88 MB full precision model, fetched on first use) and compares the
windows with the index there too (`app/workers/art-gpu.ts`, one compute shader: 450 windows
against 29,000 vectors in a fraction of a second where JavaScript needs half a minute). Without
WebGPU it uses the 8-bit model on the processor with a sparser first pass (four sizes, three
quarters of a window apart, about 140 windows) and a shorter closer look (10 places, no zoom),
and takes two to three minutes on a desktop processor. A sparser look gives every card fewer
windows, so this plan asks for 65 % of the usual support (`supportScale`): on six test photos
that made 28 cards sure instead of 24 with none wrong, while 50 % let wrong doubtful ones in
and the graphics card's plan gained nothing from it. The photos of the real tests on the
processor: 14 sure cards of 36 (rot1 4, rot2 7, user 3), where the plan of the graphics card
finds 25. The recognition does not fall off slowly with fewer windows: the graphics card's plan
cut to 150 to 310 windows (a budget of 3 to 24 s) found 0 or 1 of the 15 cards of a real photo,
so a device much slower than a desktop processor is better served by waiting than by stopping early. `localStorage['ygo-art-device']` can be `'processor'` or `'full'`
to force either way for testing. The request can also carry a `tuning` (window sizes, stride,
the shape of the closer look), which is how the numbers in this document were found.

The page talks to the worker through `recognizeArt()` (`app/utils/art-vision.ts`), the photo
goes over as a bitmap, and only card ids come back.

`PhotoImport.vue` runs this and the text reading at the same time, each in its own thread,
and sends the text lines and the recognized cards to `POST /api/cards/match-fragments`, which
puts them together: a card found both ways keeps the better score and the larger count, one
found by its artwork alone is listed under its catalog name when the artwork was sure, or when
some text, however small or weak, resembled its name (two readings that do not depend on each
other agree). An artwork match that is not sure and has no such text is left out: over about fifty
photos, 8 of the 83 such matches were right, and the page lists a card under its catalog name,
which makes a wrong one look like a right one.

## Consequences

- Recognition no longer depends on legible lettering. On three real photos (6 and 2 × 15
  cards) the artwork alone found 22 of 36 cards sure and none wrong (the lettering found 3 of
  15 on the same photos); on four synthetic photos of 6 cards it found all 24, with 2 wrong sure
  cards among them. Over all test photos about one sure card in thirteen is wrong, and the review
  table is where those are settled. The cards the artwork misses on the real photos are the two
  printed with an older picture, a near-black one (Schwarzes Loch) and a few that are only weakly
  matched.
- A photo taken at an angle does not hurt much: four synthetic photos squeezed like a phone held
  at an angle (the far edge 30 % narrower, turned 4 degrees) were read 24 of 24 sure with none
  wrong. At 45 % and 9 degrees it is 11 of 12, with three wrong sure cards: slanted text boxes and
  the bare table match a card's picture by chance, from about as many windows as a real card, so
  nothing in a hit's margin, similarity or spread tells the two apart.
- Real photos from a phone are harder than the test photos. The tester's three photos of the same deck
  (1536 × 2048, cards in sleeves, 44 cards of 33 kinds) were read 24 of 33 kinds and 25 of 44 copies;
  on them the right card is often second, a hair behind a look-alike (Mirror Force behind "Embrace of
  the Tistina" by 0.003), or its picture matches only moderately (Pot of Greed 0.48, Jinzo 0.32). Giving
  every place that matched at least 0.35 a closer look, however narrow its lead (`minSimilarity`, up
  to 24 places), makes it 26 kinds and 27 copies (about a fifth more time); the places that are not
  clear are listed only when a name read from the photo confirms them, like any other doubtful match.
  Tried and dropped: counting runners-up as support (+5 kinds, 100 more wrong candidates), holding back
  cards that sit among many similar pictures (worse everywhere), finding copies by how alike two windows
  look (+2 copies in nine photos: two copies of one card look only 0.6 alike once the photo's own
  mean is taken out; compared as the model gives them and each place shifted and zoomed to its best,
  true copies look 0.68 to 0.84 alike and a wrong place 0.80, so no threshold tells them apart). Cards in a dense table cannot be found as blobs either (sleeves and frames
  touch). Reading the name of every place the artwork finds, cut out above the picture and read
  larger, got 2 of 33 kinds (most places are text boxes and table, the cut misses the bar), and
  reading again the lines the OCR had located but misread got 2 of 33: on a phone photo of 16 cards
  the OCR finds only a handful of name lines, so the names cannot make up for the artwork.
- A second round of real photos showed how much the first pass leaves. Twenty phone photos from the
  tester (three sets of 13 to 16 cards in sleeves on a white table, and eight photos of twelve times
  the same spell; 1500 × 2000 px) were read 59 of 146 kinds and 67 of 286 copies by the scan as it was,
  with 25 wrong sure cards. What is missed is mostly **alignment**, not recognition: of 146 cards,
  the right one was the closest card at the best of the ~1,000 windows for 99, among the three closest
  for 116 and among the sixteen for 134; with windows that a person placed on the 16 artworks of one
  photo (a fifth of a window off, three sizes) 11 of 16 cards were read where the scan read 5. The
  artworks there are 130 to 180 px, below the smallest window of the first pass, so a window that
  sits on one is rare; the closer look is what finds them, from places that match at 0.25 to 0.35.
  With the colour, the hubs, the loose copies and the wider closer look, on all 26 test photos (these
  20, the tester's three and three older real ones; colour weight 0.12, up to 190 s): sure cards
  88 → 106, wrong sure 27 → 7, copies 114 → 160 of 366 (the hubs were taken from the same photos; left
  out one photo at a time they keep every right card and 6 of the 25 wrong ones). With the final
  settings (colour weight 0.1, at most 140 s) on eleven of them, the six older photos and the five
  hardest: kinds 73 → 80 of 131, sure 58 → 70, copies 78 → 92, wrong sure 8 → 5, at about two minutes
  per photo instead of a minute and a half. The gain is on the hard photos (21 → 28 kinds of 62, sure
  15 → 23); on the six older ones, where the scan was already at 52 of 69 kinds, it is four sure cards
  and two copies more at 76 → 120 s, and the doubtful ones the colour and the hubs push down. Tried
  on these photos and dropped, each measured: windows of 128 and 150 px a third of a
  window apart all over the photo (2,000 windows, no better, more wrong), the places for the closer
  look chosen by texture instead of by similarity (+2 instead of +6 kinds), moving the windows of the
  closer look along the two axes only (half the windows, most of the gain gone: the offsets are
  diagonal), finding the lattice the found cards sit on and looking where it has gaps (the cards
  found are too few and too irregular), finding cards as blobs of colour, of texture or by the border
  of their artwork (works for cards with space between them, merges sleeves that touch, misses grey
  and dark cards), and summing the evidence of all windows of a place instead of counting the
  windows that name a card (+2 kinds, more wrong ones). Ideas left: card detection for exactly aligned
  windows (the biggest lever by the numbers above, but brittle on touching cards), photo-like copies of
  the artworks in the index (zoomed, tilted, glared; `buildindex2` in the lab builds them).
- A card printed with an older artwork than the catalog's current one is not found by its
  picture (Don Zaloog in the first prints shows swords, the catalog guns), and families with
  near-identical pictures can blur (Magic Jammer and Trap Jammer, which differ mostly in
  colour, which the model ignores). The printed name covers those: the two ways make up for each
  other's blind spots.
- The shipped data grows by 24 MB and 44 MB (the two models), 23 MB (index); the first photo
  loads them. The installer gets 68 MB bigger.
- A photo takes about a minute on a laptop's integrated graphics and two to three minutes without
  WebGPU (the text reading runs beside it and is not slower than that).
  WebGPU only exists in a secure context, so a phone that opens the laptop's address over plain
  HTTP gets the processor path (a few minutes, longer on a phone). The worker reports where the
  model runs with its progress, and the page then says that the photo will take minutes
  (`quickEntry.photo.art.slow`) instead of leaving the "about a minute" of the hint standing.
- The photo-mean correction needs more than one card on the photo or the `photoMean`: an
  index without it still works for photos of many cards, but not for one. `scripts/art-index.mjs`
  keeps the value it finds in an existing index; it is estimated from photos (the `windowMean` of a
  scan, averaged over several photos of several cards), not from the artworks.
- Not recognized at all yet: photos that are blurred and small and compressed to the point that a
  person has to guess, cards that are covered or cut off, and a card photographed from far below
  at a steep angle (not tested).
