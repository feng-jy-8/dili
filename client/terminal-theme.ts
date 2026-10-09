import type { ITheme, Terminal } from '@xterm/xterm';

const lightPalette = {
  black: '#252b35', red: '#b42332', green: '#23783d', yellow: '#806000',
  blue: '#245bdb', magenta: '#9141ac', cyan: '#087784', white: '#697383',
  brightBlack: '#687181', brightRed: '#cf303f', brightGreen: '#288647', brightYellow: '#8c6800',
  brightBlue: '#3370ff', brightMagenta: '#a34cc1', brightCyan: '#07818f', brightWhite: '#252b35',
};
const darkPalette = {
  black: '#242830', red: '#f28b82', green: '#9fd89f', yellow: '#f2d479',
  blue: '#8ab4f8', magenta: '#c58af9', cyan: '#78d9ec', white: '#e6e7ea',
  brightBlack: '#969eac', brightRed: '#ffa39b', brightGreen: '#b5ecaf', brightYellow: '#ffe79b',
  brightBlue: '#accaff', brightMagenta: '#dbb1ff', brightCyan: '#a1edfa', brightWhite: '#ffffff',
};

export function terminalTheme(surface: HTMLElement): ITheme {
  const style = getComputedStyle(surface);
  // Computed background colors are resolved by the browser, including CSS vars.
  const channels = style.backgroundColor.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [255, 255, 255];
  const dark = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 < 128;
  return {
    ...(dark ? darkPalette : lightPalette),
    background: style.backgroundColor, foreground: style.color,
    cursor: style.color, cursorAccent: style.backgroundColor,
    selectionBackground: dark ? '#465469' : '#ccdcff',
    selectionInactiveBackground: dark ? '#363e4b' : '#e0e6ef',
    scrollbarSliderBackground: dark ? '#969eac66' : '#68718155',
    scrollbarSliderHoverBackground: dark ? '#969eac99' : '#68718188',
    scrollbarSliderActiveBackground: dark ? '#969eacbb' : '#687181aa',
  };
}

export function followTerminalTheme(terminal: Terminal, surface: HTMLElement): () => void {
  let frame = 0;
  let previous = JSON.stringify(terminal.options.theme);
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const theme = terminalTheme(surface);
      const next = JSON.stringify(theme);
      if (next !== previous) { terminal.options.theme = theme; previous = next; }
    });
  };
  const observer = new MutationObserver(update);
  // Watch theme attributes on ancestors without watching xterm's own DOM writes.
  for (let element: HTMLElement | null = surface; element; element = element.parentElement) {
    observer.observe(element, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'color-scheme'] });
  }
  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener('change', update);
  return () => {
    observer.disconnect(); scheme.removeEventListener('change', update); cancelAnimationFrame(frame);
  };
}
