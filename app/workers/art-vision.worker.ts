// The background thread that recognizes cards on a photo by their artwork (ADR 0041). It loads the
// vision model (DINOv2-small) and the index of all catalog artworks, cuts square windows out of the
// photo, turns each into a vector, brings the vectors of the whole photo to the catalog's side
// and asks the index which card's artwork each window shows. `app/utils/art-vision.ts` is the
// page's side of this. Everything stays on the device: the photo is handed over as a bitmap and
// only card ids come back.
import { AutoModel, env, Tensor } from '@huggingface/transformers'
import { AI_ASSETS, ART_FULL_PRECISION_WORKER, ART_PROCESSOR_WORKER, aiAssetServed } from '~/utils/ai-assets'
import { ART_DIMENSION, ART_REFINE_MIN_MARGIN, ART_REFINE_SHIFTS, ART_REFINE_ZOOMS, artVectorFromTokens, artWindows, bestMatch, cardsFromHits, centerArtIndex, correctForPhoto, matchFromSimilarities, meanVector, parseArtIndex, photoCorrection, refinementCandidates, refinementWindows } from '~~/shared/card-art'
import type { ArtCard, ArtHit, ArtIndex, ArtIndexMeta, ArtWindow } from '~~/shared/card-art'
import { createGpuMatcher } from './art-gpu'
import type { GpuMatcher } from './art-gpu'

export type ArtRotation = 0 | 90 | 270

export interface ArtScanRequest {
  id: number
  bitmap: ImageBitmap
  /** Turned this many degrees clockwise before looking; `'auto'` tries the three ways and takes the one with the most clear cards. */
  rotation: ArtRotation | 'auto'
  /** What to look at, instead of the plan for where the model runs: for tuning and tests. */
  tuning?: Partial<Plan>
}

export interface ArtScanResult {
  cards: ArtCard[]
  rotation: ArtRotation
  /** How clearly cards showed with the photo upright, turned right and turned left (empty when the way was given): for finding out why a photo was turned. */
  rotationScores: number[]
  /** The mean vector of the first pass's windows: averaged over many photos of several cards it is the index's `photoMean` (for tuning, see `scripts/art-index.mjs`). */
  windowMean: number[]
  /** Windows that were turned into a vector. */
  windows: number
  /** Where the model ran: the graphics card, or the processor (thirty times slower). */
  device: 'webgpu' | 'wasm'
  seconds: number
}

export type ArtStage = 'model' | 'index' | 'turning' | 'scanning' | 'matching' | 'refining'

export type ArtReply
  = | { id: number, type: 'progress', stage: ArtStage, percent: number | null, device?: 'webgpu' | 'wasm' }
    | { id: number, type: 'result', result: ArtScanResult }
    | { id: number, type: 'error', message: string }

const MODEL_ID = 'Xenova/dinov2-small'
const MODEL_INPUT = 224
/** The photo is looked at with this long edge, in pixels; the window sizes below are for it. */
const WORKING_EDGE = 1600
/**
 * Windows are embedded this many at a time. Larger batches keep the graphics card busier (the same photo took
 * 152, 105, 82 and 78 seconds at 4, 8, 16 and 32); the processor gains nothing from them.
 */
const batchSize = () => device === 'webgpu' ? 16 : 8

/**
 * What to look at. The artwork of a card is 9 % to 70 % of a photo's long edge, depending on how many
 * cards are on the photo, hence the window sizes. The graphics card looks at about 450 windows and
 * then 450 more around the places that matched; the processor takes thirty times as long per window
 * and gets a sparser first pass (a card is matched from up to half a window off) and a short closer
 * look, and the time it may take is longer.
 */
