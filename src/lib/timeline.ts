// Converts a playback time between two language versions of a lesson.
// `from` and `to` are matching time marks (start/end of the same narration
// lines in each language); between marks the time is interpolated.
export function mapTime(t: number, from: number[], to: number[]): number {
  if (from.length < 2 || from.length !== to.length) return t
  if (t <= from[0]) return to[0]
  const last = from.length - 1
  if (t >= from[last]) return to[last]
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (from[mid] <= t) lo = mid
    else hi = mid
  }
  const span = from[hi] - from[lo]
  const frac = span > 0 ? (t - from[lo]) / span : 0
  return to[lo] + frac * (to[hi] - to[lo])
}
