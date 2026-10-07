// Estado global de la interfaz.

import type { AnswerRecord, SessionRecord, User } from './db/types';

export const app = $state<{ user: User | null }>({ user: null });

/** Resultado de una sesión de práctica que no se guarda (p. ej. «repetir solo las falladas»). */
export const unsaved = $state<{ result: { session: Omit<SessionRecord, 'id'>; answers: AnswerRecord[] } | null }>({
  result: null,
});

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}
