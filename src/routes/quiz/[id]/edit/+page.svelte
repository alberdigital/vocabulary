<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { tick } from 'svelte';
  import * as repo from '$lib/db/repo';
  import type { Quiz } from '$lib/db/types';
  import { confirmDanger, showError } from '$lib/dialogs.svelte';
  import { validateSide } from '$lib/quiz/answer';
  import { LANGUAGES } from '$lib/quiz/languages';
  import { parsePastedList } from '$lib/quiz/pasteList';

  interface Row {
    key: number;
    id: number | null;
    a: string;
    b: string;
  }

  const id = $derived(Number(page.params.id));
  let quiz = $state<Quiz | null>(null);
  let name = $state('');
  let langA = $state('en');
  let langB = $state('es');
  let rows = $state<Row[]>([]);
  let saved = $state('');
  let showPaste = $state(false);
  let pasteText = $state('');
  let pasteMsg = $state('');
  let statusMsg = $state('');
  let tbody: HTMLTableSectionElement | undefined = $state();
  let nextKey = 1;

  const row = (id: number | null, a: string, b: string): Row => ({ key: nextKey++, id, a, b });
  const snapshot = () => JSON.stringify({ name, langA, langB, rows: rows.map((r) => [r.id, r.a, r.b]) });
  const dirty = $derived(quiz !== null && snapshot() !== saved);

  $effect(() => {
    const quizId = id;
    repo.getQuiz(quizId).then((q) => {
      if (!q) return goto('/library');
      quiz = q;
      name = q.name;
      langA = q.langA;
      langB = q.langB;
      rows = q.pairs.map((p) => row(p.id, p.a, p.b));
      if (rows.length === 0) rows.push(row(null, '', ''));
      saved = snapshot();
    });
  });

  /** Filas a guardar: se ignoran las que tienen los dos lados vacíos. */
  const filled = $derived(rows.filter((r) => r.a.trim() !== '' || r.b.trim() !== ''));
  const errors = $derived(
    new Map(
      filled
        .map((r) => [r.key, validateSide(r.a) ?? validateSide(r.b)] as const)
        .filter((e): e is readonly [number, string] => e[1] !== null)
    )
  );
  const canSave = $derived(name.trim() !== '' && errors.size === 0);

  async function save(): Promise<boolean> {
    if (!quiz || !canSave) return false;
    try {
      const updated: Quiz = {
        ...quiz,
        name: name.trim(),
        langA,
        langB,
        pairs: filled.map((r) => ({ id: r.id, a: r.a.trim(), b: r.b.trim() })),
      };
      await repo.saveQuiz(updated);
      // Se recarga para obtener los ids de los pares nuevos.
      const q = await repo.getQuiz(quiz.id);
      if (q) {
        quiz = q;
        rows = q.pairs.map((p) => row(p.id, p.a, p.b));
        if (rows.length === 0) rows.push(row(null, '', ''));
        saved = snapshot();
      }
      statusMsg = 'Guardado';
      setTimeout(() => (statusMsg = ''), 2000);
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

  async function focusCell(index: number, side: 'a' | 'b') {
    await tick();
    tbody?.querySelector<HTMLInputElement>(`tr:nth-child(${index + 1}) input[data-side="${side}"]`)?.focus();
  }

  function addRow(after = rows.length - 1) {
    rows.splice(after + 1, 0, row(null, '', ''));
    focusCell(after + 1, 'a');
  }

  function removeRow(i: number) {
    rows.splice(i, 1);
    if (rows.length === 0) rows.push(row(null, '', ''));
  }

  function moveRow(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  function onCellKey(e: KeyboardEvent, i: number, side: 'a' | 'b') {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (side === 'a') focusCell(i, 'b');
    else if (i === rows.length - 1) addRow(i);
    else focusCell(i + 1, 'a');
  }

  function onWindowKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  }

  function applyPaste() {
    const { pairs, rejected } = parsePastedList(pasteText);
    // Si solo hay una fila vacía, se sustituye.
    const onlyEmpty = rows.length === 1 && rows[0].a === '' && rows[0].b === '';
    if (onlyEmpty) rows = [];
    rows.push(...pairs.map((p) => row(null, p.a, p.b)));
    if (rows.length === 0) rows.push(row(null, '', ''));
    pasteMsg =
      `Añadidos ${pairs.length} pares.` +
      (rejected.length ? ` No se entendieron ${rejected.length} líneas: ${rejected.slice(0, 3).join(' | ')}${rejected.length > 3 ? '…' : ''}` : '');
    pasteText = rejected.join('\n');
    if (rejected.length === 0) showPaste = false;
  }

  function swapLanguages() {
    [langA, langB] = [langB, langA];
    for (const r of rows) [r.a, r.b] = [r.b, r.a];
  }

  const langOptions = Object.entries(LANGUAGES);
</script>

<svelte:window onkeydown={onWindowKey} />

{#if quiz}
  <div class="row top">
    <button class="link" onclick={() => goto(quiz?.folderId ? `/library?folder=${quiz.folderId}` : '/library')}>
      ← Biblioteca
    </button>
    <div class="row">
      {#if statusMsg}<span class="ok">{statusMsg}</span>{/if}
      {#if dirty}<span class="muted">Cambios sin guardar</span>{/if}
      <button
        onclick={async () => {
          if (!dirty || (await save())) goto(`/quiz/${id}/play`);
        }}
        disabled={!canSave || filled.length === 0}>Guardar y practicar</button
      >
      <button class="primary" onclick={save} disabled={!canSave || !dirty}>Guardar <kbd>Ctrl+S</kbd></button>
    </div>
  </div>

  <div class="card meta">
    <label>
      <span class="muted">Nombre</span>
      <input bind:value={name} placeholder="Nombre del cuestionario" />
    </label>
    <div class="row">
      <label>
        <span class="muted">Idioma A</span>
        <select bind:value={langA}>
          {#each langOptions as [code, label] (code)}<option value={code}>{label}</option>{/each}
        </select>
      </label>
      <button class="link swap" onclick={swapLanguages} title="Intercambiar las columnas">⇄</button>
      <label>
        <span class="muted">Idioma B</span>
        <select bind:value={langB}>
          {#each langOptions as [code, label] (code)}<option value={code}>{label}</option>{/each}
        </select>
      </label>
    </div>
    <p class="muted hint">
      Escribe aclaraciones entre paréntesis, p. ej. <code>bank (of a river)</code>: se muestran al preguntar y no hace falta
      escribirlas al responder.
    </p>
  </div>

  <div class="row tools">
    <button onclick={() => addRow()}>+ Añadir par</button>
    <button onclick={() => { showPaste = !showPaste; pasteMsg = ''; }}>Pegar lista…</button>
    <span class="muted">{filled.length} pares</span>
  </div>

  {#if showPaste}
    <div class="card paste">
      <p class="muted">
        Un par por línea, separado por tabulador (p. ej. copiado de una hoja de cálculo), <code>=</code> o <code>;</code>.
      </p>
      <textarea bind:value={pasteText} rows="8" placeholder={'dog = perro\ncat = gato'}></textarea>
      <div class="row">
        <button class="primary" onclick={applyPaste} disabled={!pasteText.trim()}>Añadir</button>
        <button onclick={() => (showPaste = false)}>Cerrar</button>
        {#if pasteMsg}<span class="muted">{pasteMsg}</span>{/if}
      </div>
    </div>
  {:else if pasteMsg}
    <p class="ok">{pasteMsg}</p>
  {/if}

  <table class="pairs">
    <thead>
      <tr>
        <th class="num">#</th>
        <th>{LANGUAGES[langA] ?? langA}</th>
        <th>{LANGUAGES[langB] ?? langB}</th>
        <th></th>
      </tr>
    </thead>
    <tbody bind:this={tbody}>
      {#each rows as r, i (r.key)}
        {@const err = errors.get(r.key)}
        <tr class:invalid={err}>
          <td class="num muted">{i + 1}</td>
          <td><input data-side="a" bind:value={r.a} onkeydown={(e) => onCellKey(e, i, 'a')} /></td>
          <td><input data-side="b" bind:value={r.b} onkeydown={(e) => onCellKey(e, i, 'b')} /></td>
          <td class="rowtools">
            <button class="link" onclick={() => moveRow(i, -1)} disabled={i === 0} title="Subir">↑</button>
            <button class="link" onclick={() => moveRow(i, 1)} disabled={i === rows.length - 1} title="Bajar">↓</button>
            <button class="link danger" onclick={() => removeRow(i)} title="Borrar par">✕</button>
          </td>
        </tr>
        {#if err}
          <tr class="errrow"><td></td><td colspan="3" class="error">{err}</td></tr>
        {/if}
      {/each}
    </tbody>
  </table>
  <button class="link addbottom" onclick={() => addRow()}>+ Añadir par</button>
{/if}

<style>
  .top {
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }
  .ok {
    color: var(--ok);
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  label input {
    font-size: 1.1rem;
  }
  .swap {
    align-self: flex-end;
    font-size: 1.2rem;
  }
  .hint {
    margin: 0;
    font-size: 0.88rem;
  }
  .tools {
    margin: 1rem 0 0.5rem;
  }
  .paste {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .paste p {
    margin: 0;
  }
  .pairs input {
    width: 100%;
  }
  .pairs td {
    padding: 0.25rem 0.4rem;
    border-bottom: none;
  }
  .num {
    width: 2.5rem;
    text-align: right;
  }
  .rowtools {
    white-space: nowrap;
    width: 1%;
  }
  .invalid input {
    border-color: var(--bad);
  }
  .errrow td {
    padding-top: 0;
    font-size: 0.85rem;
  }
  .danger {
    color: var(--bad);
  }
  .addbottom {
    margin: 0.5rem 0 2rem 2.5rem;
  }
</style>
