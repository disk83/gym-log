/** What happened to a file handed to shareOrDownload. */
export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled'

/** Save a file through a normal browser download. */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser time to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Open the share sheet with the file (Web Share API), falling back to a
 * download if file sharing is not supported or fails. Call it straight from
 * the tap handler, with no await before it: iOS only allows share() during
 * the user's gesture.
 */
export async function shareOrDownload(file: File): Promise<ShareOutcome> {
  if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      // Files only: on iOS a title or text is shared as an extra .txt item.
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (e) {
      // The user closed the share sheet: not a failure, nothing to fall back to.
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    }
  }
  downloadFile(file)
  return 'downloaded'
}
