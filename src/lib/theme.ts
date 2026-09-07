import type { ITheme } from '@xterm/xterm'
import type { ThemeName } from '@/stores/theme'

/** Terminal palette, tuned to sit inside the app chrome without clashing. */
const dark: ITheme = {
  background: '#0d1017',
  foreground: '#c8d0dd',
  cursor: '#ffb020',
  cursorAccent: '#0d1017',
  selectionBackground: '#2a3550',

  black: '#161b26',
  red: '#f2585b',
  green: '#5ecf8f',
  yellow: '#e6b450',
  blue: '#5b9dff',
  magenta: '#c58bf0',
  cyan: '#4fc5d6',
  white: '#c8d0dd',

  brightBlack: '#5c6773',
  brightRed: '#ff7a7d',
  brightGreen: '#7fe0a8',
  brightYellow: '#ffcc66',
  brightBlue: '#82b6ff',
  brightMagenta: '#d7a8ff',
  brightCyan: '#73dbe8',
  brightWhite: '#e9eef7',
}

/** Warm paper rather than plain white, so the amber identity still reads. */
const light: ITheme = {
  background: '#faf8f3',
  foreground: '#2b2721',
  cursor: '#b06a00',
  cursorAccent: '#faf8f3',
  selectionBackground: '#e2dcc8',

  black: '#2b2721',
  red: '#b3282d',
  green: '#2f7d4f',
  yellow: '#8a6100',
  blue: '#20548f',
  magenta: '#7d3f96',
  cyan: '#1f6f78',
  white: '#5a5449',

  brightBlack: '#8a8375',
  brightRed: '#d13c41',
  brightGreen: '#3d9663',
  brightYellow: '#a3701a',
  brightBlue: '#2f6cae',
  brightMagenta: '#9552ad',
  brightCyan: '#2b8a94',
  brightWhite: '#23201a',
}

export const xtermTheme = (name: ThemeName): ITheme => (name === 'light' ? light : dark)

/** Kept for callers that only ever wanted the default. */
export const theme = dark
