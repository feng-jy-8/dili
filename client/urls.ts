/** Caddy removes the device prefix before forwarding; the browser keeps it. */
export function appUrl(path: string) {
  const base = document.querySelector<HTMLMetaElement>('meta[name="sessiondeck-base"]')?.content ?? '';
  return `${base}${path}`;
}
