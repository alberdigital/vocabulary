<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { app } from '$lib/state.svelte';
  import { createUser, dbPath, deleteUser, listUsers, renameUser, setSetting } from '$lib/db/repo';
  import type { User } from '$lib/db/types';
  import { confirmDanger, prompt, showError } from '$lib/dialogs.svelte';

  let users = $state<User[]>([]);
  let newName = $state('');
  let path = $state('');

  async function load() {
    users = await listUsers();
  }

  onMount(async () => {
    await load();
    dbPath().then((p) => (path = p)).catch(() => {});
  });

  async function choose(u: User) {
    app.user = u;
    await setSetting('last_user_id', String(u.id));
    goto('/library');
  }

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (users.some((u) => u.name.toLowerCase() === name.toLowerCase())) {
      return showError(`Ya existe un usuario llamado «${name}»`);
    }
    try {
      await createUser(name);
      newName = '';
      await load();
    } catch (err) {
      showError(err);
    }
  }

  async function rename(u: User) {
    const name = await prompt('Renombrar usuario', { value: u.name, okLabel: 'Renombrar' });
    if (!name || name === u.name) return;
    try {
      await renameUser(u.id, name);
      if (app.user?.id === u.id) app.user = { ...app.user, name };
      await load();
    } catch (err) {
      showError(`No se pudo renombrar (¿ya existe ese nombre?): ${err}`);
    }
  }

  async function remove(u: User) {
    if (!(await confirmDanger(`¿Borrar a «${u.name}» y todo su historial de resultados? Los cuestionarios no se borran.`)))
      return;
    await deleteUser(u.id);
    if (app.user?.id === u.id) app.user = null;
    await load();
  }
</script>

<div class="wrap">
  <h1>¿Quién va a practicar?</h1>

  {#if users.length > 0}
    <ul class="users">
      {#each users as u (u.id)}
        <li class:current={app.user?.id === u.id}>
          <button class="pick" onclick={() => choose(u)}>
            <span class="avatar">{u.name.slice(0, 1).toUpperCase()}</span>
            {u.name}
          </button>
          <button class="link" onclick={() => rename(u)}>Renombrar</button>
          <button class="link danger" onclick={() => remove(u)}>Borrar</button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">Todavía no hay usuarios. Crea el primero:</p>
  {/if}

  <form class="row" onsubmit={add}>
    <input placeholder="Nombre del nuevo usuario" bind:value={newName} maxlength="40" />
    <button class="primary" type="submit" disabled={!newName.trim()}>Crear usuario</button>
  </form>

  {#if path}
    <p class="muted small">
      Los datos se guardan en <code>{path}</code>. Copia ese fichero para hacer una copia de seguridad completa.
    </p>
  {/if}
</div>

<style>
  .wrap {
    max-width: 520px;
    margin: 3rem auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .users {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .users li {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .pick {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    text-align: left;
    padding: 0.6rem 0.8rem;
    font-size: 1.05rem;
  }
  .current .pick {
    border-color: var(--accent);
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-contrast);
    font-weight: 600;
  }
  form input {
    flex: 1;
  }
  .small {
    font-size: 0.85rem;
    word-break: break-all;
  }
  .danger {
    color: var(--bad);
  }
</style>
