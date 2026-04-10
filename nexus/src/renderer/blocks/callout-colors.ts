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
  blue: {
    key: 'blue',
    label: 'Blue',
    text: '#8ba2fd',
    bg: 'rgba(107, 138, 253, 0.10)',
    border: 'rgba(107, 138, 253, 0.40)',
  },
  green: {
    key: 'green',
    label: 'Green',
    text: '#7dd3a0',
    bg: 'rgba(74, 189, 122, 0.10)',
    border: 'rgba(74, 189, 122, 0.40)',
  },
  yellow: {
    key: 'yellow',
    label: 'Yellow',
    text: '#e8c87a',
    bg: 'rgba(224, 184, 88, 0.11)',
    border: 'rgba(224, 184, 88, 0.40)',
  },
  red: {
    key: 'red',
    label: 'Red',
    text: '#f07e8a',
    bg: 'rgba(232, 90, 109, 0.10)',
    border: 'rgba(232, 90, 109, 0.40)',
  },
  purple: {
    key: 'purple',
    label: 'Purple',
    text: '#b495ff',
    bg: 'rgba(165, 123, 255, 0.11)',
    border: 'rgba(165, 123, 255, 0.42)',
  },
  gray: {
    key: 'gray',
    label: 'Gray',
    text: '#a6a2b8',
    bg: 'rgba(180, 175, 200, 0.08)',
    border: 'rgba(180, 175, 200, 0.30)',
  },
  teal: {
    key: 'teal',
    label: 'Teal',
    text: '#6fd3c8',
    bg: 'rgba(80, 195, 184, 0.10)',
    border: 'rgba(80, 195, 184, 0.40)',
  },
  orange: {
    key: 'orange',
    label: 'Orange',
    text: '#f0a36a',
    bg: 'rgba(232, 140, 72, 0.10)',
    border: 'rgba(232, 140, 72, 0.40)',
  },
}