export interface Plan {
  sizes: readonly number[]
  stride: number
  shifts: readonly number[]
  zooms: readonly number[]
  /** Places that match a card in the first pass get a closer look if their card is this far ahead (and at most `places` of them). */
  minMargin: number
  places: number
  /** The three ways a photo can lie are tried on this many of its most textured windows each. */
  probeWindows: number
  /** Looking stops after this long, whatever is left: the cards found so far are returned. */
  milliseconds: number
  /** Places that matched this closely get a closer look too, however narrow their lead (a look-alike a hair ahead is common on a real photo); undefined: only the clear ones. */
  minSimilarity?: number
  /** How much of the usual number of windows a card needs to be listed or sure (see `cardsFromHits`): a sparser plan gives every card fewer windows. */
  supportScale: number
}
const PLANS: Record<'webgpu' | 'wasm', Plan> = {
  webgpu: { sizes: [150, 210, 290, 400, 560, 800, 1100], stride: 0.6, shifts: ART_REFINE_SHIFTS, zooms: ART_REFINE_ZOOMS, minMargin: ART_REFINE_MIN_MARGIN, places: 24, probeWindows: 40, milliseconds: 150_000, supportScale: 1, minSimilarity: 0.35 },
  wasm: { sizes: [210, 290, 400, 800], stride: 0.75, shifts: ART_REFINE_SHIFTS, zooms: [1], minMargin: ART_REFINE_MIN_MARGIN, places: 10, probeWindows: 40, milliseconds: 240_000, supportScale: 0.65 },
}

/** The plan for where the model runs, with whatever a test asked to change. */
function planFor(tuning?: Partial<Plan>): Plan {
  return { ...PLANS[device], ...tuning }
}

/** The first pass may use this share of the time; the rest is for the closer look. */
const FIRST_PASS_SHARE = 0.6
const ROTATION_PROBE_SIZE = 210
const ROTATION_PROBE_STRIDE = 0.6
/** The scores of the three ways are the sum over this many windows (the graphics card's probe); fewer windows are scaled up to it. */
const ROTATION_PROBE_REFERENCE = 40
/** A window of the probe counts for the part of its margin above this. */
const ROTATION_PROBE_FLOOR = 0.05
/** A photo whose windows are corrected mostly by the mean of other photos (see `photoCorrection`) shows few cards: only the sure ones are listed. */
const FEW_CARDS_OWN = 0.5
/** A photo whose upright score is this much is upright, and the other two ways are not tried (upright photos scored 0.26 to 0.91, those on their side 0.07 and 0.16). */
const ROTATION_UPRIGHT_SURE = 0.3
/** The upright way is kept when its score is at least this share of the best way's, or when no way scores at least the minimum. */
const UPRIGHT_SHARE = 0.6
const ROTATION_MIN_SCORE = 0.2
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]
/** A byte of a channel to what the model takes: (byte / 255 - mean) / std, as one multiplication and one subtraction. */
const SCALE = STD.map(std => 1 / (255 * std))
const OFFSET = MEAN.map((mean, c) => mean / STD[c]!)

const scope = self as unknown as { onmessage: ((event: MessageEvent<ArtScanRequest>) => void) | null, postMessage: (reply: ArtReply) => void }

type Model = (inputs: { pixel_values: Tensor }) => Promise<{ last_hidden_state: Tensor }>

let modelLoading: Promise<Model> | null = null
let indexLoading: Promise<ArtIndex> | null = null
let matcherLoading: Promise<GpuMatcher | null> | null = null
/** Where the model runs: the graphics card is thirty times faster than the processor. */
let device: 'webgpu' | 'wasm' = 'wasm'

/**
 * How the graphics card is to run the model, or null when it cannot (or was told not to). Half
 * precision is the small and quick way, and needs a card that computes in it and a browser that
 * has `Float16Array` to read its answers; the full precision model (88 MB, fetched from Hugging
 * Face, not shipped) is for the rest.
 */
async function webGpuPrecision(): Promise<'fp16' | 'fp32' | null> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> } }).gpu
  if (!gpu || self.name === ART_PROCESSOR_WORKER) {
    return null
  }
  try {
    const adapter = await gpu.requestAdapter()
    if (!adapter) {
      return null
    }
    const half = adapter.features.has('shader-f16') && (globalThis as { Float16Array?: unknown }).Float16Array !== undefined
    return half && self.name !== ART_FULL_PRECISION_WORKER ? 'fp16' : 'fp32'
  }
  catch {
    return null
  }
}

