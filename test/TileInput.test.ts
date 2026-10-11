import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import TileInput from '../components/TileInput.vue'

/**
 * TileInput instant-submit behaviour:
 *  - typing a single different letter emits exactly one `submit` with the word,
 *  - a disabled board emits nothing,
 *  - only one submit fires even if more input events arrive.
 */
describe('TileInput instant submit', () => {
  it('emits submit with the new word on a single letter change', async () => {
    const wrapper = mount(TileInput, {
      props: {
        baseWord: 'FALL',
        length: 4,
        highlightIndex: null,
        accent: 'p1',
        disabled: false
      }
    })
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('H') // FALL -> HALL
    await flushPromises()

    const emitted = wrapper.emitted('submit')
    expect(emitted).toBeTruthy()
    expect(emitted!.length).toBe(1)
    expect(emitted![0][0]).toBe('HALL')
  })

  it('does not emit when disabled', async () => {
    const wrapper = mount(TileInput, {
      props: {
        baseWord: 'FALL',
        length: 4,
        highlightIndex: null,
        accent: 'p1',
        disabled: true
      }
    })
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('H')
    await flushPromises()
    expect(wrapper.emitted('submit')).toBeFalsy()
  })

  it('emits only once even on repeated input', async () => {
    const wrapper = mount(TileInput, {
      props: {
        baseWord: 'FALL',
        length: 4,
        highlightIndex: null,
        accent: 'p1',
        disabled: false
      }
    })
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('H')
    await inputs[1].setValue('X') // further typing after submit is ignored
    await flushPromises()
    expect(wrapper.emitted('submit')!.length).toBe(1)
  })
})
