import type { ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import type { AdminStats } from '../lib/api'

// Dashboard charts. Colours follow the dataviz reference palette (dark steps):
// categorical slots in fixed order, an ordinal blue ramp for stages, status
// green/red only for passed/failed (always with a legend label).
const C = {
  blue: '#3987e5',
  orange: '#d95926',
  aqua: '#199e70',
  good: '#199e70',
  bad: '#e66767',
  // ordinal blue ramp, light = further along (never darker than step 600 on dark)
  ramp: ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4'],
  grid: 'rgb(255 255 255 / 7%)',
  axis: '#8392a8',
  text: '#eef4fb',
}

const shortDay = (iso: string) => {
  const [, m, d] = iso.split('-')
  return `${Number(d)}.${m}`
}

function ChartCard({ title, sub, className = '', children }: { title: string; sub?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`dash-card ${className}`}>
      <header>
        <h3>{title}</h3>
        {sub && <span>{sub}</span>}
      </header>
      {children}
    </section>
  )
}

// One tooltip look for every chart.
function Tip({ active, payload, label, fmtLabel }: Partial<TooltipContentProps<number, string>> & { fmtLabel?: (l: string) => string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="dash-tip">
      {label !== undefined && <b>{fmtLabel ? fmtLabel(String(label)) : label}</b>}
      {payload.map((p) => (
        <span key={String(p.dataKey ?? p.name)}>
          <i style={{ background: (p.color ?? (p.payload as { fill?: string })?.fill) as string }} />
          {p.name}: <b>{p.value}</b>
        </span>
      ))}
    </div>
  )
}

const axisProps = {
  stroke: C.axis,
  tick: { fill: C.axis, fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: C.grid },
} as const

function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className={`kpi-sub ${tone ?? ''}`}>{sub}</span>}
    </div>
  )
}

