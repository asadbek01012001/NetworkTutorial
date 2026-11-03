import type { DeviceKind } from './model.ts'

// Device pictures, drawn around (0,0) in a 72x56 box.
export function DeviceIcon({ kind }: { kind: DeviceKind }) {
  switch (kind) {
    case 'pc':
      return (
        <g className="ico">
          <rect x={-30} y={-26} width={60} height={40} rx={5} className="ico-body" />
          <rect x={-25} y={-21} width={50} height={30} rx={2} className="ico-screen" />
          <path d="M-8 14 L-11 24 H11 L8 14 Z" className="ico-body" />
          <rect x={-18} y={23} width={36} height={4} rx={2} className="ico-body" />
        </g>
      )
    case 'laptop':
      return (
        <g className="ico">
          <rect x={-24} y={-24} width={48} height={32} rx={4} className="ico-body" />
          <rect x={-20} y={-20} width={40} height={24} rx={2} className="ico-screen" />
          <path d="M-32 10 H32 L28 20 H-28 Z" className="ico-body" />
        </g>
      )
    case 'server':
      return (
        <g className="ico">
          <rect x={-18} y={-28} width={36} height={56} rx={4} className="ico-body" />
          {[-18, -4, 10].map((y) => (
            <g key={y}>
              <rect x={-12} y={y} width={24} height={9} rx={2} className="ico-screen" />
              <circle cx={7} cy={y + 4.5} r={2} className="ico-led" />
            </g>
          ))}
        </g>
      )
    case 'switch':
      return (
        <g className="ico">
          <rect x={-36} y={-14} width={72} height={28} rx={5} className="ico-body" />
          {Array.from({ length: 8 }, (_, i) => (
            <rect key={i} x={-30 + i * 7.6} y={2} width={5} height={5} rx={1} className="ico-port" />
          ))}
          <path d="M-22 -6 H16 M10 -10 L16 -6 L10 -2" className="ico-arrow" />
        </g>
      )
    case 'router':
      return (
        <g className="ico">
          <ellipse cx={0} cy={10} rx={32} ry={12} className="ico-body" />
          <rect x={-32} y={-8} width={64} height={18} className="ico-body ico-flat" />
          <ellipse cx={0} cy={-8} rx={32} ry={12} className="ico-top" />
          <path d="M-14 -8 H-4 M-8 -12 L-4 -8 L-8 -4 M14 -8 H4 M8 -12 L4 -8 L8 -4" className="ico-arrow" />
        </g>
      )
  }
}

/** Small button icons for the palette. */
export function PaletteIcon({ kind }: { kind: DeviceKind }) {
  return (
    <svg viewBox="-40 -34 80 68" className="palette-ico" aria-hidden>
      <DeviceIcon kind={kind} />
    </svg>
  )
}
