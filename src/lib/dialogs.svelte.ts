// Diálogos modales: confirmación nativa y petición de texto propia.

import { ask, message } from '@tauri-apps/plugin-dialog';

export async function confirmDanger(text: string, okLabel = 'Borrar'): Promise<boolean> {
  return ask(text, { title: 'Vocabulario', kind: 'warning', okLabel, cancelLabel: 'Cancelar' });
}

export async function showError(e: unknown): Promise<void> {
  const text = e instanceof Error ? e.message : String(e);
  await message(text, { title: 'Error', kind: 'error' });
}

export interface PromptRequest {
  title: string;
  label?: string;
  value: string;
  okLabel: string;
  /** Opciones para un desplegable en lugar de un campo de texto. */
  options?: { value: string; label: string }[];
  resolve: (value: string | null) => void;
}

export const promptState = $state<{ current: PromptRequest | null }>({ current: null });

/** Pide un texto (o una opción si se pasan options). Devuelve null si se cancela. */
export function prompt(
  title: string,
  opts: { value?: string; okLabel?: string; label?: string; options?: { value: string; label: string }[] } = {}
): Promise<string | null> {
  return new Promise((resolve) => {
    promptState.current = {
      title,
      label: opts.label,
      value: opts.value ?? opts.options?.[0]?.value ?? '',
      okLabel: opts.okLabel ?? 'Aceptar',
      options: opts.options,
      resolve: (v) => {
        promptState.current = null;
        resolve(v);
      },
    };
  });
}
