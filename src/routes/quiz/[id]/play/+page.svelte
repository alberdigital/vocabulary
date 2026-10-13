<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy, tick } from 'svelte';
  import * as repo from '$lib/db/repo';
  import type { AnswerRecord, Pair, Quiz, SessionOptions } from '$lib/db/types';
  import { confirmDanger, showError } from '$lib/dialogs.svelte';
  import HandwritingCanvas from '$lib/handwriting/HandwritingCanvas.svelte';
  import { check as hwCheck, warmUp } from '$lib/handwriting/recognizer';
  import { checkTyped, parse } from '$lib/quiz/answer';
  import { QuizEngine } from '$lib/quiz/engine';
  import { langName } from '$lib/quiz/languages';
  import { app, formatDuration, unsaved } from '$lib/state.svelte';

  type SavedPair = Pair & { id: number };
  type Phase = 'ask' | 'checking' | 'feedback' | 'revealed';

  const quizId = $derived(Number(page.params.id));
  /** Si viene ?only=1,2,3 es una práctica de las falladas: no se guarda en el historial. */
  const onlyIds = $derived(
    page.url.searchParams.get('only')?.split(',').map(Number).filter(Number.isFinite) ?? null
  );

  let quiz = $state<Quiz | null>(null);
  let opts = $state<SessionOptions>({ direction: 'AB', answerMode: 'typed', inputMode: 'keyboard' });
  let running = $state(false);

  // ---- Estado de la sesión ----
  let engine: QuizEngine<SavedPair> | null = null;
  let version = $state(0); // se incrementa para refrescar lo que depende del motor
  let phase = $state<Phase>('ask');
  let typed = $state('');
  let lastCorrect = $state(false);
  let lastGiven = $state<string | null>(null);
  let lastScores = $state<{ expected: number; recognized: number } | undefined>();
  let hwError = $state<string | null>(null);
  let modelState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let showDebug = $state(false);
  let canvasEmpty = $state(true);
  let startedAt = $state(0);
  let questionShownAt = 0;
  let now = $state(Date.now());
  let timer: ReturnType<typeof setInterval> | undefined;
  let advanceTimer: ReturnType<typeof setTimeout> | undefined;
  let answerInput: HTMLInputElement | undefined = $state();
  let hwCanvas: HandwritingCanvas | undefined = $state();

  /** Palabra en pantalla. No sigue al motor directamente: durante la corrección debe seguir mostrándose la contestada. */
  let current = $state<SavedPair | null>(null);
  /** Ronda y posición de la palabra en pantalla (se fijan al mostrarla). */
  let position = $state({ round: 1, index: 1, size: 1 });
  const errors = $derived.by(() => {
    version;
    return engine?.totalErrors ?? 0;
  });
  const promptText = $derived(current ? (opts.direction === 'AB' ? current.a : current.b) : '');
  const expectedText = $derived(current ? (opts.direction === 'AB' ? current.b : current.a) : '');
  const fromLang = $derived(quiz ? langName(opts.direction === 'AB' ? quiz.langA : quiz.langB) : '');
  const toLang = $derived(quiz ? langName(opts.direction === 'AB' ? quiz.langB : quiz.langA) : '');
  const handwriting = $derived(opts.answerMode === 'typed' && opts.inputMode === 'handwriting');
  const hwButtonLabel = $derived(
    phase === 'checking' ? (modelState === 'ready' ? 'Leyendo…' : 'Cargando…') : canvasEmpty ? 'No lo sé' : 'Comprobar'
  );

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

  onDestroy(() => {
    clearInterval(timer);
    clearTimeout(advanceTimer);
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
    engine = new QuizEngine(pairs);
    startedAt = Date.now();
    now = startedAt;
    timer = setInterval(() => (now = Date.now()), 250);
    running = true;
    version++;
    await nextQuestion();
  }

  async function nextQuestion() {
    clearTimeout(advanceTimer);
    if (!engine) return;
    if (engine.finished) return finish();
    current = engine.current ?? null;
    position = { round: engine.round, index: engine.roundDone + 1, size: engine.roundSize };
    phase = 'ask';
    typed = '';
    lastGiven = null;
    lastScores = undefined;
    hwError = modelState === 'error' ? hwError : null;
    version++;
    questionShownAt = Date.now();
    await tick();
    hwCanvas?.clear();
    answerInput?.focus();
  }

  function record(correct: boolean, given: string | null) {
    if (!engine) return;
    engine.answer(correct, given, Date.now() - questionShownAt);
    lastCorrect = correct;
    lastGiven = given;
    version++;
  }

  function showFeedback() {
    phase = 'feedback';
    // Los aciertos pasan solos; los fallos esperan a que se pulse Intro.
    if (lastCorrect) advanceTimer = setTimeout(nextQuestion, 700);
  }

  function submitTyped(e?: SubmitEvent) {
    e?.preventDefault();
    if (phase !== 'ask' || typed.trim() === '') return;
    record(checkTyped(typed, expectedText), typed);
    showFeedback();
  }

  async function submitHandwriting() {
    if (phase !== 'ask' || !hwCanvas) return;
    const image = hwCanvas.getImage();
    if (!image) {
      // Sin nada escrito el botón es «No lo sé»: cuenta como fallo.
      record(false, null);
      showFeedback();
      return;
    }
    phase = 'checking';
    try {
      const r = await hwCheck(image, expectedText);
      lastScores = r.scores;
      record(r.correct, r.recognized);
      showFeedback();
    } catch (e) {
      hwError = `Error al reconocer: ${e}`;
      phase = 'ask';
    }
  }

  function selfAnswer(correct: boolean) {
    if (phase !== 'revealed') return;
    record(correct, null);
    nextQuestion();
  }

  function overrideAsCorrect() {
    if (!engine || phase !== 'feedback' || lastCorrect || lastGiven === null) return;
    engine.overrideLastAsCorrect();
    lastCorrect = true;
    version++;
    advanceTimer = setTimeout(nextQuestion, 500);
  }

  async function finish() {
    clearInterval(timer);
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
    running = false;
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
    clearInterval(timer);
    running = false;
    goto(quiz?.folderId ? `/library?folder=${quiz.folderId}` : '/library');
  }

  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      showDebug = !showDebug;
      return;
    }
    if (!running) {
      if (e.key === 'Enter' && quiz) {
        e.preventDefault();
        start();
      }
      return;
    }
    if (e.repeat) return;
    const key = e.key;
    const isGo = key === 'Enter' || key === ' ';

    if (phase === 'feedback') {
      if (key === 'Enter') {
        e.preventDefault();
        nextQuestion();
      } else if (handwriting && !lastCorrect && key.toLowerCase() === 'c') {
        e.preventDefault();
        overrideAsCorrect();
      }
      return;
    }

    if (opts.answerMode === 'self') {
      if (phase === 'ask' && isGo) {
        e.preventDefault();
        phase = 'revealed';
      } else if (phase === 'revealed' && isGo) {
        e.preventDefault();
        selfAnswer(true);
      } else if (phase === 'revealed' && key.toLowerCase() === 'n') {
        e.preventDefault();
        selfAnswer(false);
      }
      return;
    }

    if (handwriting && phase === 'ask') {
      if (key === 'Enter') {
        e.preventDefault();
        submitHandwriting();
      } else if (key === 'Delete' || key === 'Backspace') {
        e.preventDefault();
        hwCanvas?.clear();
      } else if (e.ctrlKey && key.toLowerCase() === 'z') {
        e.preventDefault();
        hwCanvas?.undo();
      }
    }
  }

  /** Evita que los botones se queden con el foco (si no, Espacio/Intro los pulsaría además del atajo). */
  const noFocus = (e: PointerEvent) => e.preventDefault();
