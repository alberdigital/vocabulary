<!--
  Diálogo «Editar últimas palabras» de la práctica: lista de las últimas palabras preguntadas (la
  más antigua primero y más tenue; la actual al final) y, al elegir una, un formulario para
  corregirla en los dos idiomas. Aceptar y Cancelar cierran el diálogo.
-->
<script lang="ts" module>
  export interface WordEntry {
    from: string;
    to: string;
    fromLang: string;
    toLang: string;
  }
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import { parse } from '$lib/quiz/answer';

  let {
    entries,
    onsave,
    onclose,
  }: {
    /** De la más antigua a la actual. */
    entries: WordEntry[];
    onsave: (index: number, from: string, to: string) => Promise<void>;
    onclose: () => void;
  } = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let selected = $state<number | null>(null);
  let from = $state('');
  let to = $state('');
  let saving = $state(false);
  let fromInput: HTMLInputElement | undefined = $state();
  const canSave = $derived(from.trim() !== '' && to.trim() !== '' && !saving);

  $effect(() => {
    if (!dialog) return;
    dialog.showModal();
    // Sin esto el foco cae en la primera palabra y parece elegida.
    dialog.focus();
  });

  /** Opacidad: la actual al 100 % y cada anterior un 10 % menos. */
  const opacity = (i: number) => 1 - (entries.length - 1 - i) * 0.1;

  async function choose(i: number) {
    selected = i;
    from = entries[i].from;
    to = entries[i].to;
    await tick();
    fromInput?.focus();
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (selected === null || !canSave) return;
    saving = true;
    try {
      await onsave(selected, from.trim(), to.trim());
    } finally {
      saving = false;
    }
    onclose();
  }
</script>

<dialog
  bind:this={dialog}
  tabindex="-1"
  oncancel={(e) => {
    e.preventDefault();
    onclose();
  }}
>
  {#if selected === null}
    <h2>Editar últimas palabras</h2>
    <p class="muted small">Elige la palabra que quieres corregir.</p>
    <ul>
      {#each entries as w, i (i)}
        <li style:opacity={opacity(i)}>
          <button class="word" onclick={() => choose(i)}>
            {parse(w.from).full} <span class="muted">—</span> {parse(w.to).full}
          </button>
        </li>
      {/each}
    </ul>
    <div class="row buttons">
      <button onclick={onclose}>Cerrar</button>
    </div>
  {:else}
    <form onsubmit={submit}>
      <h2>Editar palabra</h2>
      <label>
        <span class="muted">{entries[selected].fromLang}</span>
        <input bind:this={fromInput} bind:value={from} autocomplete="off" spellcheck="false" />
      </label>
      <label>
        <span class="muted">{entries[selected].toLang}</span>
        <input bind:value={to} autocomplete="off" spellcheck="false" />
      </label>
      <div class="row buttons">
        <button type="button" onclick={onclose}>Cancelar</button>
        <button type="submit" class="primary" disabled={!canSave}>Aceptar</button>
      </div>
    </form>
  {/if}
</dialog>

<style>
  dialog {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    min-width: 360px;
    max-width: min(520px, calc(100vw - 2rem));
    padding: 1.25rem;
  }
  dialog:focus {
    outline: none;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  h2 {
    margin: 0 0 0.4rem;
  }
  .small {
    font-size: 0.88rem;
    margin: 0 0 0.6rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .word {
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    padding: 0.35rem 0.4rem;
    color: var(--text);
    font-size: 1.05rem;
  }
  .word:hover {
    background: none;
    text-decoration: underline;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .buttons {
    justify-content: flex-end;
    margin-top: 0.6rem;
  }
</style>
