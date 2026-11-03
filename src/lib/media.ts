// Videos are served XOR-scrambled (.dat, made by scripts/encode-media.mjs) and
// only become playable inside the page as a blob URL. This stops direct
// downloads and download managers; it is obfuscation, not DRM.

// Must match KEY in scripts/encode-media.mjs.
const KEY = new TextEncoder().encode('tarmoq-darslari::k3y::2026::v1!!')

export async function loadVideo(
  src: string,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(src, { signal })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total) onProgress(received / total)
  }

  const data = new Uint8Array(received)
  let offset = 0
  for (const c of chunks) {
    data.set(c, offset)
    offset += c.length
  }
  for (let i = 0; i < data.length; i++) data[i] ^= KEY[i & 31]

  return URL.createObjectURL(new Blob([data], { type: 'video/mp4' }))
}
