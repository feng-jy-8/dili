import { useSyncExternalStore } from 'react';
import { readLocalPreference, writeLocalPreference } from './ui';

const key = 'dili.interface-zoom';
const normalize = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 100 && number <= 200 ? Math.round(number) : 100;
};
let preference = normalize(readLocalPreference(key));
const listeners = new Set<() => void>();
export const interfaceScale = () => preference / 100;
export const viewportWidth = () => window.innerWidth / interfaceScale();
export const viewportHeight = () => window.innerHeight / interfaceScale();

function resizeViewport() {
  const root = document.documentElement;
  root.style.setProperty('--ui-viewport-height', `${viewportHeight()}px`);
  root.style.setProperty('--ui-viewport-width', `${viewportWidth()}px`);
}
function applyZoom() {
  document.documentElement.style.setProperty('--ui-scale', String(interfaceScale()));
  document.documentElement.style.zoom = String(interfaceScale());
  document.documentElement.dataset.interfaceZoom = String(preference);
  resizeViewport();
  // Existing explorers and terminal docks observe the same resize path.
  window.dispatchEvent(new Event('resize'));
  listeners.forEach(listener => listener());
}
export function initializeZoom() {
  window.addEventListener('resize', resizeViewport);
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = normalize(readLocalPreference(key)); applyZoom();
  });
  applyZoom();
}
function selectZoom(value: number) {
  preference = normalize(value); writeLocalPreference(key, String(preference)); applyZoom();
}
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useInterfaceZoom(): [number, (value: number) => void] {
  return [useSyncExternalStore(subscribe, () => preference), selectZoom];
}
