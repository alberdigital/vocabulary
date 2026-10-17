<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import LeitnerBar from '$lib/components/LeitnerBar.svelte';
  import PracticeSession from '$lib/components/PracticeSession.svelte';
  import * as repo from '$lib/db/repo';
  import type { LeitnerBox, LeitnerCard } from '$lib/db/types';
  import { confirmDanger, showError } from '$lib/dialogs.svelte';
  import { countByCompartment, LeitnerEngine, nextCompartment, pickSession } from '$lib/leitner/core';
  import { app, formatDuration } from '$lib/state.svelte';

  const boxId = $derived(Number(page.params.id));

  let box = $state<LeitnerBox | null>(null);
  let counts = $state<number[]>([0, 0, 0, 0, 0, 0, 0]);
  /** Palabras que preguntaría una sesión ahora. */
  let due = $state<LeitnerCard[]>([]);
  let engine = $state<LeitnerEngine<LeitnerCard> | null>(null);
  let startedAt = $state(0);
  let result = $state<{ correct: number; errors: number; durationMs: number } | null>(null);
  let showQuiz = $state(true);
  /** Escrituras en curso, en orden, para no guardar la sesión antes de que terminen. */
  let writes: Promise<unknown> = Promise.resolve();

  async function load(id: number) {
    const b = await repo.getBox(id);
    if (!b || b.userId !== app.user?.id) return goto('/leitner');
    await repo.syncBox(id);
    const cards = await repo.boxCards(id);
    box = b;
    counts = countByCompartment(cards);
    due = pickSession(cards, b.firstCapacity);
  }

  $effect(() => {
    const id = boxId;
    load(id).catch(showError);
    if (app.user) repo.getUserPrefs(app.user.id).then((p) => (showQuiz = p.leitnerShowQuiz ?? true));
  });

  function start() {
    if (!box || due.length === 0) return;
    result = null;
    startedAt = Date.now();
    engine = new LeitnerEngine(due);
  }

  /** Encadena una escritura y refresca los contadores al terminar. */
  function write(fn: () => Promise<unknown>) {
    const id = boxId;
    writes = writes
      .then(fn)
      .then(() => repo.boxCounts(id))
      .then((c) => (counts = c))
      .catch(showError);
  }

  function onanswered(card: LeitnerCard, correct: boolean) {
    write(() => repo.moveCard(boxId, card.pairId, nextCompartment(card.compartment, correct)));
  }

  function onoverride(card: LeitnerCard) {
    write(() => repo.moveCard(boxId, card.pairId, nextCompartment(card.compartment, true)));
  }

  function removeFromBox(card: LeitnerCard, remove: () => void) {
    write(() => repo.excludePair(boxId, card.pairId));
    remove();
  }

  async function saveSession(abandoned: boolean) {
    await writes;
    if (!engine || !box || !app.user) return;
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt;
    const r = { correct: engine.correctCount, errors: engine.totalErrors, durationMs };
    if (engine.answers.length > 0)
      await repo.saveLeitnerSession({
        userId: app.user.id,
        boxId: box.id,
        boxName: box.name,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs,
        correct: r.correct,
        errors: r.errors,
        abandoned,
      });
    return r;
  }

  async function finish() {
    try {
      const r = await saveSession(false);
      engine = null;
      result = r ?? null;
      await load(boxId);
    } catch (e) {
      showError(e);
    }
  }

  async function abandon() {
    if (!(await confirmDanger('¿Abandonar la sesión? Lo respondido hasta ahora se conserva.', 'Abandonar'))) return;
    try {
      await saveSession(true);
    } catch (e) {
      showError(e);
    }
    engine = null;
    goto('/leitner');
  }

  async function toggleQuiz() {
    showQuiz = !showQuiz;
    const user = app.user;
    if (!user) return;
    const prefs = await repo.getUserPrefs(user.id);
    await repo.setUserPrefs(user.id, { ...prefs, leitnerShowQuiz: showQuiz });
  }

  function onKey(e: KeyboardEvent) {
    if (!engine && e.key === 'Enter' && !e.repeat && due.length > 0) {
      e.preventDefault();
      start();
    }
  }

  function mode(b: LeitnerBox): string {
    if (b.answerMode === 'self') return 'autoevaluación';
    return b.inputMode === 'handwriting' ? 'escrita a mano' : 'escrita con teclado';
  }

  /** Evita que los botones se queden con el foco (si no, Espacio/Intro los pulsaría además del atajo). */
  const noFocus = (e: PointerEvent) => e.preventDefault();
