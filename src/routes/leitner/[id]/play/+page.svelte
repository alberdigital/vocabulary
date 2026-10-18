<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import LeitnerBar from '$lib/components/LeitnerBar.svelte';
  import PracticeSession from '$lib/components/PracticeSession.svelte';
  import * as repo from '$lib/db/repo';
  import type { LeitnerBox, LeitnerCard } from '$lib/db/types';
  import { confirmDanger, showError } from '$lib/dialogs.svelte';
  import { LeitnerEngine } from '$lib/leitner/core';
  import { app, formatDuration } from '$lib/state.svelte';

  const boxId = $derived(Number(page.params.id));

  let box = $state<LeitnerBox | null>(null);
  let counts = $state<number[]>([0, 0, 0, 0, 0, 0, 0]);
  let engine = $state.raw<LeitnerEngine<LeitnerCard> | null>(null);
  /** true mientras se pregunta; false en la pantalla final. */
  let practicing = $state(false);
  let startedAt = $state(0);
  /** Momento de la última respuesta: la práctica dura hasta ahí. */
  let lastAnswerAt = 0;
  let result = $state<{ answered: number; correct: number; errors: number; durationMs: number } | null>(null);
  let exhausted = $state(false);
  let showQuiz = $state(true);
  /** Guarda el registro de la práctica en curso (ver progressSaver). */
  let saveProgress: ((p: repo.PracticeProgress) => Promise<void>) | null = null;
  /** Escrituras en curso, en orden: cada respuesta se guarda al momento. */
  let writes: Promise<unknown> = Promise.resolve();

  /** Carga la caja y empieza a preguntar (o muestra el cartel si no hay nada que preguntar). */
  async function start(id: number) {
    await writes;
    const b = await repo.getBox(id);
    if (!b || b.userId !== app.user?.id) return goto('/leitner');
    await repo.syncBox(id);
    const e = new LeitnerEngine(await repo.boxCards(id), b.firstCapacity);
    box = b;
    engine = e;
    counts = e.counts();
    result = null;
    saveProgress = null;
    exhausted = e.finished;
    practicing = !e.finished;
    startedAt = lastAnswerAt = Date.now();
  }

  $effect(() => {
    const id = boxId;
    start(id).catch(showError);
    if (app.user) repo.getUserPrefs(app.user.id).then((p) => (showQuiz = p.leitnerShowQuiz ?? true));
  });

  /** Registro de la práctica en el historial: se crea con la primera respuesta y se actualiza con cada una. */
  function progressSaver(b: LeitnerBox, userId: number, start: number) {
    let id: number | null = null;
    return async (p: repo.PracticeProgress) => {
      if (id === null)
        id = await repo.startLeitnerPractice({
          userId,
          boxId: b.id,
          boxName: b.name,
          startedAt: new Date(start).toISOString(),
          ...p,
        });
      else await repo.updateLeitnerPractice(id, p);
    };
  }

  /** Guarda lo que ha cambiado en el motor (y, si hace falta, antes otra escritura) y el registro de la práctica. */
  function persist(before?: () => Promise<void>) {
    const e = engine;
    if (!e || !box || !app.user) return;
    if (!saveProgress) saveProgress = progressSaver(box, app.user.id, startedAt);
    const save = saveProgress;
    const id = boxId;
    const changes = e.takeChanges();
    const progress: repo.PracticeProgress = {
      finishedAt: new Date(lastAnswerAt).toISOString(),
      durationMs: lastAnswerAt - startedAt,
      correct: e.correctCount,
      errors: e.totalErrors,
    };
    const answered = e.answers.length > 0;
    counts = e.counts();
    writes = writes
      .then(async () => {
        await before?.();
        await repo.saveCards(id, changes);
        if (answered) await save(progress);
      })
      .catch(showError);
  }

  function onanswered() {
    lastAnswerAt = Date.now();
    persist();
  }

  function onoverride() {
    persist();
  }

  function removeFromBox(card: LeitnerCard, remove: () => void) {
    engine?.removeCard(card.pairId);
    persist(() => repo.excludePair(boxId, card.pairId));
    remove();
  }

  async function editBox() {
    if (!(await confirmDanger('¿Ir a editar la caja? Se terminará la práctica (lo respondido ya está guardado).', 'Editar')))
      return;
    await writes;
    goto(`/leitner/${boxId}/edit`);
  }

  /** Corrige una palabra durante la práctica, en su cuestionario y en la práctica en curso. */
  async function editWord(card: LeitnerCard, a: string, b: string) {
    await writes;
    // a y b van en el orden de la caja; el cuestionario puede tenerlos al revés.
    await repo.updatePair(card.pairId, card.flipped ? b : a, card.flipped ? a : b);
    card.a = a;
    card.b = b;
  }

  /** Pantalla final: al pulsar «Terminar» o cuando no queda nada que preguntar. */
  function end() {
    const e = engine;
    if (!e) return;
    practicing = false;
    exhausted = e.finished;
    saveProgress = null;
    result =
      e.answers.length > 0
        ? { answered: e.answers.length, correct: e.correctCount, errors: e.totalErrors, durationMs: lastAnswerAt - startedAt }
        : null;
  }

  function again() {
    start(boxId).catch(showError);
  }

  async function toggleQuiz() {
    showQuiz = !showQuiz;
    const user = app.user;
    if (!user) return;
    const prefs = await repo.getUserPrefs(user.id);
    await repo.setUserPrefs(user.id, { ...prefs, leitnerShowQuiz: showQuiz });
  }

  function onKey(e: KeyboardEvent) {
    if (!practicing && box && !exhausted && e.key === 'Enter' && !e.repeat) {
      e.preventDefault();
      again();
    }
  }

  /** Evita que los botones se queden con el foco (si no, Espacio/Intro los pulsaría además del atajo). */
  const noFocus = (e: PointerEvent) => e.preventDefault();
