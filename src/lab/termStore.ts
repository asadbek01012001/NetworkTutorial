import type { Running } from './hostCli.ts'
import { newSession, type IosSession } from './iosCli.ts'

/** Terminal history of one device, kept while the lab is open. */
export class TermStore {
  lines: string[]
  history: string[] = []
  session: IosSession = newSession()
  running: Running | null = null

  constructor(hint: string) {
    this.lines = [hint, '']
  }

  print(text: string, inline?: boolean) {
    if (inline) this.lines[this.lines.length - 1] += text
    else this.lines.push(...text.split('\n'))
    if (this.lines.length > 1500) this.lines.splice(0, 300)
  }
  clear() {
    this.lines = []
  }
  remember(line: string) {
    if (line.trim()) this.history.unshift(line)
  }
  setRunning(r: Running | null) {
    this.running = r
  }
}