async function loadModel(id: number): Promise<Model> {
  modelLoading ??= (async () => {
    env.backends.onnx.wasm!.wasmPaths = `${AI_ASSETS}/onnx/`
    env.localModelPath = `${AI_ASSETS}/models/`
    env.allowLocalModels = await aiAssetServed(`models/${MODEL_ID}/config.json`)
    env.allowRemoteModels = true
    const files = new Map<string, { loaded: number, total: number }>()
    const create = async (where: 'webgpu' | 'wasm', dtype: 'fp16' | 'fp32' | 'q8') => await AutoModel.from_pretrained(MODEL_ID, {
      dtype,
      device: where,
      progress_callback: (event: { status: string, file?: string, loaded?: number, total?: number }) => {
        if (event.status === 'progress' && event.file && event.total) {
          files.set(event.file, { loaded: event.loaded ?? 0, total: event.total })
          const all = [...files.values()]
          const total = all.reduce((sum, file) => sum + file.total, 0)
          scope.postMessage({ id, type: 'progress', stage: 'model', percent: total > 0 ? Math.round((all.reduce((sum, file) => sum + file.loaded, 0) / total) * 100) : null })
        }
      },
    }) as unknown as Model

    const precision = await webGpuPrecision()
    if (precision) {
      try {
        const model = await create('webgpu', precision)
        // The first run compiles the graphics card's programs; a card that cannot run them fails here, not on the photo.
        await model({ pixel_values: new Tensor('float32', new Float32Array(3 * MODEL_INPUT * MODEL_INPUT), [1, 3, MODEL_INPUT, MODEL_INPUT]) })
        device = 'webgpu'
        return model
      }
      catch (error) {
        console.warn('[art] the graphics card could not run the model, using the processor', error)
      }
    }
    device = 'wasm'
    return await create('wasm', 'q8')
  })().catch((error) => {
    modelLoading = null
    throw error
  })
  return modelLoading
}

async function loadIndex(): Promise<ArtIndex> {
  indexLoading ??= (async () => {
    const [meta, binary] = await Promise.all([
      fetch(`${AI_ASSETS}/art/index.json`).then(response => response.ok ? response.json() as Promise<ArtIndexMeta> : Promise.reject(new Error(`The artwork index answered ${response.status}`))),
      fetch(`${AI_ASSETS}/art/index.bin`).then(response => response.ok ? response.arrayBuffer() : Promise.reject(new Error(`The artwork index answered ${response.status}`))),
    ])
    return centerArtIndex(parseArtIndex(meta, binary))
  })().catch((error) => {
    indexLoading = null
    throw error
  })
  return indexLoading
}

/** The photo drawn with the long edge `edge`, turned `rotation` degrees clockwise. */
function drawPhoto(bitmap: ImageBitmap, edge: number, rotation: ArtRotation): OffscreenCanvas {
  const scale = edge / Math.max(bitmap.width, bitmap.height)
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = new OffscreenCanvas(rotation === 0 ? width : height, rotation === 0 ? height : width)
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.imageSmoothingQuality = 'high'
  if (rotation === 0) {
    context.drawImage(bitmap, 0, 0, width, height)
  }
  else {
    context.translate(canvas.width / 2, canvas.height / 2)
    context.rotate((rotation * Math.PI) / 180)
    context.drawImage(bitmap, -width / 2, -height / 2, width, height)
  }
  return canvas
}

