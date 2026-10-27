/** Uses only state already delivered to the page; never starts background work. */
export function updateAppBadge(count: number) {
  if (count > 0) {
    void navigator.setAppBadge?.(count).catch(() => {});
  } else {
    void navigator.clearAppBadge?.().catch(() => {});
  }
}