export function AdminDashboard({ data }: { data: AdminStats }) {
  const c = data.counts
  const passRate = c.tests ? Math.round((100 * c.testsPassed) / c.tests) : 0
  const lessons = data.lessons.map((l) => ({
    name: `${l.index + 1}`,
    title: l.title,
    started: l.started,
    video: l.videoDone,
    passed: l.passed,
    avg: l.attempts ? l.avgScore : 0,
    attempts: l.attempts,
  }))
  const totalStudents = data.progress.reduce((s, b) => s + b.count, 0)
  const lessonLabel = (n: string) => {
    const l = lessons.find((x) => x.name === n)
    return l ? `${n}-dars: ${l.title}` : n
  }

  return (
    <div className="dash">
      <div className="kpis">
        <Kpi label="Talabalar" value={c.students} sub={c.blocked ? `${c.blocked} ta bloklangan` : undefined} />
        <Kpi label="Bugun faol" value={c.activeToday} />
        <Kpi label="7 kunda faol" value={c.active7d} />
        <Kpi label="7 kunda yangi" value={c.new7d} sub={c.newToday ? `bugun +${c.newToday}` : undefined} tone="good" />
        <Kpi label="Kursni tugatgan" value={c.finished} />
        <Kpi label="Test o‘rtacha bali" value={c.tests ? `${c.avgScore}` : '—'} sub={`o‘tish bali ${data.passScore}`} />
        <Kpi label="Testdan o‘tish" value={c.tests ? `${passRate}%` : '—'} sub={`${c.tests} ta urinish`} tone={passRate >= 50 ? 'good' : 'bad'} />
        <Kpi label="Umumiy test" value={c.exams ? `${c.examAvg}%` : '—'} sub={`${c.exams} ta topshirilgan`} />
      </div>

      <div className="dash-grid">
        <ChartCard title="Faollik" sub="oxirgi 30 kun" className="span-8">
          <ResponsiveContainer width="100%" height={330}>
            <AreaChart data={data.daily} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="gActive" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.blue} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={C.blue} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="day" tickFormatter={shortDay} interval="preserveStartEnd" minTickGap={24} {...axisProps} />
              <YAxis allowDecimals={false} {...axisProps} />
              <Tooltip content={<Tip fmtLabel={shortDay} />} cursor={{ stroke: C.axis, strokeDasharray: '3 3' }} />
              <Legend iconType="circle" iconSize={8} itemSorter={null} wrapperStyle={{ fontSize: 13, color: C.axis }} />
              <Area type="monotone" dataKey="active" name="Faol talabalar" stroke={C.blue} strokeWidth={2} fill="url(#gActive)" activeDot={{ r: 4 }} />
              <Area type="monotone" dataKey="signups" name="Yangi ro‘yxatdan o‘tgan" stroke={C.orange} strokeWidth={2} fill="none" activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Talabalar progressi" sub={`${totalStudents} ta talaba`} className="span-4">
          <div className="donut">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={data.progress} dataKey="count" nameKey="label" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none">
                  {data.progress.map((_, i) => (
                    <Cell key={i} fill={C.ramp[i]} />
                  ))}
                </Pie>
                <Tooltip content={<Tip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center">
              <b>{c.finished}</b>
              <span>tugatgan</span>
            </div>
          </div>
          <ul className="dash-legend">
            {data.progress.map((b, i) => (
              <li key={b.label}>
                <i style={{ background: C.ramp[i] }} />
                <span>{b.label}</span>
                <b>{b.count}</b>
              </li>
            ))}
          </ul>
        </ChartCard>

        <ChartCard title="Darslar bo‘yicha o‘tish" sub="har bir darsda nechta talaba qayerga yetgan" className="span-12">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={lessons} margin={{ top: 8, right: 12, left: -18, bottom: 0 }} barGap={2} barCategoryGap="22%">
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="name" tickFormatter={(n) => `${n}-dars`} {...axisProps} />
              <YAxis allowDecimals={false} {...axisProps} />
              <Tooltip content={<Tip fmtLabel={lessonLabel} />} cursor={{ fill: 'rgb(255 255 255 / 4%)' }} />
              <Legend iconType="circle" iconSize={8} itemSorter={null} wrapperStyle={{ fontSize: 13, color: C.axis }} />
              <Bar dataKey="started" name="Boshlagan" fill={C.ramp[1]} radius={[4, 4, 0, 0]} />
              <Bar dataKey="video" name="Videoni tugatgan" fill={C.ramp[2]} radius={[4, 4, 0, 0]} />
              <Bar dataKey="passed" name="Testdan o‘tgan" fill={C.ramp[4]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Dars testlari" sub="kunlik urinishlar, oxirgi 30 kun" className="span-6">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.daily} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="day" tickFormatter={shortDay} interval="preserveStartEnd" minTickGap={24} {...axisProps} />
              <YAxis allowDecimals={false} {...axisProps} />
              <Tooltip content={<Tip fmtLabel={shortDay} />} cursor={{ fill: 'rgb(255 255 255 / 4%)' }} />
              <Legend iconType="circle" iconSize={8} itemSorter={null} wrapperStyle={{ fontSize: 13, color: C.axis }} />
              <Bar dataKey="passed" name="O‘tgan" stackId="t" fill={C.good} />
              <Bar dataKey="failed" name="O‘tmagan" stackId="t" fill={C.bad} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="O‘rtacha test bali" sub={`10 balldan · chiziq — o‘tish bali (${data.passScore})`} className="span-6">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={lessons} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="name" tickFormatter={(n) => `${n}`} {...axisProps} />
              <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} {...axisProps} />
              <Tooltip content={<Tip fmtLabel={lessonLabel} />} cursor={{ fill: 'rgb(255 255 255 / 4%)' }} />
              <ReferenceLine y={data.passScore} stroke={C.axis} strokeDasharray="4 4" />
              <Bar dataKey="avg" name="O‘rtacha ball" radius={[4, 4, 0, 0]}>
                {lessons.map((l) => (
                  <Cell key={l.name} fill={!l.attempts ? C.grid : l.avg >= data.passScore ? C.blue : C.bad} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <ul className="dash-legend inline">
            <li>
              <i style={{ background: C.blue }} />
              <span>O‘tish balidan yuqori</span>
            </li>
            <li>
              <i style={{ background: C.bad }} />
              <span>O‘tish balidan past</span>
            </li>
          </ul>
        </ChartCard>
      </div>
    </div>
  )
}
