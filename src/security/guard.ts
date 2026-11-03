// Deterrents against inspecting the page and capturing videos.
// A browser cannot fully prevent this; these measures stop casual attempts.

import { savedUiLang } from '../i18n/context'
import { STRINGS } from '../i18n/strings'

let locked = false

function pauseAll() {
  document.querySelectorAll('video').forEach((v) => v.pause())
}

/** DevTools detected: hide everything until the page is reloaded. */
function lock() {
  if (locked) return
  locked = true
  pauseAll()
  document.body.classList.add('locked')
  const el = document.createElement('div')
  el.className = 'guard-lock'
  const t = STRINGS[savedUiLang()]
  const box = document.createElement('div')
  const h = document.createElement('h1')
  const p = document.createElement('p')
  h.textContent = t.lockedTitle
  p.textContent = t.lockedText
  box.append(h, p)
  el.appendChild(box)
  document.body.appendChild(el)
}

/** Briefly hide the page, e.g. right after a PrintScreen key press. */
function shield() {
  pauseAll()
  document.body.classList.add('shield')
  window.setTimeout(() => document.body.classList.remove('shield'), 1500)
}

export function installGuard() {
  window.addEventListener(
    'keydown',
    (e) => {
      const k = e.key.toLowerCase()
      const mod = e.ctrlKey || e.metaKey
      const devtools = e.key === 'F12' || (mod && e.shiftKey && ['i', 'j', 'c', 'k'].includes(k))
      const source = mod && ['u', 's', 'p'].includes(k)
      if (devtools || source) {
        e.preventDefault()
        e.stopPropagation()
      }
      if (e.key === 'PrintScreen') shield()
    },
    true,
  )
  window.addEventListener('keyup', (e) => {
    if (e.key === 'PrintScreen') {
      shield()
      navigator.clipboard?.writeText('').catch(() => {})
    }
  })
  document.addEventListener('contextmenu', (e) => e.preventDefault())
  document.addEventListener('dragstart', (e) => e.preventDefault())

  // A `debugger` statement only pauses while DevTools is open, so a long
  // pause means someone is inspecting the page.
  const probe = new Function('debugger') as () => void
  window.setInterval(() => {
    const t = performance.now()
    probe()
    if (performance.now() - t > 100) lock()
  }, 1000)
}
