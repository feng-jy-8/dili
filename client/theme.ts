import { useSyncExternalStore } from 'react';
import { readLocalPreference, writeLocalPreference } from './ui';

export type ThemePreference = 'light' | 'warm' | 'dark' | 'system';
const key = 'sessiondeck.theme';
const valid = (value: string | null): ThemePreference => ['light', 'warm', 'dark', 'system'].includes(value ?? '') ? value as ThemePreference : 'system';
let preference = valid(readLocalPreference(key));
const listeners = new Set<() => void>();
const scheme = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  document.documentElement.dataset.theme = preference === 'system' ? scheme.matches ? 'dark' : 'light' : preference;
  document.documentElement.dataset.themePreference = preference;
}
/** Run before mounting the login gate or workspace to avoid a light-theme flash. */
export function initializeTheme() {
  applyTheme();
  scheme.addEventListener('change', applyTheme);
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = valid(readLocalPreference(key)); applyTheme(); listeners.forEach(listener => listener());
  });
}
function selectTheme(next: ThemePreference) {
  preference = next; writeLocalPreference(key, next); applyTheme(); listeners.forEach(listener => listener());
}
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useTheme(): [ThemePreference, (theme: ThemePreference) => void] {
  return [useSyncExternalStore(subscribe, () => preference), selectTheme];
}
