<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import QuizPicker from '$lib/components/QuizPicker.svelte';
  import * as repo from '$lib/db/repo';
  import type { Folder, LeitnerCard, QuizSummary, SessionOptions } from '$lib/db/types';
  import { confirmDanger, showError } from '$lib/dialogs.svelte';
  import { capacities, SUGGESTED_FIRST_CAPACITY } from '$lib/leitner/core';
  import { langName, type LangPair } from '$lib/quiz/languages';
  import { app } from '$lib/state.svelte';

  const isNew = $derived(page.params.id === 'new');
  const boxId = $derived(isNew ? null : Number(page.params.id));

  let loaded = $state(false);
  let folders = $state<Folder[]>([]);
  let quizzes = $state<QuizSummary[]>([]);
  let name = $state('');
  let firstCapacity = $state(SUGGESTED_FIRST_CAPACITY);
  let opts = $state<SessionOptions>({ direction: 'AB', answerMode: 'typed', inputMode: 'keyboard' });
  let quizIds = $state(new Set<number>());
  let excluded = $state(new Set<number>());
  let pairs = $state(new Map<number, { id: number; a: string; b: string }[]>());
  /** Idiomas de la caja, en el orden al que se refiere el sentido (los fija el selector). */
  let langs = $state<LangPair | null>(null);
  /** Palabras que la caja tiene guardadas (para avisar de lo que se pierde al quitar). */
  let savedCards: LeitnerCard[] = [];
  let saved = $state('');
  let statusMsg = $state('');

  /** Exclusiones que importan: las de cuestionarios incluidos. */
  function effectiveExcluded(): number[] {
    const out: number[] = [];
    for (const id of quizIds) for (const p of pairs.get(id) ?? []) if (excluded.has(p.id)) out.push(p.id);
    return out.sort((x, y) => x - y);
  }
  const snapshot = () =>
    JSON.stringify({
      name,
      firstCapacity,
      opts,
      langs,
      quizIds: [...quizIds].sort((x, y) => x - y),
      excluded: effectiveExcluded(),
    });
  const dirty = $derived(loaded && snapshot() !== saved);

  $effect(() => {
    const id = boxId;
    (async () => {
      folders = await repo.listFolders();
      quizzes = await repo.listAllQuizzes();
      if (id === null) {
        if (app.user) {
          const prefs = await repo.getUserPrefs(app.user.id);
          if (prefs.session) opts = { ...prefs.session };
        }
      } else {
        const box = await repo.getBox(id);
        if (!box || box.userId !== app.user?.id) return goto('/leitner');
        name = box.name;
        firstCapacity = box.firstCapacity;
        opts = { direction: box.direction, answerMode: box.answerMode, inputMode: box.inputMode };
        const sel = await repo.getBoxSelection(id);
        quizIds = new Set(sel.quizIds);
        excluded = new Set(sel.excludedPairIds);
        pairs = await repo.pairsOfQuizzes(sel.quizIds);
        savedCards = await repo.boxCards(id);
        if (quizIds.size > 0) {
          const first = quizzes.find((q) => quizIds.has(q.id));
          langs = box.langA && box.langB ? { a: box.langA, b: box.langB } : first ? { a: first.langA, b: first.langB } : null;
        }
      }
      saved = snapshot();
      loaded = true;
    })().catch(showError);
  });

  const included = $derived(quizzes.filter((q) => quizIds.has(q.id)));
  const wordCount = $derived(
    included.reduce((n, q) => {
      const ps = pairs.get(q.id);
      return n + (ps ? ps.filter((p) => !excluded.has(p.id)).length : q.pairCount);
    }, 0)
  );
  const langNames = $derived(langs ? { a: langName(langs.a), b: langName(langs.b) } : null);
  const capacityOk = $derived(Number.isInteger(firstCapacity) && firstCapacity >= 1 && firstCapacity <= 1000);
  const canSave = $derived(name.trim() !== '' && capacityOk);

  async function confirmRemove(ids: number[]): Promise<boolean> {
    const n = savedCards.filter((c) => ids.includes(c.quizId)).length;
    if (n === 0) return true;
    const what =
      ids.length === 1
        ? `«${quizzes.find((q) => q.id === ids[0])?.name}»`
        : `estos ${ids.length} cuestionarios`;
    return confirmDanger(
      `¿Quitar ${what} de la caja? Se eliminarán sus ${n} palabra${n === 1 ? '' : 's'} de todos los compartimentos (también las pendientes y las aprendidas). Si vuelves a añadirlas, empezarán de cero.`,
      'Quitar'
    );
  }

  async function save(): Promise<boolean> {
    if (!canSave || !app.user) return false;
    const settings = { name: name.trim(), firstCapacity, ...opts, langA: langs?.a ?? null, langB: langs?.b ?? null };
    const sel = { quizIds: [...quizIds], excludedPairIds: effectiveExcluded() };
    try {
      if (boxId === null) {
        const id = await repo.createBox(app.user.id, settings);
        await repo.setBoxSelection(id, sel);
        saved = snapshot();
        goto('/leitner');
      } else {
        await repo.updateBox(boxId, settings);
        await repo.setBoxSelection(boxId, sel);
        savedCards = await repo.boxCards(boxId);
        saved = snapshot();
        statusMsg = 'Guardado';
        setTimeout(() => (statusMsg = ''), 2000);
      }
      return true;
    } catch (e) {
      showError(e);
      return false;
    }
  }

  beforeNavigate((nav) => {
    if (!dirty || nav.willUnload) return;
    nav.cancel();
    const to = nav.to?.url;
    confirmDanger('Hay cambios sin guardar. ¿Salir y descartarlos?', 'Descartar').then((ok) => {
      if (ok && to) {
        saved = snapshot();
        goto(to);
      }
    });
  });

  function onWindowKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  }
