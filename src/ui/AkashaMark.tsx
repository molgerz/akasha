import { useId, type SVGProps } from 'react'

/**
 * The Akasha mark: the violet tile with the white wave on it, the same shape
 * as the favicon in the tab. Two tapered bands interlock into a diamond; the
 * tile is what makes it recognisable at 16px.
 *
 * One mark, everywhere. The first cut had a bare gradient wave in the app and
 * a smaller wave on a tile in the tab, and the two read as two different
 * logos. The wave now sits at 0.9 of the box (4.8 units of padding) in both,
 * so the app, the tab and public/brand/akasha-mark.svg are the same drawing.
 *
 * The geometry is duplicated from public/brand/akasha-mark.svg on purpose:
 * inlining saves the shell a request and keeps the gradient crisp. Change the
 * shape in both files.
 *
 * The violet is fixed brand colour rather than a theme token (contrast with
 * `icons.tsx`, which inherits `currentColor`): the tile reads on light and on
 * dark, and a mark that recoloured itself with the theme would be a different
 * mark. docs/12-theming.md is about the UI, not about the logo.
 */
type MarkProps = Omit<SVGProps<SVGSVGElement>, 'children'>

export function AkashaMark({ className = 'size-5', ...props }: MarkProps) {
  // Two marks on one page must not share a gradient id. `useId()` is unique
  // per instance, but its punctuation changes between React majors (`:r0:` in
  // 18, `_r_0_` in 19) -- keep only what is safe inside a url() fragment
  // either way.
  const gradient = `akasha-mark-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true" className={`shrink-0 ${className}`} {...props}>
      <defs>
        <linearGradient
          id={gradient}
          x1="0"
          y1="0"
          x2="96"
          y2="96"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#A78BFA" />
          <stop offset=".55" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#5B21B6" />
        </linearGradient>
      </defs>
      <rect width="96" height="96" rx="22" fill={`url(#${gradient})`} />
      <g transform="translate(4.8 4.8) scale(0.9)" fill="#fff">
        <path d="M10.39 22.68L10.33 23.88L10.47 26L11.09 30.79L11.89 34.69L13.05 38.69L15.09 44.32L17.31 49.5L19.89 54.58L22.3 58.51L25.02 62.11L28.44 65.89L32.76 69.93L37.36 73.67L40.08 75.44L42.43 76.51L45.19 77.26L48 77.5L50.81 77.26L53.57 76.51L55.92 75.44L58.64 73.67L63.24 69.93L67.56 65.89L70.98 62.11L73.7 58.51L76.11 54.58L78.28 50.36L80.57 45.17L82.69 39.46L83.9 35.49L84.77 31.55L85.41 27.25L85.67 23.44L85.4 21.37L85.21 20.91L84.68 20.39L84.33 20.32L83.46 20.56L82.08 21.58L80.5 23.48L73.93 32.26L66.66 40.75L61.74 46.09L59.4 48.31L56.01 51.09L51.14 54.67L46.46 57.88L47.22 57.6L48 57.5L48.78 57.6L49.54 57.88L44.86 54.67L39.99 51.09L36.6 48.31L34.26 46.09L29.34 40.75L22.07 32.26L15.5 23.48L13.92 21.58L12.54 20.56L12.08 20.37L11.32 20.39L10.79 20.91L10.6 21.37" />
        <path d="M85.61 73.32L85.67 72.12L85.53 70L84.91 65.21L84.11 61.31L82.95 57.31L80.91 51.68L78.69 46.5L76.11 41.42L73.7 37.49L70.98 33.89L67.56 30.11L63.24 26.07L58.64 22.33L55.92 20.56L53.57 19.49L50.81 18.74L48 18.5L45.19 18.74L42.43 19.49L40.08 20.56L37.36 22.33L32.76 26.07L28.44 30.11L25.02 33.89L22.3 37.49L19.89 41.42L17.72 45.64L15.43 50.83L13.31 56.54L12.1 60.51L11.23 64.45L10.59 68.75L10.33 72.56L10.6 74.63L10.79 75.09L11.32 75.61L11.67 75.68L12.54 75.44L13.92 74.42L15.5 72.52L22.07 63.74L29.34 55.25L34.26 49.91L36.6 47.69L39.99 44.91L44.86 41.33L49.54 38.12L48.78 38.4L48 38.5L47.22 38.4L46.46 38.12L51.14 41.33L56.01 44.91L59.4 47.69L61.74 49.91L66.66 55.25L73.93 63.74L80.5 72.52L82.08 74.42L83.46 75.44L83.92 75.63L84.68 75.61L85.21 75.09L85.4 74.63" />
      </g>
    </svg>
  )
}
