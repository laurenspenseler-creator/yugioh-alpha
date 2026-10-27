// The page's side of recognizing cards by their artwork (ADR 0041): the photo goes to a worker
// (`app/workers/art-vision.worker.ts`) as a bitmap, and the cards it recognizes come back. The photo
// never leaves the device.
import type { ArtReply, ArtRotation, ArtScanRequest, ArtScanResult, ArtStage } from '~/workers/art-vision.worker'
import { ART_DEVICE_KEY, ART_PROCESSOR_WORKER } from '~/utils/ai-assets'

export type { ArtRotation, ArtScanResult } from '~/workers/art-vision.worker'

export interface ArtProgress {
  stage: ArtStage
  /** 0–100 within the stage, or null while it is not known. */
  percent: number | null
}

let worker: Worker | null = null
let lastRequest = 0

/** Whether this browser was told to keep the model on the processor (a switch for testing that way). */
function processorOnly(): boolean {
  try {
    return localStorage.getItem(ART_DEVICE_KEY) === 'processor'
  }
  catch {
    return false
  }
}

/** The background thread, started on first use and kept (it holds the model and the index). */
function artWorker(): Worker {
  worker ??= new Worker(new URL('../workers/art-vision.worker.ts', import.meta.url), { type: 'module', name: processorOnly() ? ART_PROCESSOR_WORKER : 'art' })
  return worker
}

/**
 * The cards on a photo, recognized by their artwork. `rotation` says how the photo lies (the way the
 * text reading found, if it did) or `'auto'` to find out.
 */
export async function recognizeArt(
  photo: Blob,
  options: { rotation?: ArtRotation | 'auto', tuning?: ArtScanRequest['tuning'], onProgress?: (progress: ArtProgress) => void } = {},
): Promise<ArtScanResult> {
  const bitmap = await createImageBitmap(photo)
  return await new Promise((resolve, reject) => {
    const thread = artWorker()
    lastRequest += 1
    const id = lastRequest

    const done = () => {
      thread.removeEventListener('message', onMessage)
      thread.removeEventListener('error', onFailure)
    }
    const onMessage = (event: MessageEvent<ArtReply>) => {
      const reply = event.data
      if (reply.id !== id) {
        return
      }
      if (reply.type === 'progress') {
        options.onProgress?.({ stage: reply.stage, percent: reply.percent })
        return
      }
      done()
      if (reply.type === 'result') {
        resolve(reply.result)
      }
      else {
        reject(new Error(reply.message))
      }
    }
    // The thread itself could not start (a blocked or missing script): start a new one next time.
    const onFailure = (event: ErrorEvent) => {
      done()
      thread.terminate()
      worker = null
      reject(new Error(event.message || 'The artwork worker failed'))
    }
    thread.addEventListener('message', onMessage)
    thread.addEventListener('error', onFailure)

    const request: ArtScanRequest = { id, bitmap, rotation: options.rotation ?? 'auto', tuning: options.tuning }
    thread.postMessage(request, [bitmap])
  })
}
