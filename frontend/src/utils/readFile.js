// Reading a user-picked file in the browser, with the checks the dialogs share.

export const MAX_FILE_BYTES = 1024 * 1024   // 1 MB — plenty for a spec or a test suite

/**
 * Resolve to { name, text } or reject with an Error whose message can be shown
 * to the user as-is. `accept` is a list of lowercase extensions, e.g. ['.md'].
 */
export function readTextFile(file, accept) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file chosen'))
    const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase()
    if (accept && !accept.includes(ext)) {
      return reject(new Error(`"${file.name}" is not a supported file type. Use ${accept.join(', ')}.`))
    }
    if (file.size > MAX_FILE_BYTES) {
      return reject(new Error(`"${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). The limit is 1 MB.`))
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Couldn't read "${file.name}".`))
    reader.onload = () => {
      const text = String(reader.result || '')
      // A binary file (PDF, Word, image...) decodes to replacement characters / NULs.
      if (text.includes('\u0000') || (text.match(/�/g) || []).length > 5) {
        return reject(new Error(`"${file.name}" doesn't look like a text file. Save it as plain text or Markdown and try again.`))
      }
      resolve({ name: file.name, text })
    }
    reader.readAsText(file)
  })
}