/** How much a window has to look at (gradient strength); flat paper, mats and sleeves have little. */
function windowEnergies(photo: OffscreenCanvas, windows: ArtWindow[]): number[] {
  const shrink = 4
  const width = Math.max(1, Math.round(photo.width / shrink))
  const height = Math.max(1, Math.round(photo.height / shrink))
  const small = new OffscreenCanvas(width, height)
  const context = small.getContext('2d', { willReadFrequently: true })!
  context.drawImage(photo, 0, 0, width, height)
  const pixels = context.getImageData(0, 0, width, height).data
  const stride = width + 1
  const integral = new Float64Array(stride * (height + 1))
  for (let y = 0; y < height; y += 1) {
    let row = 0
    for (let x = 0; x < width; x += 1) {
      let energy = 0
      if (x > 0 && y > 0 && x < width - 1 && y < height - 1) {
        for (let c = 0; c < 3; c += 1) {
          energy += Math.abs(pixels[(y * width + x + 1) * 4 + c]! - pixels[(y * width + x - 1) * 4 + c]!) + Math.abs(pixels[((y + 1) * width + x) * 4 + c]! - pixels[((y - 1) * width + x) * 4 + c]!)
        }
      }
      row += energy
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1]! + row
    }
  }
  return windows.map((window) => {
    const x0 = Math.floor(window.x / shrink)
    const y0 = Math.floor(window.y / shrink)
    const x1 = Math.min(width, Math.ceil((window.x + window.size) / shrink))
    const y1 = Math.min(height, Math.ceil((window.y + window.size) / shrink))
    const sum = integral[y1 * stride + x1]! - integral[y0 * stride + x1]! - integral[y1 * stride + x0]! + integral[y0 * stride + x0]!
    return sum / Math.max(1, (x1 - x0) * (y1 - y0))
  })
}

/** The windows, the most textured first. */
function byTexture(photo: OffscreenCanvas, windows: ArtWindow[]): ArtWindow[] {
  const energies = windowEnergies(photo, windows)
  return windows.map((window, i) => ({ window, energy: energies[i]! })).sort((a, b) => b.energy - a.energy).map(entry => entry.window)
}

const patchCanvas = new OffscreenCanvas(MODEL_INPUT, MODEL_INPUT)
const patchContext = patchCanvas.getContext('2d', { willReadFrequently: true })!
patchContext.imageSmoothingQuality = 'high'

/** The windows' pixels as normalized CHW floats for the model, resampled from the photo by the browser. */
function windowTensor(photo: OffscreenCanvas, windows: ArtWindow[]): Tensor {
  const plane = MODEL_INPUT * MODEL_INPUT
  const data = new Float32Array(windows.length * 3 * plane)
  windows.forEach((window, n) => {
    patchContext.drawImage(photo, window.x, window.y, window.size, window.size, 0, 0, MODEL_INPUT, MODEL_INPUT)
    const rgba = patchContext.getImageData(0, 0, MODEL_INPUT, MODEL_INPUT).data
    const base = n * 3 * plane
    for (let i = 0, j = 0; i < plane; i += 1, j += 4) {
      data[base + i] = rgba[j]! * SCALE[0]! - OFFSET[0]!
      data[base + plane + i] = rgba[j + 1]! * SCALE[1]! - OFFSET[1]!
      data[base + 2 * plane + i] = rgba[j + 2]! * SCALE[2]! - OFFSET[2]!
    }
  })
  return new Tensor('float32', data, [windows.length, 3, MODEL_INPUT, MODEL_INPUT])
}

/** One batch through the model: the vector of each window. */
async function runModel(model: Model, tensor: Tensor, count: number): Promise<Float32Array[]> {
  const { last_hidden_state: hidden } = await model({ pixel_values: tensor })
  const tokens = hidden.dims[1]!
  return Array.from({ length: count }, (_, n) => artVectorFromTokens(hidden.data as ArrayLike<number>, n * tokens * ART_DIMENSION, tokens))
}

