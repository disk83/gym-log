import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareOrDownload } from './share'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('shareOrDownload', () => {
  it('shares only the file, with no title or text (iOS saves those as an extra .txt)', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share, canShare: () => true })
    const file = new File(['{}'], 'gym-backup-2026-10-16.json', { type: 'application/json' })

    expect(await shareOrDownload(file)).toBe('shared')
    expect(share).toHaveBeenCalledTimes(1)
    expect(share.mock.calls[0][0]).toEqual({ files: [file] })
  })

  it('treats closing the share sheet as cancelled, not a failure', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'))
    vi.stubGlobal('navigator', { share, canShare: () => true })
    expect(await shareOrDownload(new File(['x'], 'a.json'))).toBe('cancelled')
  })
})
