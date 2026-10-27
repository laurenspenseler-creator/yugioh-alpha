// The files the on-device speech and photo reading need at run time
// (docs/adr/0040-on-device-photo-and-speech-input.md), put under public/ai so the
// app serves them itself (the production security policy allows no CDN):
//
//   node scripts/ai-assets.mjs            copy the code (ONNX runtime, OCR core) from node_modules;
//                                         runs after every `pnpm install`
//   node scripts/ai-assets.mjs --models   also download the speech models (base and small), the vision
//                                         model for artwork and the OCR language data (about 360 MB),
//                                         so a build works offline; the desktop installer is built with this
//
// Without --models the app fetches the model and language data on first use from
// Hugging Face and the Tesseract data host. public/ai is not committed.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'ai')
const withModels = process.argv.includes('--models')

/** The folder of a package in pnpm's store, whichever version is installed. */
function packageDir(name) {
  const store = join(root, 'node_modules', '.pnpm')
  if (!existsSync(store)) {
    return null
  }
  const entry = readdirSync(store).find(folder => folder.startsWith(`${name.replace('/', '+')}@`))
  return entry ? join(store, entry, 'node_modules', name) : null
}

function copy(from, to) {
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
}

function copyCode() {
  const onnx = packageDir('onnxruntime-web')
  const core = packageDir('tesseract.js-core')
  const tesseract = packageDir('tesseract.js')
  if (!onnx || !core || !tesseract) {
    console.warn('ai-assets: onnxruntime-web, tesseract.js or tesseract.js-core is not installed yet; skipped')
    return
  }
  for (const file of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
    copy(join(onnx, 'dist', file), join(out, 'onnx', file))
  }
  copy(join(tesseract, 'dist', 'worker.min.js'), join(out, 'ocr', 'worker.min.js'))
  for (const file of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js']) {
    copy(join(core, file), join(out, 'ocr', 'core', file))
  }
  console.log('ai-assets: code copied to public/ai')
}

async function download(url, to) {
  if (existsSync(to) && statSync(to).size > 0) {
    return
  }
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`ai-assets: ${url} answered ${response.status}`)
  }
  mkdirSync(dirname(to), { recursive: true })
  writeFileSync(to, Buffer.from(await response.arrayBuffer()))
  console.log(`ai-assets: ${url.replace(/^https:\/\/[^/]+\//, '')} (${Math.round(statSync(to).size / 1024)} KB)`)
}

async function downloadModels() {
  // The seven files transformers.js reads for the quantized multilingual Whisper: base (about 75 MB,
  // the fast size) and small (about 240 MB, the accurate one that is the default).
  for (const model of ['Xenova/whisper-base', 'Xenova/whisper-small']) {
    for (const file of ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']) {
      await download(`https://huggingface.co/${model}/resolve/main/${file}`, join(out, 'models', model, file))
    }
  }
  // The vision model that recognizes artwork (ADR 0041): DINOv2-small, 8-bit (about 23 MB, for the
  // processor) and half precision (about 44 MB, for the graphics card, which is thirty times faster).
  const vision = 'Xenova/dinov2-small'
  for (const file of ['config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx', 'onnx/model_fp16.onnx']) {
    await download(`https://huggingface.co/${vision}/resolve/main/${file}`, join(out, 'models', vision, file))
  }
  // The Tesseract language data of the "4.0.0" set the library uses by default.
  for (const language of ['eng', 'deu']) {
    await download(`https://tessdata.projectnaptha.com/4.0.0/${language}.traineddata.gz`, join(out, 'ocr', 'lang', `${language}.traineddata.gz`))
  }
}

copyCode()
if (withModels) {
  await downloadModels()
}