/** Lets the page's messages and the browser's own work in between long loops. */
function breathe(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

interface Embedded {
  windows: ArtWindow[]
  vectors: Float32Array[]
}

/**
 * Turns windows into vectors, batch by batch, until none is left or the time is up. While the model
 * (on the graphics card) works on one batch, the pixels of the next are prepared here; the model
 * calls themselves run one after the other.
 */
async function embedWindows(
  model: Model,
  photo: OffscreenCanvas,
  windows: ArtWindow[],
  deadline: number,
  report?: (done: number, total: number) => void,
): Promise<Embedded> {
  const embedded: Embedded = { windows: [], vectors: [] }
  let running: { batch: ArtWindow[], vectors: Promise<Float32Array[]> } | null = null
  const collect = async () => {
    if (running) {
      embedded.vectors.push(...await running.vectors)
      embedded.windows.push(...running.batch)
      report?.(embedded.windows.length, windows.length)
    }
  }
  for (let at = 0; at < windows.length && performance.now() < deadline; at += batchSize()) {
    const batch = windows.slice(at, at + batchSize())
    const next = { batch, vectors: runModel(model, windowTensor(photo, batch), batch.length) }
    await collect()
    running = next
  }
  await collect()
  return embedded
}

/** The graphics card's matcher for the index, when the model runs there and the card can do it. */
function gpuMatcher(index: ArtIndex): Promise<GpuMatcher | null> {
  if (device !== 'webgpu') {
    return Promise.resolve(null)
  }
  matcherLoading ??= createGpuMatcher(index)
  return matcherLoading
}

/** What each window shows, as the best card for it. `vectors` are the windows' corrected vectors (`photoCorrection`). */
async function matchWindows(index: ArtIndex, windows: ArtWindow[], vectors: Float32Array[], report?: (done: number, total: number) => void): Promise<ArtHit[]> {
  const hits: ArtHit[] = []
  const matcher = await gpuMatcher(index)
  if (matcher) {
    try {
      const scores = await matcher.similarities(vectors)
      vectors.forEach((_vector, n) => {
        const match = matchFromSimilarities(index.cardIds, scores, n * index.cardIds.length)
        if (match) {
          hits.push({ ...match, window: windows[n]! })
        }
      })
      report?.(vectors.length, vectors.length)
      return hits
    }
    catch (error) {
      console.warn('[art] the graphics card could not match, using the processor', error)
      matcherLoading = Promise.resolve(null)
      hits.length = 0
    }
  }
  for (const [n, vector] of vectors.entries()) {
    const match = bestMatch(index, vector)
    if (match) {
      hits.push({ ...match, window: windows[n]! })
    }
    if (report && n % 8 === 7) {
      report(n + 1, vectors.length)
      await breathe()
    }
  }
  report?.(vectors.length, vectors.length)
  return hits
}

/** How clearly a photo laid this way shows cards, from a few of its most textured windows. */
async function rotationScore(model: Model, index: ArtIndex, bitmap: ImageBitmap, rotation: ArtRotation, windows: number): Promise<{ score: number, embedded: number }> {
  const photo = drawPhoto(bitmap, WORKING_EDGE, rotation)
  const probe = byTexture(photo, artWindows(photo.width, photo.height, [ROTATION_PROBE_SIZE], ROTATION_PROBE_STRIDE)).slice(0, windows)
  const embedded = await embedWindows(model, photo, probe, Infinity)
  const hits = await matchWindows(index, embedded.windows, correctForPhoto(embedded.vectors, undefined, index.photoMean))
  // As if there were `ROTATION_PROBE_REFERENCE` windows, so the minimum below holds for the sparser probe of the processor too.
  const sum = hits.reduce((total, hit) => total + Math.max(0, hit.margin - ROTATION_PROBE_FLOOR), 0)
  return { score: sum * ROTATION_PROBE_REFERENCE / Math.max(1, probe.length), embedded: probe.length }
}

function windowKey(window: ArtWindow): string {
  return `${window.x},${window.y},${window.size}`
}

/**
 * A closer look at the places that matched a card: windows around each of them, moved and zoomed a
 * little, because no window of the first pass sits exactly on the artwork and one that does matches
 * it far better. Returns the hits of the new windows.
 */
async function lookCloser(
  model: Model,
  index: ArtIndex,
  photo: OffscreenCanvas,
  first: ArtHit[],
  correct: (vector: Float32Array) => Float32Array,
  report: (done: number, total: number) => void,
  deadline: number,
  tuning?: Partial<Plan>,
): Promise<{ hits: ArtHit[], embedded: number }> {
  const plan = planFor(tuning)
  const seen = new Set(first.map(hit => windowKey(hit.window)))
  const windows: ArtWindow[] = []
  for (const candidate of refinementCandidates(first, plan.minMargin, plan.places, plan.minSimilarity)) {
    for (const window of refinementWindows(candidate.window, photo.width, photo.height, plan.shifts, plan.zooms)) {
      if (!seen.has(windowKey(window))) {
        seen.add(windowKey(window))
        windows.push(window)
      }
    }
  }
  const embedded = await embedWindows(model, photo, windows, deadline, report)
  return { hits: await matchWindows(index, embedded.windows, embedded.vectors.map(vector => correct(vector))), embedded: embedded.windows.length }
}

/**
 * Which way the photo lies: cards on their side look like nothing to the model, so the three ways are tried
 * on the most textured windows, the upright one first, which is enough for most photos.
 */
async function findRotation(request: ArtScanRequest, model: Model, index: ArtIndex, plan: Plan): Promise<{ rotation: ArtRotation, embedded: number, scores: number[] }> {
  if (request.rotation !== 'auto') {
    return { rotation: request.rotation, embedded: 0, scores: [] }
  }
  let best = { rotation: 0 as ArtRotation, score: -1 }
  let upright = 0
  let embedded = 0
  const scores: number[] = []
  for (const [step, turn] of ([0, 90, 270] as const).entries()) {
    const probe = await rotationScore(model, index, request.bitmap, turn, plan.probeWindows)
    embedded += probe.embedded
    scores.push(Math.round(probe.score * 1000) / 1000)
    scope.postMessage({ id: request.id, type: 'progress', stage: 'turning', percent: Math.round(((step + 1) / 3) * 100), device })
    if (turn === 0) {
      upright = probe.score
      if (upright >= ROTATION_UPRIGHT_SURE) {
        return { rotation: 0, embedded, scores }
      }
    }
    if (probe.score > best.score) {
      best = { rotation: turn, score: probe.score }
    }
  }
  // A photo is upright unless another way is clearly better: when nothing matches well (a blurred
  // photo) the scores are noise, and noise must not turn the photo on its side.
  const turned = best.score >= ROTATION_MIN_SCORE && upright < best.score * UPRIGHT_SHARE
  return { rotation: turned ? best.rotation : 0, embedded, scores }
}

async function scanPhoto(request: ArtScanRequest): Promise<ArtScanResult> {
  const started = performance.now()
  const model = await loadModel(request.id)
  scope.postMessage({ id: request.id, type: 'progress', stage: 'index', percent: null, device })
  const index = await loadIndex()
  const plan = planFor(request.tuning)
  const deadline = performance.now() + plan.milliseconds
  const progress = (stage: ArtStage) => (done: number, total: number) => {
    scope.postMessage({ id: request.id, type: 'progress', stage, percent: Math.round((done / Math.max(1, total)) * 100), device })
  }

  const { rotation, embedded: probed, scores } = await findRotation(request, model, index, plan)
  const photo = drawPhoto(request.bitmap, WORKING_EDGE, rotation)
  const windows = byTexture(photo, artWindows(photo.width, photo.height, plan.sizes, plan.stride))
  const embedded = await embedWindows(model, photo, windows, performance.now() + plan.milliseconds * FIRST_PASS_SHARE, progress('scanning'))
  // What the photo itself looks like is learned from all its windows, then every window is matched.
  const correct = photoCorrection(embedded.vectors, undefined, index.photoMean)
  const first = await matchWindows(index, embedded.windows, embedded.vectors.map(vector => correct(vector)), progress('matching'))
  const closer = await lookCloser(model, index, photo, first, correct, progress('refining'), deadline, request.tuning)

  return {
    cards: cardsFromHits([...first, ...closer.hits], { onlySure: correct.own < FEW_CARDS_OWN, supportScale: plan.supportScale }),
    rotation,
    rotationScores: scores,
    windowMean: Array.from(meanVector(embedded.vectors)),
    windows: probed + embedded.windows.length + closer.embedded,
    device,
    seconds: Math.round((performance.now() - started) / 100) / 10,
  }
}

scope.onmessage = async ({ data }) => {
  try {
    const result = await scanPhoto(data)
    scope.postMessage({ id: data.id, type: 'result', result })
  }
  catch (error) {
    scope.postMessage({ id: data.id, type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
  finally {
    data.bitmap.close()
  }
}
