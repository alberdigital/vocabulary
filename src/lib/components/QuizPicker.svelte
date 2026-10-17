<!--
  Árbol para elegir el contenido de una caja de Leitner: carpetas, cuestionarios y palabras, cada
  uno con su checkbox. Un cuestionario incluido aporta todas sus palabras salvo las excluidas.
-->
<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import * as repo from '$lib/db/repo';
  import type { Folder, QuizSummary } from '$lib/db/types';
  import { parse } from '$lib/quiz/answer';

  type PairInfo = { id: number; a: string; b: string };

  let {
    folders,
    quizzes,
    quizIds = $bindable(),
    excluded = $bindable(),
    pairs = $bindable(),
    onbeforeremove,
  }: {
    folders: Folder[];
    quizzes: QuizSummary[];
    /** Cuestionarios incluidos. */
    quizIds: Set<number>;
    /** Palabras quitadas de cuestionarios incluidos. */
    excluded: Set<number>;
    /** Palabras ya cargadas de cada cuestionario (se cargan al desplegarlo). */
    pairs: Map<number, PairInfo[]>;
    /** Se llama antes de quitar cuestionarios enteros; si devuelve false no se quitan. */
    onbeforeremove?: (quizIds: number[]) => Promise<boolean>;
  } = $props();

  const childrenOf = (id: number | null) => folders.filter((f) => f.parentId === id);
  const quizzesIn = (id: number | null) => quizzes.filter((q) => q.folderId === id);

  /** Cuestionarios de una carpeta y de todas sus subcarpetas. */
  function quizzesInTree(id: number): QuizSummary[] {
    const ids = repo.descendantIds(folders, id);
    return quizzes.filter((q) => q.folderId !== null && ids.has(q.folderId));
  }

  // Desplegadas al principio: las carpetas con algo marcado (y sus antecesoras).
  let open = $state(new Set<string>());
  let initialized = false;
  $effect(() => {
    if (initialized || folders.length + quizzes.length === 0) return;
    initialized = true;
    const next = new Set<string>();
    for (const q of quizzes) {
      if (!quizIds.has(q.id)) continue;
      if (q.folderId === null) next.add('root');
      let f = folders.find((x) => x.id === q.folderId);
      while (f) {
        next.add(`f${f.id}`);
        f = folders.find((x) => x.id === f!.parentId);
      }
    }
    open = next;
  });

  function toggleOpen(key: string) {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    open = next;
  }

  async function loadPairs(quizId: number) {
    if (pairs.has(quizId)) return;
    const loaded = await repo.pairsOfQuizzes([quizId]);
    pairs = new Map([...pairs, ...loaded]);
  }

  async function toggleQuizOpen(quizId: number) {
    await loadPairs(quizId);
    toggleOpen(`q${quizId}`);
  }

  // ---------- Recuentos y estados ----------

  function selectedIn(q: QuizSummary): number {
    if (!quizIds.has(q.id)) return 0;
    const ps = pairs.get(q.id);
    return ps ? ps.filter((p) => !excluded.has(p.id)).length : q.pairCount;
  }

  type Check = 'all' | 'some' | 'none';

  function quizState(q: QuizSummary): Check {
    const n = selectedIn(q);
    if (n === 0) return quizIds.has(q.id) && q.pairCount === 0 ? 'all' : 'none';
    return n === q.pairCount ? 'all' : 'some';
  }

  function groupState(list: QuizSummary[]): Check {
    if (list.length === 0) return 'none';
    const states = list.map(quizState);
    if (states.every((s) => s === 'all')) return 'all';
    return states.every((s) => s === 'none') ? 'none' : 'some';
  }

  const total = (list: QuizSummary[]) => list.reduce((n, q) => n + q.pairCount, 0);
  const selected = (list: QuizSummary[]) => list.reduce((n, q) => n + selectedIn(q), 0);

  // ---------- Cambios ----------

  function clearExclusionsOf(ids: number[]) {
    const drop = new Set(ids.flatMap((id) => (pairs.get(id) ?? []).map((p) => p.id)));
    excluded = new Set([...excluded].filter((p) => !drop.has(p)));
  }

  /** Marca (todas sus palabras) o desmarca un grupo de cuestionarios. */
  async function setQuizzes(list: QuizSummary[], on: boolean) {
    const ids = list.map((q) => q.id);
    if (on) {
      // Hace falta conocer sus palabras para limpiar exclusiones antiguas.
      const missing = ids.filter((id) => !pairs.has(id) && quizIds.has(id));
      if (missing.length) pairs = new Map([...pairs, ...(await repo.pairsOfQuizzes(missing))]);
      clearExclusionsOf(ids);
      quizIds = new Set([...quizIds, ...ids]);
    } else {
      const removing = ids.filter((id) => quizIds.has(id));
      if (removing.length === 0) return;
      if (onbeforeremove && !(await onbeforeremove(removing))) return;
      clearExclusionsOf(removing);
      quizIds = new Set([...quizIds].filter((id) => !removing.includes(id)));
    }
  }

  async function togglePair(q: QuizSummary, pairId: number) {
    const ps = pairs.get(q.id) ?? [];
    if (!quizIds.has(q.id)) {
      // Marcar una palabra de un cuestionario no incluido: se incluye solo esa.
      quizIds = new Set([...quizIds, q.id]);
      excluded = new Set([...excluded, ...ps.filter((p) => p.id !== pairId).map((p) => p.id)]);
      return;
    }
    const next = new Set(excluded);
    if (next.has(pairId)) next.delete(pairId);
    else next.add(pairId);
    if (ps.every((p) => next.has(p.id))) {
      // Sin ninguna palabra marcada, el cuestionario deja de estar incluido.
      await setQuizzes([q], false);
      return;
    }
    excluded = next;
  }

  /** Pone checked/indeterminate según el estado (y lo recuerda para resync). */
  function tri(node: HTMLInputElement, state: Check) {
    const apply = (s: Check) => {
      node.dataset.state = s;
      node.checked = s === 'all';
      node.indeterminate = s === 'some';
    };
    apply(state);
    return { update: apply };
  }

  /**
   * El clic cambia el checkbox por su cuenta; tras aplicar el cambio se vuelve a dibujar según el
   * estado real (por si se canceló la confirmación o el resultado no es el que marcó el clic).
   */
  async function change(e: Event, fn: () => Promise<void>) {
    const el = e.currentTarget as HTMLInputElement;
    await fn();
    await tick();
    el.checked = el.dataset.state === 'all';
    el.indeterminate = el.dataset.state === 'some';
  }