</script>

<svelte:window onkeydown={onWindowKey} />

{#if loaded}
  <div class="row top">
    <button class="link" onclick={() => goto('/leitner')}>← Cajas de Leitner</button>
    <div class="row">
      {#if statusMsg}<span class="ok">{statusMsg}</span>{/if}
      {#if dirty && !isNew}<span class="muted">Cambios sin guardar</span>{/if}
      <button class="primary" onclick={save} disabled={!canSave || (!isNew && !dirty)}>
        {isNew ? 'Crear caja' : 'Guardar'} <kbd>Ctrl+S</kbd>
      </button>
    </div>
  </div>

  <div class="layout">
    <div class="card settings">
      <h2>{isNew ? 'Nueva caja' : 'Caja'}</h2>
      <label>
        <span class="muted">Nombre</span>
        <input bind:value={name} placeholder="Nombre de la caja" />
      </label>

      <label>
        <span class="muted">Capacidad del 1.er compartimento</span>
        <input type="number" min="1" max="1000" bind:value={firstCapacity} class="capacity" />
      </label>
      <p class="muted small">
        Sugerencia: {SUGGESTED_FIRST_CAPACITY}. Cada sesión repasa más o menos esa cantidad de palabras; entre 10 y 30
        suele ir bien.
        {#if capacityOk}<br />Capacidades: {capacities(firstCapacity).join(' / ')}.{/if}
      </p>

      <fieldset>
        <legend>Sentido</legend>
        <label class="radio">
          <input type="radio" bind:group={opts.direction} value="AB" />
          {langNames ? `${langNames.a} → ${langNames.b}` : 'Idioma A → idioma B'}
        </label>
        <label class="radio">
          <input type="radio" bind:group={opts.direction} value="BA" />
          {langNames ? `${langNames.b} → ${langNames.a}` : 'Idioma B → idioma A'}
        </label>
      </fieldset>

      <fieldset>
        <legend>Respuesta</legend>
        <label class="radio"><input type="radio" bind:group={opts.answerMode} value="typed" /> Escribirla</label>
        <label class="radio"><input type="radio" bind:group={opts.answerMode} value="self" /> Autoevaluación</label>
      </fieldset>

      {#if opts.answerMode === 'typed'}
        <fieldset>
          <legend>Escribir con</legend>
          <label class="radio"><input type="radio" bind:group={opts.inputMode} value="keyboard" /> Teclado</label>
          <label class="radio"><input type="radio" bind:group={opts.inputMode} value="handwriting" /> A mano</label>
        </fieldset>
      {/if}
    </div>

    <div class="card picker">
      <div class="row picker-head">
        <h2>Contenido</h2>
        <span class="muted">{wordCount} palabra{wordCount === 1 ? '' : 's'} de {included.length} cuestionario{included.length === 1 ? '' : 's'}</span>
      </div>
      <p class="muted small">
        Marca carpetas, cuestionarios o palabras sueltas. Las palabras nuevas que se añadan después a un cuestionario
        marcado entrarán solas en la caja.
        {#if langNames}
          <br />Esta caja es de {langNames.a} y {langNames.b}: solo admite cuestionarios de esos dos idiomas (en
          cualquier orden) y todos se preguntan en el sentido elegido.
        {:else}
          <br />Todos los cuestionarios de la caja deben ser del mismo par de idiomas: lo decide el primero que marques.
        {/if}
      </p>
      {#if quizzes.length === 0}
        <p class="muted">Todavía no hay cuestionarios. Créalos en la pestaña «Cuestionarios».</p>
      {:else}
        <QuizPicker {folders} {quizzes} bind:quizIds bind:excluded bind:pairs bind:langs onbeforeremove={confirmRemove} />
      {/if}
    </div>
  </div>
{/if}

<style>
  .top {
    justify-content: space-between;
    margin-bottom: 1rem;
  }
  .ok {
    color: var(--ok);
  }
  .layout {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 1rem;
    align-items: start;
  }
  .settings {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  h2 {
    margin: 0;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  label.radio {
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
  }
  .capacity {
    width: 7rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.4em 0.6em;
  }
  .small {
    font-size: 0.85rem;
    margin: 0;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.5rem 0.8rem 0.7rem;
    margin: 0;
  }
  legend {
    color: var(--muted);
    padding: 0 0.3rem;
  }
  .picker {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .picker-head {
    justify-content: space-between;
  }
  @media (max-width: 760px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
