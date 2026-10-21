/** Audio travels as binary frames; JSON frames carry control and transcript only. */
export const VOICE_MAX_SECONDS = 120;
export const VOICE_MAX_BYTES = 2 * 1024 * 1024;
export const VOICE_MAX_FRAME = 256 * 1024;
export const VOICE_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'] as const;
export type VoicePhase = 'not_installed' | 'idle' | 'installing' | 'loading' | 'ready' | 'error';
export interface VoiceStatus {
  enabled: boolean;
  installed: boolean;
  phase: VoicePhase;
  message: string;
  maxSeconds: number;
}
export type VoiceServerEvent =
  | { type: 'ready' }
  | { type: 'transcript'; text: string; final: boolean }
  | { type: 'error'; error: string };