</script>

{#snippet quizRow(q: QuizSummary, depth: number)}
  {@const state = quizState(q)}
  <li>
    <div class="item" style:padding-left="{0.4 + depth * 1.2}rem">
      <button class="twisty" onclick={() => toggleQuizOpen(q.id)} aria-label={open.has(`q${q.id}`) ? 'Plegar' : 'Desplegar'}>
        {open.has(`q${q.id}`) ? '▾' : '▸'}
      </button>
      <label>
        <input type="checkbox" use:tri={state} onchange={(e) => change(e, () => setQuizzes([q], state !== 'all'))} />
        <span class="name">📄 {q.name}</span>
      </label>
      <span class="count" class:on={state !== 'none'}>{selectedIn(q)}/{q.pairCount}</span>
    </div>
    {#if open.has(`q${q.id}`)}
      <ul>
        {#each pairs.get(q.id) ?? [] as p (p.id)}
          <li>
            <label class="item word" style:padding-left="{0.4 + (depth + 1) * 1.2 + 1.4}rem">
              <input
                type="checkbox"
                use:tri={quizIds.has(q.id) && !excluded.has(p.id) ? 'all' : 'none'}
                onchange={(e) => change(e, () => togglePair(q, p.id))}
              />
              <span>{parse(p.a).full} <span class="muted">—</span> {parse(p.b).full}</span>
            </label>
          </li>
        {:else}
          <li class="muted empty" style:padding-left="{0.4 + (depth + 1) * 1.2 + 1.4}rem">Sin palabras</li>
        {/each}
      </ul>
    {/if}
  </li>
{/snippet}

{#snippet group(key: string, label: string, list: QuizSummary[], depth: number, inner: Snippet)}
  {@const state = groupState(list)}
  <li>
    <div class="item" style:padding-left="{0.4 + depth * 1.2}rem">
      <button class="twisty" onclick={() => toggleOpen(key)} aria-label={open.has(key) ? 'Plegar' : 'Desplegar'}>
        {open.has(key) ? '▾' : '▸'}
      </button>
      <label>
        <input
          type="checkbox"
          use:tri={state}
          disabled={list.length === 0}
          onchange={(e) => change(e, () => setQuizzes(list, state !== 'all'))}
        />
        <span class="name folder">{label}</span>
      </label>
      <span class="count" class:on={state !== 'none'}>{selected(list)}/{total(list)}</span>
    </div>
    {#if open.has(key)}
      <ul>{@render inner()}</ul>
    {/if}
  </li>
{/snippet}

{#snippet branch(parent: number | null, depth: number)}
  {#each childrenOf(parent) as f (f.id)}
    {#snippet inner()}
      {@render branch(f.id, depth + 1)}
      {#each quizzesIn(f.id) as q (q.id)}{@render quizRow(q, depth + 1)}{/each}
    {/snippet}
    {@render group(`f${f.id}`, `📁 ${f.name}`, quizzesInTree(f.id), depth, inner)}
  {/each}
{/snippet}

<ul class="tree">
  {@render branch(null, 0)}
  {#if quizzesIn(null).length > 0}
    {#snippet rootInner()}
      {#each quizzesIn(null) as q (q.id)}{@render quizRow(q, 1)}{/each}
    {/snippet}
    {@render group('root', '🗂️ Sin carpeta', quizzesIn(null), 0, rootInner)}
  {/if}
</ul>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    border-radius: 6px;
    padding-right: 0.5rem;
  }
  .item:hover {
    background: var(--surface-2);
  }
  label {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.3rem 0;
    cursor: pointer;
    min-width: 0;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder {
    font-weight: 600;
  }
  .word {
    font-size: 0.92rem;
  }
  .twisty {
    width: 1.4rem;
    flex: none;
    border: none;
    background: none;
    padding: 0;
    color: var(--muted);
  }
  .twisty:hover {
    background: none;
    color: var(--text);
  }
  .count {
    font-size: 0.82rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .count.on {
    color: var(--accent);
  }
  .empty {
    font-size: 0.88rem;
    padding: 0.2rem 0;
  }
</style>
