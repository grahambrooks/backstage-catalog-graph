/**
 * Accent colours per entity kind, in light and dark variants.
 *
 * The same hues as the JetBrains implementation, so a team using both editors sees one
 * colour language. The dark variants are lightened rather than darkened, because a saturated
 * mid-tone that works on white disappears on the dark editor background.
 */
const LIGHT: Record<string, string> = {
  Domain: '#6a3de8',
  System: '#3949ab',
  Component: '#1565c0',
  API: '#00796b',
  Resource: '#e65100',
  Group: '#ad1457',
  User: '#2e7d32',
  Template: '#00838f',
  Location: '#546e7a',
  Entity: '#616161',
};

const DARK: Record<string, string> = {
  Domain: '#b39dff',
  System: '#8c9eff',
  Component: '#64b5f6',
  API: '#4db6ac',
  Resource: '#ffb74d',
  Group: '#f06292',
  User: '#81c784',
  Template: '#4dd0e1',
  Location: '#90a4ae',
  Entity: '#9e9e9e',
};

/**
 * VS Code stamps `vscode-dark` or `vscode-high-contrast` on the body for dark themes, and
 * re-stamps it when the user switches theme, so this is read at paint time rather than cached.
 */
function isDark(): boolean {
  const classes = document.body.classList;
  return (
    classes.contains('vscode-dark') ||
    (classes.contains('vscode-high-contrast') && !classes.contains('vscode-high-contrast-light'))
  );
}

export function accentFor(kind: string): string {
  const palette = isDark() ? DARK : LIGHT;
  return palette[kind] ?? palette.Entity;
}

/** The accent at low opacity, for the tint behind a node. */
export function tintFor(kind: string, alpha: number): string {
  const hex = accentFor(kind);
  const value = parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 0xff;
  const green = (value >> 8) & 0xff;
  const blue = value & 0xff;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
