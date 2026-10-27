// Matching the windows of a photo with the artwork index on the graphics card (ADR 0041): 400
// windows against 14,600 vectors of 768 numbers are 4.5 billion multiplications, which the
// processor does in 20 seconds and a graphics card in a tenth of a second. The result is the
// same as `similarities()` in shared/card-art.ts, which stays the version for the processor
// when there is no WebGPU. Used from the artwork worker only.
import { ART_PARTS, ART_VECTOR } from '~~/shared/card-art'
import type { ArtIndex } from '~~/shared/card-art'

// The part of the WebGPU interface used here; the types are not in TypeScript's own library.
interface GpuBuffer {
  mapAsync: (mode: number) => Promise<void>
  getMappedRange: () => ArrayBuffer
  unmap: () => void
  destroy: () => void
}
interface GpuBindGroup { readonly kind?: 'bind-group' }
interface GpuPipeline { getBindGroupLayout: (index: number) => unknown }
interface GpuEncoder {
  beginComputePass: () => { setPipeline: (pipeline: GpuPipeline) => void, setBindGroup: (index: number, group: GpuBindGroup) => void, dispatchWorkgroups: (x: number, y: number) => void, end: () => void }
  copyBufferToBuffer: (from: GpuBuffer, fromOffset: number, to: GpuBuffer, toOffset: number, size: number) => void
  finish: () => unknown
}
interface GpuDevice {
  createBuffer: (descriptor: { size: number, usage: number }) => GpuBuffer
  createShaderModule: (descriptor: { code: string }) => unknown
  createComputePipeline: (descriptor: { layout: 'auto', compute: { module: unknown, entryPoint: string } }) => GpuPipeline
  createBindGroup: (descriptor: { layout: unknown, entries: Array<{ binding: number, resource: { buffer: GpuBuffer } }> }) => GpuBindGroup
  createCommandEncoder: () => GpuEncoder
  queue: { writeBuffer: (buffer: GpuBuffer, offset: number, data: ArrayBufferView) => void, submit: (commands: unknown[]) => void }
  destroy: () => void
}
interface GpuAdapter {
  features: Set<string>
  limits: { maxStorageBufferBindingSize: number, maxBufferSize: number }
  requestDevice: (descriptor?: { requiredLimits?: Record<string, number> }) => Promise<GpuDevice>
}

const STORAGE = 0x80
const COPY_DST = 0x8
const COPY_SRC = 0x4
const MAP_READ = 0x1
const UNIFORM = 0x40
const READ_MODE = 1

/** Windows are multiplied this many at a time, which bounds the size of the answer buffer. */
const WINDOWS_PER_ROUND = 256
const WORKGROUP = 64

const SHADER = `
struct Sizes { windows: u32, vectors: u32 }
@group(0) @binding(0) var<storage, read> index: array<f32>;
@group(0) @binding(1) var<storage, read> queries: array<f32>;
@group(0) @binding(2) var<storage, read_write> scores: array<f32>;
@group(0) @binding(3) var<uniform> sizes: Sizes;

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let vector = id.x;
  let window = id.y;
  if (vector >= sizes.vectors || window >= sizes.windows) {
    return;
  }
  var sum = 0.0;
  let base = window * ${ART_VECTOR}u;
  // The index is stored dimension by dimension, so neighbouring threads read neighbouring numbers.
  for (var d = 0u; d < ${ART_VECTOR}u; d = d + 1u) {
    sum = sum + index[d * sizes.vectors + vector] * queries[base + d];
  }
  scores[window * sizes.vectors + vector] = sum / ${ART_PARTS}.0;
}
`

export interface GpuMatcher {
  /** `queries.length × index size` similarities, one row per query, as `similarities()` gives them. */
  similarities: (queries: readonly Float32Array[]) => Promise<Float32Array>
  destroy: () => void
}

/** The graphics card's way to the index, or null when this browser or this card cannot do it. */
export async function createGpuMatcher(index: ArtIndex): Promise<GpuMatcher | null> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<GpuAdapter | null> } }).gpu
    const adapter = await gpu?.requestAdapter()
    if (!adapter) {
      return null
    }
    const vectors = index.cardIds.length
    const indexBytes = vectors * ART_VECTOR * 4
    const limit = Math.min(adapter.limits.maxStorageBufferBindingSize, adapter.limits.maxBufferSize)
    if (vectors === 0 || indexBytes > limit) {
      return null
    }
    const device = await adapter.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: limit, maxBufferSize: limit } })

    // The index as floats, dimension by dimension (the scales of the int8 values are folded in).
    const transposed = new Float32Array(vectors * ART_VECTOR)
    for (let i = 0; i < vectors; i += 1) {
      for (let part = 0; part < ART_PARTS; part += 1) {
        const scale = index.scales[i * ART_PARTS + part]!
        const from = i * ART_VECTOR + part * (ART_VECTOR / ART_PARTS)
        for (let d = 0; d < ART_VECTOR / ART_PARTS; d += 1) {
          transposed[(part * (ART_VECTOR / ART_PARTS) + d) * vectors + i] = index.values[from + d]! * scale
        }
      }
    }
    const indexBuffer = device.createBuffer({ size: indexBytes, usage: STORAGE | COPY_DST })
    device.queue.writeBuffer(indexBuffer, 0, transposed)

    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: SHADER }), entryPoint: 'main' } })
    const queryBuffer = device.createBuffer({ size: WINDOWS_PER_ROUND * ART_VECTOR * 4, usage: STORAGE | COPY_DST })
    const scoreBytes = WINDOWS_PER_ROUND * vectors * 4
    const scoreBuffer = device.createBuffer({ size: scoreBytes, usage: STORAGE | COPY_SRC })
    const readBuffer = device.createBuffer({ size: scoreBytes, usage: COPY_DST | MAP_READ })
    const sizeBuffer = device.createBuffer({ size: 8, usage: UNIFORM | COPY_DST })
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [indexBuffer, queryBuffer, scoreBuffer, sizeBuffer].map((buffer, binding) => ({ binding, resource: { buffer } })),
    })

    return {
      async similarities(queries) {
        const out = new Float32Array(queries.length * vectors)
        for (let from = 0; from < queries.length; from += WINDOWS_PER_ROUND) {
          const round = queries.slice(from, from + WINDOWS_PER_ROUND)
          const packed = new Float32Array(round.length * ART_VECTOR)
          round.forEach((query, n) => packed.set(query, n * ART_VECTOR))
          device.queue.writeBuffer(queryBuffer, 0, packed)
          device.queue.writeBuffer(sizeBuffer, 0, new Uint32Array([round.length, vectors]))
          const encoder = device.createCommandEncoder()
          const pass = encoder.beginComputePass()
          pass.setPipeline(pipeline)
          pass.setBindGroup(0, group)
          pass.dispatchWorkgroups(Math.ceil(vectors / WORKGROUP), round.length)
          pass.end()
          encoder.copyBufferToBuffer(scoreBuffer, 0, readBuffer, 0, round.length * vectors * 4)
          device.queue.submit([encoder.finish()])
          await readBuffer.mapAsync(READ_MODE)
          out.set(new Float32Array(readBuffer.getMappedRange(), 0, round.length * vectors), from * vectors)
          readBuffer.unmap()
        }
        return out
      },
      destroy() {
        device.destroy()
      },
    }
  }
  catch {
    return null
  }
}
