// Scrambles media-src/<lesson>.<lang>.mp4 into media/<lesson>.<lang>.dat
// (served by the Go backend). The site un-scrambles it in the browser
// (src/lib/media.ts), so the files on the server can't simply be
// downloaded and played. Files whose .dat is already newer are skipped.
// Run after adding or replacing a video:  npm run media
// Other folders:  node scripts/encode-media.mjs <src dir> <out dir>
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs'
import { join, parse } from 'node:path'

// Must match KEY in src/lib/media.ts.
const KEY = new TextEncoder().encode('tarmoq-darslari::k3y::2026::v1!!')

const srcDir = process.argv[2] ?? 'media-src'
const outDir = process.argv[3] ?? 'media'
mkdirSync(outDir, { recursive: true })

for (const file of readdirSync(srcDir).filter((f) => f.toLowerCase().endsWith('.mp4') && !f.includes('.tmp.'))) {
  const src = join(srcDir, file)
  const out = join(outDir, `${parse(file).name}.dat`)
  if (existsSync(out) && statSync(out).mtimeMs > statSync(src).mtimeMs) continue
  const data = readFileSync(src)
  for (let i = 0; i < data.length; i++) data[i] ^= KEY[i & 31]
  writeFileSync(out, data)
  console.log(`${file} -> ${out} (${(data.length / 1e6).toFixed(1)} MB)`)
}
