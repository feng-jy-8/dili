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
// iOS Safari keeps innerHeight when the keyboard opens; only the visual
// viewport shrinks and pans. Sizing the shell from it keeps the header and
// composer on screen instead of letting Safari push the whole page up.
export const viewportHeight = () => (window.visualViewport?.height ?? window.innerHeight) / interfaceScale();
const viewportTop = () => Math.max(0, window.visualViewport?.offsetTop ?? 0) / interfaceScale();

function resizeViewport() {
  const root = document.documentElement;
  root.style.setProperty('--ui-viewport-height', `${viewportHeight()}px`);
  root.style.setProperty('--ui-viewport-width', `${viewportWidth()}px`);
  root.style.setProperty('--ui-viewport-top', `${viewportTop()}px`);
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
// WebKit may dispatch resize/focusout before its final keyboard animation
// metrics are committed, without dispatching another resize afterwards.
// Re-read for a bounded settling period instead of freezing that intermediate height.
let viewportFrame = 0;
let viewportSettleUntil = 0;
function settleViewport() {
  viewportSettleUntil = performance.now() + 1200;
  resizeViewport();
  if (viewportFrame) return;
  const tick = () => {
    resizeViewport();
    if (performance.now() < viewportSettleUntil) viewportFrame = requestAnimationFrame(tick);
    else viewportFrame = 0;
  };
  viewportFrame = requestAnimationFrame(tick);
}
export function initializeZoom() {
  // iOS default status-bar style already places the viewport below the status bar.
  // Adding the notch inset again would leave a second empty strip.
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  document.documentElement.toggleAttribute('data-ios-standalone', iosStandalone);
  window.addEventListener('resize', settleViewport);
  window.visualViewport?.addEventListener('resize', settleViewport);
  window.visualViewport?.addEventListener('scroll', settleViewport);
  document.addEventListener('focusin', settleViewport);
  document.addEventListener('focusout', settleViewport);
  window.addEventListener('pageshow', settleViewport);
  window.addEventListener('orientationchange', settleViewport);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) settleViewport(); });
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
