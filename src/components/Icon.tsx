/**
 * Small line icons (16 × 16 grid, drawn with the current text colour) for buttons. Icons are
 * decoration: every button keeps a text label or an aria-label.
 */
const paths = {
  upload: 'M8 10.5V2.5M4.5 6 8 2.5 11.5 6M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2',
  download: 'M8 2.5v8M4.5 7 8 10.5 11.5 7M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2',
  close: 'M4 4l8 8M12 4l-8 8',
  shuffle: 'M2 4.5h2.5c2.5 0 3 7 6 7H14M11.5 9 14 11.5 11.5 14M2 11.5h2.5c1 0 1.6-1 2.1-2.2M9 6.7c.5-1.2 1.1-2.2 2-2.2H14M11.5 2 14 4.5 11.5 7',
  swap: 'M2.5 5.5h11M10.5 2.5l3 3-3 3M13.5 10.5h-11M5.5 7.5l-3 3 3 3',
  contrast: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 2v12',
  fitText: 'M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3M5.5 10.5 8 5.5l2.5 5M6.3 9h3.4',
  fitView: 'M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3',
  reset: 'M2.5 3v3.5H6M2.9 6.3A5.5 5.5 0 1 1 3.3 10.5',
  retry: 'M13.5 3v3.5H10M13.1 6.3A5.5 5.5 0 1 0 12.7 10.5',
  alignLeft: 'M2.5 3.5h11M2.5 6.5h7M2.5 9.5h11M2.5 12.5h7',
  alignCenter: 'M2.5 3.5h11M4.5 6.5h7M2.5 9.5h11M4.5 12.5h7',
  alignRight: 'M2.5 3.5h11M6.5 6.5h7M2.5 9.5h11M6.5 12.5h7',
  move: 'M8 1.5v13M1.5 8h13M6 3.5l2-2 2 2M6 12.5l2 2 2-2M3.5 6l-2 2 2 2M12.5 6l2 2-2 2',
  next: 'M3 8h9.5M9 4.5 12.5 8 9 11.5',
} as const

export type IconName = keyof typeof paths

export default function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  )
}