</script>

<svelte:window onkeydown={onKey} />

{#if box && engine && practicing}
  <PracticeSession
    title={box.name}
    opts={box}
    {engine}
    {startedAt}
    stopLabel="Terminar"
    toItem={(c) => c}
    {onanswered}
    {onoverride}
    onfinish={end}
    onstop={end}
    onedit={editBox}
    oneditword={editWord}
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
{:else if box && engine}
  <div class="wrap">
    <div class="card panel">
      <button class="link back" onclick={() => goto('/leitner')}>← Cajas de Leitner</button>
      <h1>{result ? 'Práctica terminada' : box.name}</h1>
      {#if result}
        <p class="muted">{box.name}</p>
        <div class="stats">
          <div class="stat"><div class="value">{result.answered}</div><div class="label">Respondidas</div></div>
          <div class="stat"><div class="value ok">{result.correct}</div><div class="label">Aciertos</div></div>
          <div class="stat"><div class="value" class:bad={result.errors > 0}>{result.errors}</div><div class="label">Fallos</div></div>
          <div class="stat"><div class="value">{formatDuration(result.durationMs)}</div><div class="label">Tiempo</div></div>
        </div>
      {/if}

      <LeitnerBar {counts} firstCapacity={box.firstCapacity} />

      {#if exhausted}
        <p class="notice">
          No queda nada que preguntar: el 1.<sup>er</sup> compartimento está vacío y ningún otro está lleno.
          <strong>Añade más palabras para continuar.</strong>
        </p>
        <div class="row">
          <button class="primary" onclick={() => goto(`/leitner/${box!.id}/edit`)}>Añadir palabras a la caja</button>
          <button onclick={() => goto('/leitner')}>Volver a las cajas</button>
        </div>
      {:else}
        <div class="row">
          <button class="primary big" onclick={again}>Seguir practicando <kbd>Intro</kbd></button>
          <button onclick={() => goto('/leitner')}>Volver a las cajas</button>
        </div>
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
    grid-template-columns: repeat(4, 1fr);
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
  .notice {
    padding: 0.75rem 1rem;
    border-radius: var(--radius);
    background: var(--surface-2);
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
