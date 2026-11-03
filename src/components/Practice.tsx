import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/context'
import { api, type PracticeKind, type PracticeResult, type PracticeStat, type PracticeTask, type RangeTask, type SubnetTask, type SwitchTask } from '../lib/api'

const KINDS: PracticeKind[] = ['switch', 'subnet', 'range']
const STATEMENTS = ['learn', 'broadcast', 'unicast-one', 'unicast-flood', 'unicast-drop'] as const

type Values = Record<string, string>

// Full-screen practice: tasks are generated and checked on the server.
export function Practice({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const [kind, setKind] = useState<PracticeKind>('switch')
  const [task, setTask] = useState<PracticeTask | null>(null)
  const [result, setResult] = useState<PracticeResult | null>(null)
  const [values, setValues] = useState<Values>({})
  const [ports, setPorts] = useState<Set<string>>(() => new Set())
  const [statements, setStatements] = useState<Set<string>>(() => new Set())
  const [stats, setStats] = useState<Record<PracticeKind, PracticeStat> | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState(false)
  // Opening a kind shows its unfinished task; only "Next" asks for a new random one.
  const [req, setReq] = useState({ n: 0, next: false })
  const [loaded, setLoaded] = useState(-1)
  const busy = checking || loaded !== req.n

  useEffect(() => {
    let alive = true
    ;(req.next ? api.practiceNew(kind) : api.practiceCurrent(kind))
      .then((p) => {
        if (!alive) return
        setTask(p)
        setResult(null)
        setValues({})
        setPorts(new Set())
        setStatements(new Set())
        setError(false)
      })
      .catch(() => alive && setError(true))
      .finally(() => alive && setLoaded(req.n))
    return () => {
      alive = false
    }
  }, [kind, req])
  useEffect(() => {
    api
      .practiceStats()
      .then((r) => setStats(r.stats))
      .catch(() => {})
  }, [result])

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', h)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const check = async () => {
    if (!task || result) return
    setChecking(true)
    try {
      const answers = task.kind === 'switch' ? { ports: [...ports], statements: [...statements] } : values
      setResult(await api.practiceCheck(task.id, answers))
    } catch {
      setError(true)
    } finally {
      setChecking(false)
    }
  }

  const kindLabel: Record<PracticeKind, string> = { switch: t.kindSwitch, subnet: t.kindSubnet, range: t.kindRange }
  const stat = stats?.[kind]
  const setValue = (k: string, v: string) => setValues((old) => ({ ...old, [k]: v }))
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, v: string) => {
    if (result) return
    const n = new Set(set)
    if (n.has(v)) n.delete(v)
    else n.add(v)
    setter(n)
  }

  return (
    <div className="practice" role="dialog" aria-modal="true" aria-label={t.practiceTitle}>
      <header className="practice-bar">
        <h1>{t.practiceTitle}</h1>
        <div className="practice-tabs">
          {KINDS.map((k) => (
            <button
              key={k}
              className={k === kind ? 'active' : ''}
              onClick={() => {
                if (k === kind) return
                setKind(k)
                setReq((r) => ({ n: r.n + 1, next: false }))
              }}
            >
              {kindLabel[k]}
            </button>
          ))}
        </div>
        {stat && <span className="practice-stat">{t.practiceStats(stat.done, stat.perfect)}</span>}
        <button className="mbtn close" onClick={onClose} aria-label="✕">
          ✕
        </button>
      </header>

      <div className="practice-body">
        {error && <div className="auth-error">{t.noServer}</div>}
        {task && <div className="practice-num">{t.taskNum(task.num, task.count)}</div>}
        {task?.kind === 'switch' && (
          <SwitchView
            task={task.task as SwitchTask}
            ports={ports}
            statements={statements}
            onPort={(p) => toggle(ports, setPorts, p)}
            onStatement={(s) => toggle(statements, setStatements, s)}
            result={result}
          />
        )}
        {task?.kind === 'subnet' && <SubnetView task={task.task as SubnetTask} values={values} onValue={setValue} result={result} />}
        {task?.kind === 'range' && <RangeView task={task.task as RangeTask} values={values} onValue={setValue} result={result} />}
      </div>

      <footer className="practice-foot">
        {result && (
          <span className={`practice-score ${result.score === result.total ? 'good' : 'bad'}`}>
            {result.score === result.total ? `✓ ${t.allRight}` : t.result(result.score, result.total)}
          </span>
        )}
        {!result && (
          <button className="tbtn primary" onClick={check} disabled={busy || !task}>
            {t.check}
          </button>
        )}
        <button className={`tbtn ${result ? 'primary' : ''}`} onClick={() => setReq((r) => ({ n: r.n + 1, next: true }))} disabled={busy}>
          {t.newTask} →
        </button>
      </footer>
    </div>
  )
}

