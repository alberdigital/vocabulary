<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as repo from '$lib/db/repo';
  import type { AnswerRecord, SessionRecord } from '$lib/db/types';
  import { parse } from '$lib/quiz/answer';
  import { formatDate, formatDuration, unsaved } from '$lib/state.svelte';

  let session = $state<Omit<SessionRecord, 'id'> | null>(null);
  let answers = $state<AnswerRecord[]>([]);
  let quizExists = $state(false);
  const isPractice = $derived(page.params.sessionId === 'practice');

  $effect(() => {
    const sid = page.params.sessionId;
    (async () => {
      if (sid === 'practice') {
        if (!unsaved.result) return goto('/history');
        session = unsaved.result.session;
        answers = unsaved.result.answers;
      } else {
        const r = await repo.getSession(Number(sid));
        if (!r) return goto('/history');
        session = r.session;
        answers = r.answers;
      }
      quizExists = session.quizId !== null && (await repo.getQuiz(session.quizId)) !== null;
    })();
  });

  /** Palabras falladas alguna vez, con cuántos fallos. */
  const failed = $derived.by(() => {
    const map = new Map<string, { prompt: string; expected: string; misses: number; pairId: number | null; given: string[] }>();
    for (const a of answers) {
      if (a.correct) continue;
      const key = `${a.pairId ?? ''}|${a.prompt}`;
      const e = map.get(key) ?? { prompt: a.prompt, expected: a.expected, misses: 0, pairId: a.pairId, given: [] };
      e.misses++;
      if (a.given) e.given.push(a.given);
      map.set(key, e);
    }
    return [...map.values()].sort((x, y) => y.misses - x.misses);
  });
  const overridden = $derived(answers.filter((a) => a.overridden).length);

  const modeLabel = $derived.by(() => {
    if (!session) return '';
    if (session.answerMode === 'self') return 'Autoevaluación';
    return session.inputMode === 'handwriting' ? 'Escrita a mano' : 'Escrita con teclado';
  });

  function repeat() {
    if (session?.quizId) goto(`/quiz/${session.quizId}/play`);
  }

  function repeatFailed() {
    const ids = failed.map((f) => f.pairId).filter((id): id is number => id !== null);
    if (session?.quizId && ids.length) goto(`/quiz/${session.quizId}/play?only=${ids.join(',')}`);
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Enter' && quizExists && !e.repeat) {
      e.preventDefault();
      repeat();
    }
  }}
/>

{#if session}
  <div class="wrap">
    <h1>{isPractice ? 'Práctica terminada' : '¡Terminado!'}</h1>
    <p class="muted">
      {session.quizName} · {modeLabel} · {formatDate(session.finishedAt)}
      {#if isPractice}· práctica de las falladas, no se guarda en el historial{/if}
    </p>

    <div class="stats">
      <div class="card stat">
        <div class="value">{session.pairCount}</div>
        <div class="label">Palabras</div>
      </div>
      <div class="card stat">
        <div class="value" class:ok={session.firstRoundErrors === 0}>{session.pairCount - session.firstRoundErrors}</div>
        <div class="label">Aciertos a la primera</div>
      </div>
      <div class="card stat">
        <div class="value" class:bad={session.firstRoundErrors > 0}>{session.firstRoundErrors}</div>
        <div class="label">Errores en la primera vuelta</div>
      </div>
      <div class="card stat">
        <div class="value" class:bad={session.totalErrors > 0}>{session.totalErrors}</div>
        <div class="label">Errores en total<br /><span class="muted">{session.rounds} ronda{session.rounds === 1 ? '' : 's'}</span></div>
      </div>
      <div class="card stat">
        <div class="value">{formatDuration(session.durationMs)}</div>
        <div class="label">Tiempo total</div>
      </div>
    </div>

    {#if overridden > 0}
      <p class="muted">{overridden} respuesta{overridden === 1 ? '' : 's'} a mano corregida{overridden === 1 ? '' : 's'} manualmente («la IA se equivocó»).</p>
    {/if}

    <div class="row actions">
      {#if quizExists}
        <button class="primary" onclick={repeat}>Repetir <kbd>Intro</kbd></button>
        {#if failed.length > 0}
          <button onclick={repeatFailed}>Repetir solo las falladas</button>
        {/if}
      {/if}
      <button onclick={() => goto('/library')}>Volver a los cuestionarios</button>
      <button class="link" onclick={() => goto('/history')}>Ver historial</button>
    </div>

    {#if failed.length > 0}
      <h2>Palabras falladas</h2>
      <table>
        <thead><tr><th>Pregunta</th><th>Respuesta correcta</th><th>Respondiste</th><th>Fallos</th></tr></thead>
        <tbody>
          {#each failed as f (f.prompt + f.pairId)}
            <tr>
              <td>{parse(f.prompt).full}</td>
              <td><strong>{parse(f.expected).full}</strong></td>
              <td class="muted">{f.given.join(' · ') || '—'}</td>
              <td>{f.misses}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="perfect">¡Sin ningún error! 🎉</p>
    {/if}
  </div>
{/if}

<style>
  .wrap {
    max-width: 800px;
    margin: 1rem auto;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.75rem;
    margin: 1.25rem 0;
  }
  .stat {
    text-align: center;
  }
  .value {
    font-size: 2.4rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .value.bad {
    color: var(--bad);
  }
  .value.ok {
    color: var(--ok);
  }
  .label {
    font-size: 0.9rem;
  }
  .actions {
    margin-bottom: 1.5rem;
  }
  .perfect {
    font-size: 1.2rem;
    color: var(--ok);
  }
</style>
