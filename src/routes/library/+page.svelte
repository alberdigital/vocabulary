<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import FolderTree from '$lib/components/FolderTree.svelte';
  import * as repo from '$lib/db/repo';
  import type { Folder, QuizStats, QuizSummary } from '$lib/db/types';
  import { confirmDanger, prompt, showError } from '$lib/dialogs.svelte';
  import { exportFolder, exportQuiz, importFile } from '$lib/files';
  import { langName } from '$lib/quiz/languages';
  import { app, formatDuration } from '$lib/state.svelte';

  let folders = $state<Folder[]>([]);
  let quizzes = $state<QuizSummary[]>([]);
  let stats = $state<Record<number, QuizStats>>({});
  let notice = $state('');

  // La carpeta seleccionada va en la URL para que «Atrás» vuelva a ella.
  const selected = $derived.by(() => {
    const f = page.url.searchParams.get('folder');
    return f ? Number(f) : null;
  });
  const selectedFolder = $derived(folders.find((f) => f.id === selected) ?? null);

  const breadcrumb = $derived.by(() => {
    const out: Folder[] = [];
    let f = selectedFolder;
    while (f) {
      out.unshift(f);
      f = folders.find((x) => x.id === f!.parentId) ?? null;
    }
    return out;
  });

  async function loadFolders() {
    folders = await repo.listFolders();
  }

  async function loadQuizzes(folderId: number | null) {
    const list = await repo.listQuizzes(folderId);
    quizzes = list;
    const user = app.user;
    if (!user) return;
    const entries = await Promise.all(list.map(async (q) => [q.id, await repo.quizStats(user.id, q.id)] as const));
    stats = Object.fromEntries(entries);
  }

  onMount(loadFolders);
  $effect(() => {
    loadQuizzes(selected).catch(showError);
  });

  function select(id: number | null) {
    goto(id === null ? '/library' : `/library?folder=${id}`, { keepFocus: true, noScroll: true });
  }

  function flash(text: string) {
    notice = text;
    setTimeout(() => (notice = ''), 3000);
  }

  // ---------- Carpetas ----------

  async function newFolder() {
    const where = selectedFolder ? ` dentro de «${selectedFolder.name}»` : '';
    const name = await prompt(`Nueva carpeta${where}`, { okLabel: 'Crear' });
    if (!name) return;
    const id = await repo.createFolder(name, selected);
    await loadFolders();
    select(id);
  }

  async function renameFolder() {
    if (!selectedFolder) return;
    const name = await prompt('Renombrar carpeta', { value: selectedFolder.name, okLabel: 'Renombrar' });
    if (!name) return;
    await repo.renameFolder(selectedFolder.id, name);
    await loadFolders();
  }

  /** Opciones de destino para mover; excluye la propia carpeta y sus descendientes si se mueve una carpeta. */
  function destinations(excludeTreeOf: number | null) {
    const excluded = excludeTreeOf === null ? new Set<number>() : repo.descendantIds(folders, excludeTreeOf);
    const pathOf = (f: Folder): string => {
      const parent = folders.find((x) => x.id === f.parentId);
      return parent ? `${pathOf(parent)} / ${f.name}` : f.name;
    };
    return [
      { value: '', label: '(Sin carpeta)' },
      ...folders
        .filter((f) => !excluded.has(f.id))
        .map((f) => ({ value: String(f.id), label: pathOf(f) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es')),
    ];
  }

  async function moveFolder() {
    if (!selectedFolder) return;
    const dest = await prompt(`Mover «${selectedFolder.name}» a…`, {
      options: destinations(selectedFolder.id),
      okLabel: 'Mover',
    });
    if (dest === null) return;
    try {
      await repo.moveFolder(selectedFolder.id, dest === '' ? null : Number(dest));
      await loadFolders();
    } catch (e) {
      showError(e);
    }
  }

  async function deleteFolder() {
    if (!selectedFolder) return;
    const n = await repo.countQuizzesInTree(selectedFolder.id);
    const what =
      n === 0
        ? 'Está vacía de cuestionarios.'
        : `Se borrarán también ${n} cuestionario${n === 1 ? '' : 's'}, y sus palabras se quitarán de las cajas de Leitner que los usen.`;
    if (!(await confirmDanger(`¿Borrar la carpeta «${selectedFolder.name}» y sus subcarpetas? ${what}`))) return;
    const parent = selectedFolder.parentId;
    await repo.deleteFolder(selectedFolder.id);
    await loadFolders();
    select(parent);
  }

  // ---------- Cuestionarios ----------

  async function newQuiz() {
    const name = await prompt('Nuevo cuestionario', { okLabel: 'Crear', label: 'Nombre' });
    if (!name) return;
    const id = await repo.createQuiz(name, selected, 'en', 'es');
    goto(`/quiz/${id}/edit`);
  }

  async function moveQuiz(q: QuizSummary) {
    const dest = await prompt(`Mover «${q.name}» a…`, { options: destinations(null), okLabel: 'Mover' });
    if (dest === null) return;
    await repo.moveQuiz(q.id, dest === '' ? null : Number(dest));
    await loadQuizzes(selected);
  }

  async function deleteQuiz(q: QuizSummary) {
    const boxes = await repo.boxesUsingQuiz(q.id);
    const inBoxes =
      boxes === 0 ? '' : ` Está en ${boxes} caja${boxes === 1 ? '' : 's'} de Leitner; sus palabras se quitarán de ella${boxes === 1 ? '' : 's'}.`;
    if (!(await confirmDanger(`¿Borrar el cuestionario «${q.name}»? El historial de resultados se conserva.${inBoxes}`)))
      return;
    await repo.deleteQuiz(q.id);
    await loadQuizzes(selected);
  }

  async function doExportQuiz(q: QuizSummary) {
    try {
      if (await exportQuiz(q.id)) flash('Cuestionario exportado');
    } catch (e) {
      showError(e);
    }
  }

  async function doExportFolder() {
    try {
      if (await exportFolder(selected)) flash(selected === null ? 'Cuestionarios exportados' : 'Carpeta exportada');
    } catch (e) {
      showError(e);
    }
  }

  async function doImport() {
    try {
      const n = await importFile(selected);
      if (n === null) return;
      await loadFolders();
      await loadQuizzes(selected);
      flash(`Importado${n === 1 ? '' : 's'} ${n} cuestionario${n === 1 ? '' : 's'}`);
    } catch (e) {
      showError(e);
    }
  }
</script>

<div class="layout">
  <aside class="card">
    <div class="row head">
      <h2>Carpetas</h2>
      <button onclick={newFolder} title="Nueva carpeta dentro de la seleccionada">+ Carpeta</button>
    </div>
    <FolderTree {folders} {selected} onselect={select} />
  </aside>

  <section>
    <div class="row toolbar">
      <h1>
        {#if breadcrumb.length === 0}
          Sin carpeta
        {:else}
          {#each breadcrumb as f, i (f.id)}
            {#if i > 0}<span class="muted sep">/</span>{/if}
            {#if i < breadcrumb.length - 1}
              <button class="link crumb" onclick={() => select(f.id)}>{f.name}</button>
            {:else}
              {f.name}
            {/if}
          {/each}
        {/if}
      </h1>
      <div class="row">
        {#if selectedFolder}
          <button class="link" onclick={renameFolder}>Renombrar</button>
          <button class="link" onclick={moveFolder}>Mover</button>
          <button class="link danger" onclick={deleteFolder}>Borrar carpeta</button>
        {/if}
      </div>
    </div>

    <div class="row actions">
      <button class="primary" onclick={newQuiz}>+ Nuevo cuestionario</button>
      <button onclick={doImport}>Importar…</button>
      <button onclick={doExportFolder}>{selected === null ? 'Exportar todos los cuestionarios…' : 'Exportar carpeta…'}</button>
      {#if notice}<span class="notice">{notice}</span>{/if}
    </div>

    {#if quizzes.length === 0}
      <p class="muted empty">No hay cuestionarios aquí.</p>
    {:else}
      <ul class="quizzes">
        {#each quizzes as q (q.id)}
          {@const s = stats[q.id]}
          <li class="card">
            <div class="info">
              <div class="name">{q.name}</div>
              <div class="muted meta">
                {langName(q.langA)} ↔ {langName(q.langB)} · {q.pairCount} palabra{q.pairCount === 1 ? '' : 's'}
                {#if s && s.sessions > 0}
                  · {s.sessions} sesión{s.sessions === 1 ? '' : 'es'} · mejor tiempo {formatDuration(s.bestMs ?? 0)}
                  · últimos errores en 1.ª vuelta: {s.lastFirstRoundErrors}
                {/if}
              </div>
            </div>
            <div class="row">
              <button class="primary" disabled={q.pairCount === 0} onclick={() => goto(`/quiz/${q.id}/play`)}>Practicar</button>
              <button onclick={() => goto(`/quiz/${q.id}/edit`)}>Editar</button>
              <button class="link" onclick={() => moveQuiz(q)}>Mover</button>
              <button class="link" onclick={() => doExportQuiz(q)}>Exportar</button>
              <button class="link danger" onclick={() => deleteQuiz(q)}>Borrar</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 260px 1fr;
    gap: 1rem;
    align-items: start;
  }
  aside {
    position: sticky;
    top: 4rem;
    max-height: calc(100vh - 5rem);
    overflow: auto;
    padding: 0.75rem;
  }
  .head {
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  .head h2 {
    margin: 0;
  }
  .toolbar {
    justify-content: space-between;
  }
  .toolbar h1 {
    margin: 0;
  }
  .sep {
    margin: 0 0.4rem;
  }
  .crumb {
    font-size: inherit;
    font-weight: inherit;
    padding: 0;
  }
  .actions {
    margin: 0.75rem 0 1rem;
  }
  .notice {
    color: var(--ok);
  }
  .quizzes {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .quizzes li {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.6rem;
    padding: 0.75rem 1rem;
  }
  .name {
    font-weight: 600;
    font-size: 1.05rem;
  }
  .meta {
    font-size: 0.88rem;
  }
  .danger {
    color: var(--bad);
  }
  .empty {
    padding: 2rem 0;
  }
  @media (max-width: 760px) {
    .layout {
      grid-template-columns: 1fr;
    }
    aside {
      position: static;
      max-height: none;
    }
  }
</style>