// ---------------- switch ----------------

interface SwitchProps {
  task: SwitchTask
  ports: Set<string>
  statements: Set<string>
  onPort: (p: string) => void
  onStatement: (s: string) => void
  result: PracticeResult | null
}

function SwitchView({ task, ports, statements, onPort, onStatement, result }: SwitchProps) {
  const { t } = useI18n()
  const correct = result?.correct as { ports: string[]; statements: string[] } | undefined
  const stText: Record<string, string> = {
    learn: t.stLearn,
    broadcast: t.stBroadcast,
    'unicast-one': t.stUnicastOne,
    'unicast-flood': t.stUnicastFlood,
    'unicast-drop': t.stUnicastDrop,
  }
  const mark = (picked: boolean, right: boolean | undefined) => (right === undefined ? '' : right ? 'right' : picked ? 'wrong' : '')
  return (
    <div className="sw">
      <p className="practice-task">{t.swTask}</p>
      <div className="sw-top">
        <div className="sw-tables">
          <h3>{t.frame}</h3>
          <div className="pgrid frame-grid">
            {[
              [t.preamble, ''],
              [t.dstMac, task.dst],
              [t.srcMac, task.src],
              [t.lenType, ''],
              [t.payload, ''],
              [t.fcs, ''],
            ].map(([head, val]) => (
              <div key={head} className={`pcell ${val ? 'filled' : ''}`}>
                <span>{head}</span>
                <b>{val}</b>
              </div>
            ))}
          </div>
          <h3>{t.macTableFull}</h3>
          <div className="pgrid mac-grid">
            {task.ports.map((p) => (
              <div key={p.name} className="pcell">
                <span>{p.name}</span>
                <b>{(task.table[p.name] ?? []).join(' ')}</b>
              </div>
            ))}
          </div>
        </div>
        <SwitchDiagram task={task} sendTo={correct?.ports} />
      </div>

      <h3>{t.q1}</h3>
      <p className="practice-hint">{t.q1hint}</p>
      <div className="sw-ports">
        {task.ports.map((p) => {
          const picked = ports.has(p.name)
          return (
            <button
              key={p.name}
              className={`pcheck ${picked ? 'on' : ''} ${correct ? mark(picked, correct.ports.includes(p.name) ? true : picked ? false : undefined) : ''}`}
              onClick={() => onPort(p.name)}
            >
              <span className="box">{picked ? '✓' : ''}</span>
              {p.name}
            </button>
          )
        })}
      </div>
      {result && !result.fields.ports && (
        <p className="practice-right">
          {t.rightAnswer}: <b>{correct!.ports.length ? correct!.ports.join(', ') : '—'}</b>
        </p>
      )}

      <h3>{t.q2}</h3>
      <div className="sw-statements">
        {STATEMENTS.map((s) => {
          const picked = statements.has(s)
          return (
            <button
              key={s}
              className={`pcheck wide ${picked ? 'on' : ''} ${correct ? mark(picked, correct.statements.includes(s) ? true : picked ? false : undefined) : ''}`}
              onClick={() => onStatement(s)}
            >
              <span className="box">{picked ? '✓' : ''}</span>
              {stText[s]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The switch, its 12 ports and what is plugged in. An envelope (the frame)
 * keeps travelling from the sender into the switch; once the answer is
 * checked it goes on to the ports the switch really sends it to (none = the
 * frame is dropped and stays red in the switch).
 */
function SwitchDiagram({ task, sendTo }: { task: SwitchTask; sendTo?: string[] }) {
  const { t } = useI18n()
  const px = (i: number) => 70 + i * 62 + (i >= 8 ? 20 : 0)
  const hubIndex = task.ports.findIndex((p) => p.device === 'hub')
  const hubX = hubIndex >= 0 ? px(hubIndex) : 0
  // Hosts behind the hub sit in a row under it, kept inside the picture.
  const spread = ((task.hubHosts.length - 1) / 2) * 100
  const hubBox = Math.min(Math.max(hubX, 60 + spread), 840 - spread)
  const hostXY = (mac: string) => {
    const i = task.ports.findIndex((p) => p.device === mac)
    if (i >= 0) return { x: px(i), y: 240 }
    return { x: hubBox - spread + task.hubHosts.indexOf(mac) * 100, y: 430 }
  }
  const pc = (mac: string) => {
    const { x, y } = hostXY(mac)
    return (
      <g key={mac} transform={`translate(${x},${y})`}>
        <rect x={-27} y={-24} width={54} height={46} rx={6} className="sd-pc" />
        <rect x={-14} y={22} width={28} height={8} rx={2} className="sd-pc-base" />
        <text y={8} className="sd-mac">
          {mac}
        </text>
      </g>
    )
  }
  // Frame route: sender -> its switch port -> along the switch -> out of each port the switch uses.
  const BUS = 97
  const srcPort = task.ports.findIndex((p) => p.device === task.src)
  const fromHub = srcPort < 0
  const src = hostXY(task.src)
  const up = fromHub ? `M${src.x} 406 V372 H${hubBox} V288 H${hubX} V${BUS}` : `M${src.x} 216 V${BUS}`
  const routes: string[] = []
  for (const name of sendTo ?? []) {
    const i = task.ports.findIndex((p) => p.name === name)
    if (i < 0) continue
    const across = `${up} H${px(i)}`
    if (task.ports[i].device === 'hub') {
      for (const h of task.hubHosts) routes.push(`${across} V288 H${hubBox} V372 H${hostXY(h).x} V406`)
    } else {
      routes.push(`${across} V216`)
    }
  }
  const checked = sendTo !== undefined
  const dropped = checked && routes.length === 0
  const dur = checked ? 3.2 : 1.6
  const envelope = (path: string, key: string) => (
    <g key={key} className={`sd-env moving${dropped ? ' dropped' : ''}`}>
      <rect x={-15} y={-10} width={30} height={20} rx={3} />
      <path d="M-15 -10 L0 2 L15 -10" />
      <animateMotion path={path} dur={`${dur}s`} repeatCount="indefinite" calcMode="linear" keyPoints="0;1;1" keyTimes="0;0.8;1" />
    </g>
  )
  return (
    <svg className="sw-diagram" viewBox={`0 0 900 ${hubIndex >= 0 ? 480 : 300}`} aria-hidden>
      <rect x={30} y={20} width={840} height={110} rx={10} className="sd-switch" />
      <text x={44} y={40} className="sd-title">
        Switch
      </text>
      {task.ports.map((p, i) => (
        <g key={p.name}>
          <text x={px(i)} y={70} className="sd-port-name">
            {p.name}
          </text>
          <rect x={px(i) - 22} y={80} width={44} height={34} rx={4} className={`sd-port ${p.device ? 'used' : ''}`} />
          {p.device && p.device !== 'hub' && <line x1={px(i)} y1={114} x2={px(i)} y2={216} className="sd-cable" />}
        </g>
      ))}
      {hubIndex >= 0 && (
        <>
          <path d={`M${hubX} 114 V288 H${hubBox} V300`} className="sd-cable" />
          {task.hubHosts.map((h) => (
            <path key={h} d={`M${hubBox} 340 V372 H${hostXY(h).x} V406`} className="sd-cable" />
          ))}
          <g transform={`translate(${hubBox},320)`}>
            <rect x={-80} y={-20} width={160} height={40} rx={6} className="sd-hub" />
            <text y={7} className="sd-hub-text">
              {t.hub}
            </text>
          </g>
        </>
      )}
      {task.ports.filter((p) => p.device && p.device !== 'hub').map((p) => pc(p.device!))}
      {task.hubHosts.map(pc)}
      <g transform={`translate(${src.x + 30},${src.y - 46})`} className="sd-env sender">
        <rect x={-20} y={-13} width={40} height={26} rx={3} />
        <path d="M-20 -13 L0 3 L20 -13" />
      </g>
      {routes.length ? routes.map((r, i) => envelope(r, `r${i}-${r}`)) : envelope(up, `up-${checked}`)}
    </svg>
  )
}

// ---------------- address tables ----------------

interface FieldProps {
  name: string
  values: Values
  onValue: (k: string, v: string) => void
  result: PracticeResult | null
  max: number
  numeric?: boolean
}

function Field({ name, values, onValue, result, max, numeric }: FieldProps) {
  const ok = result?.fields[name]
  const right = (result?.correct as Record<string, string> | undefined)?.[name]
  return (
    <div className={`pfield ${ok === undefined ? '' : ok ? 'right' : 'wrong'}`}>
      <input
        value={values[name] ?? ''}
        maxLength={max}
        inputMode={numeric ? 'numeric' : 'decimal'}
        spellCheck={false}
        autoComplete="off"
        readOnly={!!result}
        onChange={(e) => onValue(name, e.target.value)}
      />
      {ok === false && <span className="pfield-right">{right}</span>}
    </div>
  )
}

function SubnetView({ task, values, onValue, result }: { task: SubnetTask; values: Values; onValue: (k: string, v: string) => void; result: PracticeResult | null }) {
  const { t } = useI18n()
  const rows: [string, string][] = [
    ['network', t.rowNetwork],
    ['broadcast', t.rowBroadcast],
    ['first', t.rowFirst],
    ['last', t.rowLast],
  ]
  return (
    <div className="addr">
      <p className="practice-given">
        {t.given}:{' '}
        <b>
          {task.ip}/{task.prefix}
        </b>
      </p>
      <table className="ptable addr-table">
        <thead>
          <tr>
            <th>{t.addrType}</th>
            <th>{t.colBin}</th>
            <th>{t.colDec}</th>
            <th>{t.colFull}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, label]) => (
            <tr key={k}>
              <th>{label}</th>
              <td>
                <Field name={`${k}.bin`} max={9} numeric values={values} onValue={onValue} result={result} />
              </td>
              <td>
                <Field name={`${k}.dec`} max={3} numeric values={values} onValue={onValue} result={result} />
              </td>
              <td>
                <Field name={`${k}.full`} max={15} values={values} onValue={onValue} result={result} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RangeView({ task, values, onValue, result }: { task: RangeTask; values: Values; onValue: (k: string, v: string) => void; result: PracticeResult | null }) {
  const { t } = useI18n()
  const given: [string, (string | number)[]][] = [
    [t.ipAddr, task.ip],
    [t.ipMask, task.mask],
    [t.ipBin, task.ipBin],
    [t.maskBin, task.maskBin],
  ]
  const rows: [string, string][] = [
    ['first', t.rowFirst],
    ['last', t.rowLast],
    ['broadcast', t.rowBroadcast],
    ['next', t.rowNext],
  ]
  return (
    <div className="addr">
      <table className="ptable addr-table range-table">
        <tbody>
          {given.map(([label, cells]) => (
            <tr key={label} className="given-row">
              <th>{label}</th>
              {cells.map((c, i) => (
                <td key={i} className="mono">
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {rows.map(([k, label]) => (
            <tr key={k}>
              <th>{label}</th>
              {[0, 1, 2, 3].map((i) => (
                <td key={i}>
                  <Field name={`${k}.${i}`} max={3} numeric values={values} onValue={onValue} result={result} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
