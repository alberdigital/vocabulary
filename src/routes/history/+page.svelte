<script lang="ts">
  import { goto } from '$app/navigation';
  import * as repo from '$lib/db/repo';
  import type { LeitnerPracticeRecord, SessionRecord } from '$lib/db/types';
  import { app, formatDate, formatDuration } from '$lib/state.svelte';

  let sessions = $state<SessionRecord[]>([]);
  let boxSessions = $state<LeitnerPracticeRecord[]>([]);
  let filter = $state('');

  $effect(() => {
    const user = app.user;
    if (!user) return;
    repo.listSessions(user.id).then((s) => (sessions = s));
    repo.listLeitnerPractices(user.id).then((s) => (boxSessions = s));
  });

  /** Cuestionarios presentes en el historial (por nombre guardado, por si se han borrado). */
  const quizNames = $derived([...new Set(sessions.map((s) => s.quizName))].sort((a, b) => a.localeCompare(b, 'es')));
  const shown = $derived(filter ? sessions.filter((s) => s.quizName === filter) : sessions);

  function mode(s: SessionRecord): string {
    const dir = s.direction === 'AB' ? 'A→B' : 'B→A';
    if (s.answerMode === 'self') return `${dir} · autoevaluación`;
    return `${dir} · ${s.inputMode === 'handwriting' ? 'a mano' : 'teclado'}`;
  }
</script>

<h1>Historial de {app.user?.name}</h1>

<div class="row head">
  <h2>Cuestionarios</h2>
  {#if quizNames.length > 1}
    <select bind:value={filter}>
      <option value="">Todos los cuestionarios</option>
      {#each quizNames as n (n)}<option value={n}>{n}</option>{/each}
    </select>
  {/if}
</div>

{#if sessions.length === 0}
  <p class="muted">Todavía no has completado ningún cuestionario.</p>
{:else}
  <table>
    <thead>
      <tr>
        <th>Fecha</th>
        <th>Cuestionario</th>
        <th>Modo</th>
        <th class="num">Palabras</th>
        <th class="num">Tiempo</th>
        <th class="num">Errores 1.ª vuelta</th>
        <th class="num">Errores totales</th>
      </tr>
    </thead>
    <tbody>
      {#each shown as s (s.id)}
        <tr class="clickable" onclick={() => goto(`/results/${s.id}`)}>
          <td>{formatDate(s.finishedAt)}</td>
          <td>{s.quizName}{#if s.quizId === null}<span class="muted"> (borrado)</span>{/if}</td>
          <td class="muted">{mode(s)}</td>
          <td class="num">{s.pairCount}</td>
          <td class="num">{formatDuration(s.durationMs)}</td>
          <td class="num">{s.firstRoundErrors}</td>
          <td class="num">{s.totalErrors}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<h2 class="second">Cajas de Leitner</h2>
{#if boxSessions.length === 0}
  <p class="muted">Todavía no has practicado ninguna caja.</p>
{:else}
  <table>
    <thead>
      <tr>
        <th>Fecha</th>
        <th>Caja</th>
        <th class="num">Aciertos</th>
        <th class="num">Fallos</th>
        <th class="num">Tiempo</th>
      </tr>
    </thead>
    <tbody>
      {#each boxSessions as s (s.id)}
        <tr>
          <td>{formatDate(s.finishedAt)}</td>
          <td>
            {s.boxName}{#if s.boxId === null}<span class="muted"> (borrada)</span>{/if}
          </td>
          <td class="num">{s.correct}</td>
          <td class="num">{s.errors}</td>
          <td class="num">{formatDuration(s.durationMs)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .head {
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }
  .head h2 {
    margin: 0;
  }
  .second {
    margin-top: 2rem;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .clickable {
    cursor: pointer;
  }
  .clickable:hover {
    background: var(--surface-2);
  }
</style>
