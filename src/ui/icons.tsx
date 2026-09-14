import type { SVGProps } from 'react'

/**
 * The icon set. Hand-drawn on a 24-unit grid in one stroke weight, so that a
 * row of them lines up optically instead of one glyph sitting heavier than its
 * neighbour — which is what happens as soon as icons come from two sources.
 *
 * Every icon inherits `currentColor` and takes its size from the class it is
 * given, so on a selected sidebar row it follows the row's colour rather than
 * fixing one of its own.
 *
 * `aria-hidden` by default: an icon here always sits next to a label or inside
 * a control that carries its own `aria-label`, so announcing it a second time
 * would only repeat the row.
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>

function Icon({ className = 'size-4', ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      {...props}
    />
  )
}

/** Folds the left bar away and back. */
export function PanelLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9.5 4v16" />
    </Icon>
  )
}

export function HomeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M5.75 9.5V19a1 1 0 0 0 1 1h10.5a1 1 0 0 0 1-1V9.5" />
    </Icon>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
    </Icon>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  )
}

/** A page, as in the tree and in every list of pages. */
export function PageIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3.5h7L18 8.5V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5Z" />
      <path d="M12.75 3.75V9h5" />
    </Icon>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9.5 6 6 6-6 6" />
    </Icon>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9.5 6 6 6-6" />
    </Icon>
  )
}

/** History: a clock whose hand has been wound back. */
export function HistoryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4.5V9H8" />
      <path d="M12 8v4.4l3 1.8" />
    </Icon>
  )
}

/** Line origin: lines of text, each starting at a different owner. */
export function BlameIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6.5h5M4 12h5M4 17.5h5" />
      <path d="M13 6.5h7M13 12h4M13 17.5h6" />
    </Icon>
  )
}

export function CommentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 5.5h16v10H9.5L4.5 19.5V5.5Z" />
    </Icon>
  )
}

/** "On this page" — a stack of headings, indented. */
export function ListTreeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h16M8 12h12M8 18h12" />
    </Icon>
  )
}

/**
 * Moving a page: arrows up and down over a vertical rule. Not a drag handle —
 * the gesture behind it is a menu of steps, not a grab. src/ui/PageMoveMenu.tsx
 */
export function MoveIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4.5v15" />
      <path d="M8.5 8 12 4.5 15.5 8" />
      <path d="M8.5 16 12 19.5 15.5 16" />
    </Icon>
  )
}

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="2.75" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.6 7.75l1.9 1.1M17.5 15.15l1.9 1.1M4.6 16.25l1.9-1.1M17.5 8.85l1.9-1.1" />
    </Icon>
  )
}

export function UsersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9.5" cy="8.5" r="3.25" />
      <path d="M4 19.5c0-2.9 2.5-5 5.5-5s5.5 2.1 5.5 5" />
      <path d="M16 5.6a3.25 3.25 0 0 1 0 5.8M17.5 14.9c1.6.7 2.5 2.4 2.5 4.6" />
    </Icon>
  )
}

/** One's own profile — a single person, centred, against UsersIcon's several. */
export function UserIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c0-3.6 3.1-6.25 7-6.25s7 2.65 7 6.25" />
    </Icon>
  )
}

/** Editing, on the Read/Edit switch. */
export function PencilIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 19.5l.7-3.6L15.9 5.2a2 2 0 0 1 2.9 2.9L8.1 18.8l-3.6.7Z" />
      <path d="m14.4 6.7 2.9 2.9" />
    </Icon>
  )
}

/** Reading, on the Read/Edit switch. */
export function BookIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 5.5c2.7-1 5.3-1 8 0v13c-2.7-1-5.3-1-8 0v-13Z" />
      <path d="M12 5.5c2.7-1 5.3-1 8 0v13c-2.7-1-5.3-1-8 0" />
    </Icon>
  )
}

/** A subpage: a page hanging off the one above it. */
export function SubpageIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 4v9.5a2 2 0 0 0 2 2h4" />
      <rect x="13" y="12" width="7" height="7" rx="1.5" />
      <path d="M16.5 14v3M15 15.5h3" />
    </Icon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
    </Icon>
  )
}

/** The colour mode, one icon per state. docs/12-theming.md */
export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.75v2M12 19.25v2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M2.75 12h2M19.25 12h2M4.5 19.5l1.4-1.4M18.1 5.9l1.4-1.4" />
    </Icon>
  )
}

export function MoonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 14.4A8.5 8.5 0 0 1 9.6 4a8.5 8.5 0 1 0 10.4 10.4Z" />
    </Icon>
  )
}

export function MonitorIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M9 20.5h6M12 16.5v4" />
    </Icon>
  )
}

/** A space, on the space list. */
export function SpaceIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.75" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.75" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.75" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.75" />
    </Icon>
  )
}