</script>

<svelte:window onkeydown={onKey} />

{#if quiz && !running}
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
{:else if quiz && running && current}
  <div class="session">
    <header class="bar">
      <div class="row">
        <strong>{quiz.name}</strong>
        <span class="muted">Ronda {position.round} · {position.index}/{position.size}</span>
        {#if errors > 0}<span class="errors">✗ {errors}</span>{/if}
      </div>
      <div class="row">
        <span class="clock">{formatDuration(now - startedAt)}</span>
        <button onpointerdown={noFocus} onclick={abandon}>Abandonar</button>
      </div>
    </header>
    <div class="progressbar"><div style:width="{((position.index - 1) / position.size) * 100}%"></div></div>

    <div class="stage">
      {#if position.round > 1}
        <p class="round-note">Repaso de las falladas</p>
      {/if}
      <p class="lang muted">{fromLang} → {toLang}</p>
      <div class="prompt">{parse(promptText).full}</div>

      {#if opts.answerMode === 'self'}
        {#if phase === 'ask'}
          <button class="primary big" onpointerdown={noFocus} onclick={() => (phase = 'revealed')}>
            Mostrar respuesta <kbd>Espacio</kbd><kbd>Intro</kbd>
          </button>
        {:else}
          <div class="answer">{parse(expectedText).full}</div>
          <div class="row center">
            <button class="ok big" onpointerdown={noFocus} onclick={() => selfAnswer(true)}>
              Bien <kbd>Espacio</kbd><kbd>Intro</kbd>
            </button>
            <button class="bad big" onpointerdown={noFocus} onclick={() => selfAnswer(false)}>Mal <kbd>N</kbd></button>
          </div>
        {/if}
      {:else if !handwriting}
        <form class="typed" onsubmit={submitTyped}>
          <input
            bind:this={answerInput}
            bind:value={typed}
            readonly={phase !== 'ask'}
            placeholder="Escribe la respuesta en {toLang.toLowerCase()}"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            class:right={phase === 'feedback' && lastCorrect}
            class:wrong={phase === 'feedback' && !lastCorrect}
          />
          {#if phase === 'ask'}
            <button class="primary" type="submit" onpointerdown={noFocus} disabled={!typed.trim()}>Comprobar <kbd>Intro</kbd></button>
          {/if}
        </form>
      {:else}
        <div class="hw">
          <HandwritingCanvas bind:this={hwCanvas} disabled={phase !== 'ask'} onchange={(empty) => (canvasEmpty = empty)} />
          {#if phase === 'ask' || phase === 'checking'}
            <div class="row center">
              <button onpointerdown={noFocus} onclick={() => hwCanvas?.clear()} disabled={phase !== 'ask'}>Borrar <kbd>Supr</kbd></button>
              <button onpointerdown={noFocus} onclick={() => hwCanvas?.undo()} disabled={phase !== 'ask'}>Deshacer <kbd>Ctrl+Z</kbd></button>
              <button class="primary" onpointerdown={noFocus} onclick={submitHandwriting} disabled={phase !== 'ask'}>
                <!-- Todos los textos apilados para que el botón no cambie de tamaño al cambiar el visible. -->
                <span class="stack">
                  {#each ['Comprobar', 'No lo sé', 'Leyendo…', 'Cargando…'] as label (label)}
                    <span class:shown={label === hwButtonLabel}>{label}</span>
                  {/each}
                </span>
                <kbd>Intro</kbd>
              </button>
            </div>
          {/if}
          {#if hwError}<p class="error">{hwError}</p>{/if}
        </div>
      {/if}

      {#if phase === 'feedback'}
        <div class="feedback" class:right={lastCorrect} class:wrong={!lastCorrect}>
          {#if lastCorrect}
            <div class="verdict">✓ ¡Correcto!</div>
            <div class="muted">{parse(expectedText).full}</div>
          {:else}
            <div class="verdict">✗ No es correcto</div>
            {#if handwriting && lastGiven !== null}
              <div>La IA leyó: <strong>{lastGiven || '(nada)'}</strong></div>
            {/if}
            <div>Respuesta correcta: <strong>{parse(expectedText).full}</strong></div>
            <div class="row center">
              {#if handwriting && lastGiven !== null}
                <button onpointerdown={noFocus} onclick={overrideAsCorrect}>La IA se equivocó, era correcto <kbd>C</kbd></button>
              {/if}
              <button class="primary" onpointerdown={noFocus} onclick={nextQuestion}>Continuar <kbd>Intro</kbd></button>
            </div>
          {/if}
        </div>
      {/if}

      {#if showDebug && lastScores}
        <pre class="debug">expected={lastScores.expected.toFixed(3)} recognized={lastScores.recognized.toFixed(3)} diff={(lastScores.recognized - lastScores.expected).toFixed(3)}</pre>
      {/if}
    </div>
  </div>
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

  .session {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 1rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .clock {
    font-variant-numeric: tabular-nums;
    font-size: 1.1rem;
    min-width: 4.5rem;
    text-align: right;
  }
  .errors {
    color: var(--bad);
  }
  .progressbar {
    height: 4px;
    background: var(--surface-2);
  }
  .progressbar div {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }
  .stage {
    flex: 1;
    overflow: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 2rem 1rem;
    width: min(760px, 100%);
    margin: 0 auto;
  }
  .round-note {
    margin: 0;
    color: var(--warn);
    font-weight: 600;
  }
  .lang {
    margin: 0;
  }
  .prompt {
    font-size: 2.4rem;
    font-weight: 600;
    text-align: center;
    word-break: break-word;
  }
  .answer {
    font-size: 2rem;
    color: var(--accent);
    text-align: center;
  }
  .center {
    justify-content: center;
  }
  /* Botones de la práctica: grandes, que sobra espacio y se pulsan a menudo. */
  .stage button {
    font-size: 1.2rem;
    padding: 0.7rem 1.4rem;
    border-radius: 8px;
  }
  .stage button.big {
    font-size: 1.4rem;
    padding: 0.9rem 2rem;
  }
  .stage .row {
    gap: 0.8rem;
  }
  .typed {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.8rem;
    width: min(640px, 100%);
  }
  .typed input {
    width: 100%;
    font-size: 1.5rem;
    padding: 0.7rem 1rem;
    text-align: center;
  }
  input.right {
    border-color: var(--ok);
    background: var(--ok-bg);
  }
  input.wrong {
    border-color: var(--bad);
    background: var(--bad-bg);
  }
  .stack {
    display: inline-grid;
    justify-items: center;
  }
  .stack > span {
    grid-area: 1 / 1;
    visibility: hidden;
  }
  .stack > span.shown {
    visibility: visible;
  }
  .hw {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .feedback {
    width: min(560px, 100%);
    border-radius: var(--radius);
    padding: 0.9rem 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    text-align: center;
  }
  .feedback.right {
    background: var(--ok-bg);
  }
  .feedback.wrong {
    background: var(--bad-bg);
  }
  .verdict {
    font-weight: 700;
    font-size: 1.2rem;
  }
  .right .verdict {
    color: var(--ok);
  }
  .wrong .verdict {
    color: var(--bad);
  }
  .debug {
    font-size: 0.8rem;
    color: var(--muted);
  }
</style>
