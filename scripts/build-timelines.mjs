// Builds backend/content/timelines/<lesson>.json from the course sources
// (lessonNN/timing.json = Uzbek, timing_en.json = English, timing_ru.json =
// Russian). A language is included only if its video is in media-src/.
//
// Both languages narrate the same scenes and lines in the same order, only
// at different times. The timeline lists matching time marks (start/end of
// every line and scene) for each language, so the player can switch language
// and continue from the same line.
//
//   node scripts/build-timelines.mjs [course dir]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const courseDir = process.argv[2] ?? 'C:/Users/PC/Desktop/ip_tutorial/course'
const lessons = JSON.parse(readFileSync('backend/content/lessons.json', 'utf8'))
const files = { uz: 'timing.json', en: 'timing_en.json', ru: 'timing_ru.json' }
const outDir = 'backend/content/timelines'
mkdirSync(outDir, { recursive: true })

// Named points in time, in the same order for every language.
function points(timing) {
  const p = new Map([['start', 0]])
  for (const s of timing.scenes) p.set(`scene:${s.id}`, s.start)
  for (const g of timing.segments) {
    p.set(`seg:${g.id}:a`, g.start)
    p.set(`seg:${g.id}:b`, g.start + g.dur)
  }
  p.set('end', timing.total)
  return p
}

lessons.forEach((lesson, i) => {
  const dir = join(courseDir, `lesson${String(i + 1).padStart(2, '0')}`)
  const byLang = Object.fromEntries(
    Object.entries(files)
      .filter(([lang, f]) => lang === 'uz' || (existsSync(join(dir, f)) && existsSync(`media-src/${lesson.id}.${lang}.mp4`)))
      .map(([lang, f]) => [lang, points(JSON.parse(readFileSync(join(dir, f), 'utf8')))]),
  )
  // Keep only points present in every language, ordered by Uzbek time,
  // and drop any that would make a timeline go backwards.
  const names = [...byLang.uz.keys()]
    .filter((n) => Object.values(byLang).every((p) => p.has(n)))
    .sort((a, b) => byLang.uz.get(a) - byLang.uz.get(b))
  const kept = []
  for (const n of names) {
    const prev = kept[kept.length - 1]
    if (!prev || Object.values(byLang).every((p) => p.get(n) > p.get(prev))) kept.push(n)
  }
  const out = {}
  for (const [lang, p] of Object.entries(byLang)) {
    out[lang] = { duration: p.get('end'), marks: kept.map((n) => Math.round(p.get(n) * 1000) / 1000) }
  }
  writeFileSync(join(outDir, `${lesson.id}.json`), JSON.stringify(out) + '\n')
  console.log(`${lesson.id}: ${kept.length} marks, ${Object.keys(out).join('/')}`)
})
