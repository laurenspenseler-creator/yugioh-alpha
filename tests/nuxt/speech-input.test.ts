// "Diktieren": the size of the speech model is a choice (ADR 0040), the accurate one is the default.
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SpeechInput from '~/components/cards/SpeechInput.vue'

describe('SpeechInput', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('offers the accurate speech model by default and says how much the first use loads', async () => {
    const component = await mountSuspended(SpeechInput)

    expect(component.text()).toContain('Genau (langsamer)')
    expect(component.text()).toContain('etwa 240 MB')
  })

  it('tells that a card named twice is two copies when the microphone works', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: () => Promise.resolve() }, configurable: true })
    vi.stubGlobal('MediaRecorder', vi.fn())

    const component = await mountSuspended(SpeechInput)
    await flushPromises()

    expect(component.text()).toContain('nennst du eine Karte zweimal, sind es zwei Exemplare')
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'mediaDevices')
  })

  it('keeps the fast size when it was chosen before', async () => {
    localStorage.setItem('ygo-speech-quality', 'fast')

    const component = await mountSuspended(SpeechInput)

    expect(component.text()).toContain('Schnell')
    expect(component.text()).toContain('etwa 75 MB')
  })

  it('ignores a stored value it does not know', async () => {
    localStorage.setItem('ygo-speech-quality', 'whatever')

    const component = await mountSuspended(SpeechInput)

    expect(component.text()).toContain('Genau (langsamer)')
  })
})
