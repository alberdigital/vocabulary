<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as repo from '$lib/db/repo';
  import type { AnswerRecord, Pair, Quiz, SessionOptions } from '$lib/db/types';
  import { confirmDanger, showError } from '$lib/dialogs.svelte';
  import PracticeSession from '$lib/components/PracticeSession.svelte';
  import { warmUp } from '$lib/handwriting/recognizer';
  import { QuizEngine } from '$lib/quiz/engine';
  import { langName } from '$lib/quiz/languages';
  import { app, unsaved } from '$lib/state.svelte';

  type SavedPair = Pair & { id: number };

  const quizId = $derived(Number(page.params.id));
  /** Si viene ?only=1,2,3 es una práctica de las falladas: no se guarda en el historial. */
  const onlyIds = $derived(
    page.url.searchParams.get('only')?.split(',').map(Number).filter(Number.isFinite) ?? null
  );

  let quiz = $state<Quiz | null>(null);
  let opts = $state<SessionOptions>({ direction: 'AB', answerMode: 'typed', inputMode: 'keyboard' });
  let engine = $state<QuizEngine<SavedPair> | null>(null);
  let startedAt = $state(0);
  let hwError = $state<string | null>(null);
  let modelState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const handwriting = $derived(opts.answerMode === 'typed' && opts.inputMode === 'handwriting');

  $effect(() => {
    const id = quizId;
    (async () => {
      const q = await repo.getQuiz(id);
      if (!q) return goto('/library');
      quiz = q;
      if (app.user) {
        const prefs = await repo.getUserPrefs(app.user.id);
        if (prefs.session) opts = { ...prefs.session };
      }
    })().catch(showError);
  });

  // Precarga del modelo en cuanto se elige escribir a mano.
  $effect(() => {
    if (handwriting && modelState === 'idle') {
      modelState = 'loading';
      warmUp()
        .then(() => (modelState = 'ready'))
        .catch((e) => {
          modelState = 'error';
          hwError = String(e);
        });
    }
  });

  function pairsToPlay(): SavedPair[] {
    const all = (quiz?.pairs ?? []).filter((p): p is SavedPair => p.id !== null);
    if (!onlyIds) return all;
    const set = new Set(onlyIds);
    return all.filter((p) => set.has(p.id));
  }

  async function start() {
    const pairs = pairsToPlay();
    if (!quiz || pairs.length === 0) return;
    if (app.user) {
      const prefs = await repo.getUserPrefs(app.user.id);
      await repo.setUserPrefs(app.user.id, { ...prefs, session: { ...opts } });
    }
    startedAt = Date.now();
    engine = new QuizEngine(pairs);
  }

  async function finish() {
    if (!engine || !quiz || !app.user) return;
    const finishedAt = new Date();
    const session = {
      userId: app.user.id,
      quizId: quiz.id,
      quizName: quiz.name,
      direction: opts.direction,
      answerMode: opts.answerMode,
      inputMode: opts.answerMode === 'typed' ? opts.inputMode : null,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt,
      pairCount: new Set(engine.answers.map((a) => a.item.id)).size,
      rounds: engine.round,
      firstRoundErrors: engine.firstRoundErrors,
      totalErrors: engine.totalErrors,
    };
    const answers: AnswerRecord[] = engine.answers.map((a) => ({
      pairId: a.item.id,
      round: a.round,
      prompt: opts.direction === 'AB' ? a.item.a : a.item.b,
      expected: opts.direction === 'AB' ? a.item.b : a.item.a,
      given: a.given,
      correct: a.correct,
      overridden: a.overridden,
      elapsedMs: a.elapsedMs,
    }));
    if (onlyIds) {
      unsaved.result = { session, answers };
      goto('/results/practice', { replaceState: true });
    } else {
      try {
        const id = await repo.saveSession(session, answers);
        goto(`/results/${id}`, { replaceState: true });
      } catch (e) {
        showError(e);
      }
    }
  }

  async function abandon() {
    if (!(await confirmDanger('¿Abandonar la sesión? No se guardará el resultado.', 'Abandonar'))) return;
    goto(quiz?.folderId ? `/library?folder=${quiz.folderId}` : '/library');
  }

  function onKey(e: KeyboardEvent) {
    if (!engine && e.key === 'Enter' && quiz) {
      e.preventDefault();
      start();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if quiz && !engine}
  <div class="options-wrap">
    <div class="card options">
      <button class="link back" onclick={() => history.back()}>← Volver</button>
      <h1>{quiz.name}</h1>
      <p class="muted">
        {pairsToPlay().length} palabra{pairsToPlay().length === 1 ? '' : 's'}
        {#if onlyIds}· solo las falladas (no se guarda en el historial){/if}
      </p>

      <fieldset>
        <legend>Sentido</legend>
        <label><input type="radio" bind:group={opts.direction} value="AB" /> {langName(quiz.langA)} → {langName(quiz.langB)}</label>
        <label><input type="radio" bind:group={opts.direction} value="BA" /> {langName(quiz.langB)} → {langName(quiz.langA)}</label>
      </fieldset>

      <fieldset>
        <legend>Respuesta</legend>
        <label><input type="radio" bind:group={opts.answerMode} value="typed" /> Escribirla</label>
        <label><input type="radio" bind:group={opts.answerMode} value="self" /> Autoevaluación (ver la respuesta y decir si acerté)</label>
      </fieldset>

      {#if opts.answerMode === 'typed'}
        <fieldset>
          <legend>Escribir con</legend>
          <label><input type="radio" bind:group={opts.inputMode} value="keyboard" /> Teclado</label>
          <label><input type="radio" bind:group={opts.inputMode} value="handwriting" /> A mano (ratón, táctil o tableta)</label>
          {#if handwriting}
            <p class="muted small">
              {#if modelState === 'loading'}Cargando el reconocimiento de escritura…{:else if modelState === 'ready'}Reconocimiento
                de escritura listo.{:else if modelState === 'error'}<span class="error">{hwError}</span>{/if}
              A mano no se comprueban las tildes ni la ñ.
            </p>
          {/if}
        </fieldset>
      {/if}

      <button class="primary big" onclick={start} disabled={pairsToPlay().length === 0}>Empezar <kbd>Intro</kbd></button>
    </div>
  </div>
{:else if quiz && engine}
  <PracticeSession
    title={quiz.name}
    {opts}
    {engine}
    {startedAt}
    toItem={(p) => ({ a: p.a, b: p.b, langA: quiz!.langA, langB: quiz!.langB })}
    onfinish={finish}
    onabandon={abandon}
  />
{/if}

<style>
  .options-wrap {
    display: grid;
    place-items: start center;
    padding: 2rem 1rem;
  }
  .options {
    width: min(560px, 100%);
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }
  .back {
    align-self: flex-start;
    padding-left: 0;
  }
  .options h1 {
    margin: 0;
  }
  .options p {
    margin: 0;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.6rem 0.9rem 0.8rem;
  }
  legend {
    color: var(--muted);
    padding: 0 0.3rem;
  }
  label {
    cursor: pointer;
  }
  .small {
    font-size: 0.85rem;
  }
  .big {
    font-size: 1.1rem;
    padding: 0.6rem 1.2rem;
  }
</style>
