// Muted color palette for callout blocks, text highlight, and text color.
// Low-opacity tints keep backgrounds harmonious with the dark theme.

export type ColorKey =
  | 'blue'
  | 'green'
  | 'yellow'
  | 'red'
  | 'purple'
  | 'gray'
  | 'teal'
  | 'orange'

export interface ColorToken {
  key: ColorKey
  label: string
  // Foreground color (used for text color + icon ring)
  text: string
  // Subtle background tint (used for highlight + callout body)
  bg: string
  // Slightly more opaque border / accent (used on callout left border)
  border: string
}

export const COLOR_KEYS: ColorKey[] = [
  'blue',
  'green',
  'yellow',
  'red',
  'purple',
  'gray',
  'teal',
  'orange',
]

export const COLORS: Record<ColorKey, ColorToken> = {
  // Retuned into the design system's muted chroma band. blue/green/red are
  // pinned to the shared semantic tokens (info/success/critical) and yellow
  // to the NEXUS accent, so a callout never introduces a hue the system
  // hasn't already declared. The remaining four sit at matching lightness
  // and chroma so no swatch shouts louder than its neighbours.
  // Keep in sync with the [data-text-color] / [data-background-color] rules
  // in globals.css — BlockNote styles inline marks from those, this file
  // styles the callout block, and they are the same palette to the user.
  blue: {
    key: 'blue',
    label: 'Blue',
    text: '#7ea3c9',
    bg: 'rgba(126, 163, 201, 0.10)',
    border: 'rgba(126, 163, 201, 0.40)',
  },
  green: {
    key: 'green',
    label: 'Green',
    text: '#7fae7a',
    bg: 'rgba(127, 174, 122, 0.10)',
    border: 'rgba(127, 174, 122, 0.40)',
  },
  yellow: {
    key: 'yellow',
    label: 'Amber',
    text: '#c9a26b',
    bg: 'rgba(201, 162, 107, 0.10)',
    border: 'rgba(201, 162, 107, 0.40)',
  },
  red: {
    key: 'red',
    label: 'Red',
    text: '#d9604f',
    bg: 'rgba(217, 96, 79, 0.10)',
    border: 'rgba(217, 96, 79, 0.40)',
  },
  purple: {
    key: 'purple',
    label: 'Violet',
    text: '#9b8ac4',
    bg: 'rgba(155, 138, 196, 0.10)',
    border: 'rgba(155, 138, 196, 0.40)',
  },
  gray: {
    key: 'gray',
    label: 'Gray',
    text: '#8c8e99',
    bg: 'rgba(140, 142, 153, 0.08)',
    border: 'rgba(140, 142, 153, 0.30)',
  },
  teal: {
    key: 'teal',
    label: 'Teal',
    text: '#6faaa4',
    bg: 'rgba(111, 170, 164, 0.10)',
    border: 'rgba(111, 170, 164, 0.40)',
  },
  orange: {
    key: 'orange',
    label: 'Orange',
    text: '#c98d5f',
    bg: 'rgba(201, 141, 95, 0.10)',
    border: 'rgba(201, 141, 95, 0.40)',
  },
}
