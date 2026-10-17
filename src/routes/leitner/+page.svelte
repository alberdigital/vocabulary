<script lang="ts">
  import { goto } from '$app/navigation';
  import LeitnerBar from '$lib/components/LeitnerBar.svelte';
  import * as repo from '$lib/db/repo';
  import type { LeitnerBox } from '$lib/db/types';
  import { confirmDanger, showError } from '$lib/dialogs.svelte';
  import { exportBox, importBoxFile } from '$lib/files';
  import { countByCompartment, pickSession } from '$lib/leitner/core';
  import { app } from '$lib/state.svelte';

  interface BoxView {
    box: LeitnerBox;
    counts: number[];
    /** Palabras que preguntaría una sesión ahora. */
    due: number;
  }

  let boxes = $state<BoxView[] | null>(null);
  let notice = $state('');

  async function load() {
    const user = app.user;
    if (!user) return;
    const list = await repo.listBoxes(user.id);
    const views: BoxView[] = [];
    for (const box of list) {
      await repo.syncBox(box.id);
      const cards = await repo.boxCards(box.id);
      views.push({ box, counts: countByCompartment(cards), due: pickSession(cards, box.firstCapacity).length });
    }
    boxes = views;
  }

  $effect(() => {
    load().catch(showError);
  });

  function flash(text: string) {
    notice = text;
    setTimeout(() => (notice = ''), 3000);
  }

  function mode(b: LeitnerBox): string {
    const dir = b.direction === 'AB' ? 'A→B' : 'B→A';
    if (b.answerMode === 'self') return `${dir} · autoevaluación`;
    return `${dir} · ${b.inputMode === 'handwriting' ? 'a mano' : 'teclado'}`;
  }

  async function remove(b: LeitnerBox) {
    if (!(await confirmDanger(`¿Borrar la caja «${b.name}» y todo su progreso? Los cuestionarios no se borran.`))) return;
    await repo.deleteBox(b.id);
    await load();
  }

  async function doExport(b: LeitnerBox) {
    try {
      if (await exportBox(b.id)) flash('Caja exportada');
    } catch (e) {
      showError(e);
    }
  }

  async function doImport() {
    if (!app.user) return;
    try {
      const id = await importBoxFile(app.user.id);
      if (id === null) return;
      await load();
      flash('Caja importada (sus cuestionarios están en una carpeta nueva de «Cuestionarios»)');
    } catch (e) {
      showError(e);
    }
  }
</script>

<div class="row toolbar">
  <h1>Cajas de Leitner</h1>
</div>

<div class="row actions">
  <button class="primary" onclick={() => goto('/leitner/new/edit')}>+ Nueva caja</button>
  <button onclick={doImport}>Importar…</button>
  {#if notice}<span class="notice">{notice}</span>{/if}
</div>

{#if boxes && boxes.length === 0}
  <p class="muted empty">
    Todavía no tienes ninguna caja. Una caja de Leitner reúne palabras de tus cuestionarios y te pregunta más a menudo
    las que fallas.
  </p>
{:else if boxes}
  <ul class="boxes">
    {#each boxes as { box, counts, due } (box.id)}
      <li class="card">
        <div class="row head">
          <div>
            <div class="name">{box.name}</div>
            <div class="muted meta">{mode(box)} · {due === 0 ? 'nada que repasar' : `${due} para repasar`}</div>
          </div>
          <div class="row">
            <button class="primary" disabled={due === 0} onclick={() => goto(`/leitner/${box.id}/play`)}>Practicar</button>
            <button onclick={() => goto(`/leitner/${box.id}/edit`)}>Editar</button>
            <button class="link" onclick={() => doExport(box)}>Exportar</button>
            <button class="link danger" onclick={() => remove(box)}>Borrar</button>
          </div>
        </div>
        <LeitnerBar {counts} firstCapacity={box.firstCapacity} />
      </li>
    {/each}
  </ul>
{/if}

<style>
  .toolbar h1 {
    margin: 0;
  }
  .actions {
    margin: 0.75rem 0 1rem;
  }
  .notice {
    color: var(--ok);
  }
  .empty {
    padding: 2rem 0;
    max-width: 40rem;
  }
  .boxes {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .boxes li {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 0.85rem 1rem;
  }
  .head {
    justify-content: space-between;
    gap: 1rem;
  }
  .name {
    font-weight: 600;
    font-size: 1.05rem;
  }
  .meta {
    font-size: 0.88rem;
  }
  .danger {
    color: var(--bad);
  }
</style>
