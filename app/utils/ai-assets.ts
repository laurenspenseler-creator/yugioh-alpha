// Where the on-device speech and photo reading find their files (ADR 0040): the
// code (ONNX runtime, OCR core) always ships with the app under /ai; the speech
// model and the OCR language data do too when the build has them
// (`pnpm ai:assets`, the desktop installer), and are fetched from their public
// hosts on first use otherwise.

export const AI_ASSETS = '/ai'

/**
 * The artwork worker (ADR 0041) runs its model on the graphics card when it can. Started with this
 * name it stays on the processor, which is how that way is tested: `localStorage['ygo-art-device']
 * = 'processor'` before the first photo.
 */
export const ART_PROCESSOR_WORKER = 'art-processor'
export const ART_DEVICE_KEY = 'ygo-art-device'

const probes = new Map<string, Promise<boolean>>()

/** Whether the app serves this file itself (a cheap request, remembered). */
export function aiAssetServed(path: string): Promise<boolean> {
  let probe = probes.get(path)
  if (!probe) {
    probe = fetch(`${AI_ASSETS}/${path}`, { method: 'HEAD' }).then(response => response.ok, () => false)
    probes.set(path, probe)
  }
  return probe
}
