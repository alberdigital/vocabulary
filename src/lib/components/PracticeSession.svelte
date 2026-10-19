<!--
  Pantalla de una sesión de práctica: pregunta, respuesta (teclado, a mano o autoevaluación),
  corrección y atajos. La usan los cuestionarios y las cajas de Leitner; el motor decide qué se
  pregunta y la página que la usa guarda los resultados.
-->
<script lang="ts" module>
  export interface PracticeItem {
    a: string;
    b: string;
    langA: string;
    langB: string;
  }
</script>

<script lang="ts" generics="T">
  import { onDestroy, tick, type Snippet } from 'svelte';
  import type { SessionOptions } from '$lib/db/types';
  import WordEditDialog, { type WordEntry } from '$lib/components/WordEditDialog.svelte';
  import { showError } from '$lib/dialogs.svelte';
  import HandwritingCanvas from '$lib/handwriting/HandwritingCanvas.svelte';
  import { check as hwCheck, warmUp } from '$lib/handwriting/recognizer';
  import { checkTyped, parse } from '$lib/quiz/answer';
  import type { PracticeEngine } from '$lib/quiz/engine';
  import { langName } from '$lib/quiz/languages';
  import { formatDuration } from '$lib/state.svelte';

  type Phase = 'ask' | 'checking' | 'feedback' | 'revealed';

  /** Lo que dura el destello verde de un acierto antes de pasar a la siguiente: lo justo para verlo. */
  const FLASH_MS = 150;
  /**
   * A mano el acierto dura más y muestra la respuesta escrita a máquina: el reconocimiento puede
   * haber dado por buena una respuesta que no lo era.
   */
  const HANDWRITING_FLASH_MS = 1400;
  /** Palabras que se pueden corregir con «Editar últimas palabras» (incluida la actual). */
  const RECENT_WORDS = 5;

  let {
    title,
    opts,
    engine,
    startedAt,
    toItem,
    stopLabel = 'Abandonar',
    onanswered,
    onoverride,
    onfinish,
    onstop,
    onedit,
    oneditword,
    top,
    context,
    actions,
  }: {
    title: string;
    opts: SessionOptions;
    engine: PracticeEngine<T> & { skip?(): void };
    startedAt: number;
    toItem: (t: T) => PracticeItem;
    /** Botón para dejar de practicar. */
    stopLabel?: string;
    /** Tras registrar una respuesta en el motor. */
    onanswered?: (item: T, correct: boolean) => void;
    /** Tras corregir como acierto la última respuesta («La IA se equivocó» o «Marcar correcta»). */
    onoverride?: (item: T) => void;
    /** Cuando el motor no tiene nada más que preguntar. */
    onfinish: () => void;
    onstop: () => void;
    /** Botón «Editar» de la barra: ir a editar el cuestionario o la caja. */
    onedit?: () => void;
    /**
     * Corrige una palabra (a y b como en toItem): debe guardarla y cambiarla en el propio item, que
     * es el del motor, para que se pregunte ya corregida.
     */
    oneditword?: (item: T, a: string, b: string) => Promise<void>;
    /** Debajo de la barra de progreso. */
    top?: Snippet<[T | null]>;
    /** Debajo de la palabra preguntada. */
    context?: Snippet<[T]>;
    /** Acciones extra; remove() pasa a la siguiente sin contar la actual. */
    actions?: Snippet<[{ item: T; phase: Phase; remove: () => void }]>;
  } = $props();

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
  let questionShownAt = 0;
  let now = $state(Date.now());
  let advanceTimer: ReturnType<typeof setTimeout> | undefined;
  let answerInput: HTMLInputElement | undefined = $state();
  let hwCanvas: HandwritingCanvas | undefined = $state();
  const timer = setInterval(() => (now = Date.now()), 250);

  /**
   * Palabra en pantalla. No sigue al motor directamente: durante la corrección debe seguir mostrándose la contestada.
   * Es el objeto del motor tal cual (raw), para que corregir una palabra la cambie también allí.
   */
  let current = $state.raw<T | null>(null);
  /** Últimas palabras preguntadas, de la más antigua a la actual, sin repetir. */
  let recent = $state.raw<T[]>([]);
  /** «Editar últimas palabras» abierto (desde qué momento, para no contarlo en el tiempo de respuesta). */
  let editingSince = $state<number | null>(null);
  /** Ronda y posición de la palabra en pantalla (se fijan al mostrarla); size null = sin número fijo. */
  let position = $state<{ round: number; index: number; size: number | null }>({ round: 1, index: 1, size: 1 });
  const errors = $derived.by(() => {
    version;
    return engine.totalErrors;
  });
  const answered = $derived.by(() => {
    version;
    return engine.roundDone;
  });
  const item = $derived.by(() => {
    version; // una corrección cambia el item sin cambiar current
    if (!current) return null;
    // Copia: toItem puede devolver el propio objeto (cajas) y, si no cambia, lo que depende de item no se recalcula.
    const { a, b, langA, langB } = toItem(current);
    return { a, b, langA, langB };
  });
  const ab = $derived(opts.direction === 'AB');
  const promptText = $derived(item ? (ab ? item.a : item.b) : '');
  const expectedText = $derived(item ? (ab ? item.b : item.a) : '');
  const fromLang = $derived(item ? langName(ab ? item.langA : item.langB) : '');
  const toLang = $derived(item ? langName(ab ? item.langB : item.langA) : '');
  const handwriting = $derived(opts.answerMode === 'typed' && opts.inputMode === 'handwriting');
  /** Acierto recién registrado: la palabra y la respuesta se ponen verdes un instante (a mano, además, se ve la respuesta). */
  const flash = $derived(phase === 'feedback' && lastCorrect);
  const hwButtonLabel = $derived(
    phase === 'checking' ? (modelState === 'ready' ? 'Leyendo…' : 'Cargando…') : canvasEmpty ? 'No lo sé' : 'Comprobar'
  );

  // Precarga del modelo si se escribe a mano.
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

  // Primera pregunta.
  nextQuestion();

  async function nextQuestion() {
    clearTimeout(advanceTimer);
    if (engine.finished) {
      clearInterval(timer);
      return onfinish();
    }
    current = engine.current ?? null;
    if (current) recent = [...recent.filter((x) => x !== current), current].slice(-RECENT_WORDS);
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
    if (!current) return;
    engine.answer(correct, given, Date.now() - questionShownAt);
    lastCorrect = correct;
    lastGiven = given;
    version++;
    onanswered?.(current, correct);
  }

  function showFeedback() {
    phase = 'feedback';
    // Los aciertos pasan solos; los fallos esperan a que se pulse Intro.
    if (lastCorrect) advanceTimer = setTimeout(nextQuestion, handwriting ? HANDWRITING_FLASH_MS : FLASH_MS);
  }

  function submitTyped(e?: SubmitEvent) {
    e?.preventDefault();
    if (phase !== 'ask') return;
    // En blanco el botón es «No lo sé»: cuenta como fallo, sin respuesta que dar por buena.
    if (typed.trim() === '') record(false, null);
    else record(checkTyped(typed, expectedText), typed);
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

  /**
   * Da por buena la última respuesta escrita, a mano («La IA se equivocó») o con teclado («Marcar
   * correcta»: otra forma válida de decirlo, una pregunta ambigua…).
   */
  function overrideAsCorrect() {
    if (!current || phase !== 'feedback' || lastCorrect || lastGiven === null) return;
    engine.overrideLastAsCorrect();
    lastCorrect = true;
    version++;
    onoverride?.(current);
    advanceTimer = setTimeout(nextQuestion, handwriting ? HANDWRITING_FLASH_MS : FLASH_MS);
  }

  /** Pasa a la siguiente sin contar la actual (si ya se respondió, la respuesta se queda). */
  function remove() {
    clearTimeout(advanceTimer);
    if (phase !== 'feedback') engine.skip?.();
    nextQuestion();
  }

  /** Las últimas palabras en el sentido de la práctica, para el diálogo. */
  function recentEntries(): WordEntry[] {
    return recent.map((t) => {
      const it = toItem(t);
      const [a, b] = [langName(it.langA), langName(it.langB)];
      return ab ? { from: it.a, to: it.b, fromLang: a, toLang: b } : { from: it.b, to: it.a, fromLang: b, toLang: a };
    });
  }

  async function saveWord(index: number, from: string, to: string) {
    const t = recent[index];
    if (!t || !oneditword) return;
    try {
      await oneditword(t, ab ? from : to, ab ? to : from);
    } catch (e) {
      showError(e);
    }
    version++;
  }

  async function closeEditor() {
    if (editingSince !== null) questionShownAt += Date.now() - editingSince;
    editingSince = null;
    await tick();
    answerInput?.focus();
  }

  function onKey(e: KeyboardEvent) {
    if (editingSince !== null) return; // el diálogo tiene sus propias teclas
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      showDebug = !showDebug;
      return;
    }
    if (e.repeat) return;
    const key = e.key;
    const isGo = key === 'Enter' || key === ' ';

    if (phase === 'feedback') {
      if (key === 'Enter') {
        e.preventDefault();
        nextQuestion();
      } else if (opts.answerMode === 'typed' && !lastCorrect && key.toLowerCase() === 'c') {
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

{#if current}
  <div class="session">
    <header class="bar">
      <div class="row">
        <strong>{title}</strong>
        <span class="muted">
          {#if position.size === null}
            {answered} respondida{answered === 1 ? '' : 's'}
          {:else}
            Ronda {position.round} · {position.index}/{position.size}
          {/if}
        </span>
        {#if errors > 0}<span class="errors">✗ {errors}</span>{/if}
      </div>
      <div class="row">
        <span class="clock">{formatDuration(now - startedAt)}</span>
        {#if onedit}<button onpointerdown={noFocus} onclick={onedit}>Editar</button>{/if}
        <button onpointerdown={noFocus} onclick={onstop}>{stopLabel}</button>
      </div>
    </header>
    {#if position.size !== null}
      <div class="progressbar"><div style:width="{((position.index - 1) / position.size) * 100}%"></div></div>
    {/if}
    {@render top?.(current)}

    <div class="stage">
      {#if position.round > 1}
        <p class="round-note">Repaso de las falladas</p>
      {/if}
      <p class="lang muted">{fromLang} → {toLang}</p>
      <div class="prompt" class:right={flash}>{parse(promptText).full}</div>
      {@render context?.(current)}

      {#if opts.answerMode === 'self'}
        <!-- Ocupa su sitio aun oculta, para que los botones no se muevan al mostrarla. -->
        <div class="answer" class:hidden={phase === 'ask'} aria-hidden={phase === 'ask'}>{parse(expectedText).full}</div>
        <div class="row center">
          {#if phase === 'ask'}
            <button class="primary big" onpointerdown={noFocus} onclick={() => (phase = 'revealed')}>
              Mostrar respuesta <kbd>Espacio</kbd><kbd>Intro</kbd>
            </button>
          {:else}
            <button class="ok big" onpointerdown={noFocus} onclick={() => selfAnswer(true)}>
              Bien <kbd>Espacio</kbd><kbd>Intro</kbd>
            </button>
            <button class="bad big" onpointerdown={noFocus} onclick={() => selfAnswer(false)}>Mal <kbd>N</kbd></button>
          {/if}
        </div>
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
          <!-- Durante el destello sigue a la vista (desactivado) para que nada se mueva. -->
          {#if phase === 'ask' || flash}
            <button class="primary" type="submit" onpointerdown={noFocus} disabled={phase !== 'ask'}>
              <span class="stack">
                {#each ['Comprobar', 'No lo sé'] as label (label)}
                  <span class:shown={label === (typed.trim() ? 'Comprobar' : 'No lo sé')}>{label}</span>
                {/each}
              </span>
              <kbd>Intro</kbd>
            </button>
          {/if}
        </form>
      {:else}
        <div class="hw">
          <div class="canvas-wrap" class:right={flash}>
            <HandwritingCanvas bind:this={hwCanvas} disabled={phase !== 'ask'} onchange={(empty) => (canvasEmpty = empty)} />
          </div>
          {#if phase === 'ask' || phase === 'checking' || flash}
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

      {#if flash && handwriting}
        <div class="feedback right">
          <div class="verdict">✓ {parse(expectedText).full}</div>
        </div>
      {/if}

      {#if phase === 'feedback' && !lastCorrect}
        <div class="feedback wrong">
          <div class="verdict">✗ No es correcto</div>
          {#if handwriting && lastGiven !== null}
            <div>La IA leyó: <strong>{lastGiven || '(nada)'}</strong></div>
          {/if}
          <div>Respuesta correcta: <strong>{parse(expectedText).full}</strong></div>
          <div class="row center">
            {#if lastGiven !== null}
              <button onpointerdown={noFocus} onclick={overrideAsCorrect}>
                {handwriting ? 'La IA se equivocó, era correcto' : 'Marcar correcta'} <kbd>C</kbd>
              </button>
            {/if}
            <button class="primary" onpointerdown={noFocus} onclick={nextQuestion}>Continuar <kbd>Intro</kbd></button>
          </div>
        </div>
      {/if}

      {#if (actions || oneditword) && phase !== 'checking'}
        <div class="row center extra">
          {#if oneditword}
            <button class="link quiet" onpointerdown={noFocus} onclick={() => (editingSince = Date.now())}>
              Editar últimas palabras
            </button>
          {/if}
          {@render actions?.({ item: current, phase, remove })}
        </div>
      {/if}

      {#if showDebug && lastScores}
        <pre class="debug">expected={lastScores.expected.toFixed(3)} recognized={lastScores.recognized.toFixed(3)} diff={(lastScores.recognized - lastScores.expected).toFixed(3)}</pre>
      {/if}
    </div>
  </div>
  {#if editingSince !== null}
    <WordEditDialog entries={recentEntries()} onsave={saveWord} onclose={closeEditor} />
  {/if}
{/if}

<style>
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
  .prompt.right {
    color: var(--ok);
  }
  .answer {
    font-size: 2rem;
    color: var(--accent);
    text-align: center;
  }
  .answer.hidden {
    visibility: hidden;
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
  .canvas-wrap {
    position: relative;
  }
  /* El lienzo se pinta de blanco por dentro: el verde va en una capa encima. */
  .canvas-wrap.right::after {
    content: '';
    position: absolute;
    inset: 0;
    border: 2px solid var(--ok);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--ok) 25%, transparent);
    pointer-events: none;
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
  .right .verdict {
    color: var(--ok);
    font-size: 1.6rem;
  }
  .feedback.wrong {
    background: var(--bad-bg);
  }
  .verdict {
    font-weight: 700;
    font-size: 1.2rem;
  }
  .wrong .verdict {
    color: var(--bad);
  }
  .extra {
    margin-top: 0.5rem;
  }
  .stage button.quiet {
    font-size: 0.9rem;
    color: var(--muted);
  }
  .stage button.quiet:hover {
    color: var(--text);
  }
  .debug {
    font-size: 0.8rem;
    color: var(--muted);
  }
</style>