</script>

<svelte:window onkeydown={onKey} />

{#if box && engine}
  <PracticeSession
    title={box.name}
    opts={box}
    {engine}
    {startedAt}
    showRound={false}
    toItem={(c) => c}
    {onanswered}
    {onoverride}
    onfinish={finish}
    onabandon={abandon}
  >
    {#snippet top(card)}
      <div class="bar-wrap">
        <LeitnerBar {counts} firstCapacity={box!.firstCapacity} highlight={card?.compartment ?? null} />
      </div>
    {/snippet}
    {#snippet context(card)}
      <div class="context">
        {#if showQuiz}<span class="muted">📘 {card.quizName}</span>{/if}
        <button
          class="eye"
          onpointerdown={noFocus}
          onclick={toggleQuiz}
          title={showQuiz ? 'Ocultar el cuestionario' : 'Mostrar de qué cuestionario es'}
          aria-label={showQuiz ? 'Ocultar el cuestionario' : 'Mostrar de qué cuestionario es'}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
            {#if !showQuiz}<line x1="3" y1="21" x2="21" y2="3" />{/if}
          </svg>
        </button>
      </div>
    {/snippet}
    {#snippet actions({ item, remove })}
      <button class="link remove" onpointerdown={noFocus} onclick={() => removeFromBox(item, remove)}>
        Quitar esta palabra de la caja
      </button>
    {/snippet}
  </PracticeSession>
{:else if box}
  <div class="wrap">
    <div class="card panel">
      <button class="link back" onclick={() => goto('/leitner')}>← Cajas de Leitner</button>
      {#if result}
        <h1>Sesión terminada</h1>
        <p class="muted">{box.name}</p>
        <div class="stats">
          <div class="stat"><div class="value ok">{result.correct}</div><div class="label">Aciertos</div></div>
          <div class="stat"><div class="value" class:bad={result.errors > 0}>{result.errors}</div><div class="label">Fallos</div></div>
          <div class="stat"><div class="value">{formatDuration(result.durationMs)}</div><div class="label">Tiempo</div></div>
        </div>
      {:else}
        <h1>{box.name}</h1>
        <p class="muted">Respuesta {mode(box)} · {box.direction === 'AB' ? 'A→B' : 'B→A'}</p>
      {/if}

      <LeitnerBar {counts} firstCapacity={box.firstCapacity} />

      {#if due.length > 0}
        <p>Toca repasar <strong>{due.length}</strong> palabra{due.length === 1 ? '' : 's'}.</p>
        <button class="primary big" onclick={start}>{result ? 'Seguir practicando' : 'Empezar'} <kbd>Intro</kbd></button>
      {:else}
        <p class="muted">No queda nada que repasar en esta caja.</p>
      {/if}
      {#if result}
        <button onclick={() => goto('/leitner')}>Volver a las cajas</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .wrap {
    display: grid;
    place-items: start center;
    padding: 2rem 1rem;
  }
  .panel {
    width: min(720px, 100%);
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .panel h1,
  .panel p {
    margin: 0;
  }
  .back {
    align-self: flex-start;
    padding-left: 0;
  }
  .big {
    font-size: 1.1rem;
    padding: 0.6rem 1.2rem;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.75rem;
  }
  .stat {
    text-align: center;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.6rem;
  }
  .value {
    font-size: 2rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .value.ok {
    color: var(--ok);
  }
  .value.bad {
    color: var(--bad);
  }
  .label {
    font-size: 0.9rem;
  }
  .bar-wrap {
    padding: 0.6rem 1rem 0;
    width: min(900px, 100%);
    margin: 0 auto;
  }
  .context {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: -0.6rem;
    font-size: 0.88rem;
  }
  .eye {
    border: none;
    background: none;
    padding: 0.2rem;
    color: var(--muted);
    display: grid;
    place-items: center;
  }
  .eye:hover {
    color: var(--text);
    background: none;
  }
  .remove {
    font-size: 0.9rem;
    color: var(--muted);
  }
  .remove:hover {
    color: var(--bad);
  }
</style>
