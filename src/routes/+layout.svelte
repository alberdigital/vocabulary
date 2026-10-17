<script lang="ts">
  import '../app.css';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { app } from '$lib/state.svelte';
  import { getSetting, getUser, listUsers } from '$lib/db/repo';
  import PromptHost from '$lib/components/PromptHost.svelte';

  let { children } = $props();
  let ready = $state(false);
  let loadError = $state<string | null>(null);

  onMount(async () => {
    try {
      // En `npm run dev` dentro de un navegador normal no hay Tauri: se simula (solo en desarrollo).
      if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)) {
        await (await import('$lib/db/devMock')).install();
      }
      // Si solo hay un usuario y es el último que se usó, se entra directamente.
      const last = await getSetting('last_user_id');
      const users = await listUsers();
      if (last && users.length === 1 && users[0].id === Number(last)) {
        app.user = await getUser(Number(last));
      }
    } catch (e) {
      loadError = String(e);
    }
    ready = true;
  });

  // Sin usuario elegido solo se puede estar en la pantalla de usuarios.
  $effect(() => {
    if (ready && !app.user && page.url.pathname !== '/') goto('/');
  });

  const inSession = $derived(page.url.pathname.endsWith('/play'));
</script>

{#if loadError}
  <main class="center">
    <div class="card">
      <h1>No se pudo abrir la base de datos</h1>
      <pre class="error">{loadError}</pre>
    </div>
  </main>
{:else if ready}
  {#if app.user && !inSession}
    <header>
      <nav>
        <a href="/library" class:active={page.url.pathname.startsWith('/library') || page.url.pathname.startsWith('/quiz/')}
          >Cuestionarios</a
        >
        <a href="/leitner" class:active={page.url.pathname.startsWith('/leitner')}>Cajas de Leitner</a>
        <a href="/history" class:active={page.url.pathname.startsWith('/history') || page.url.pathname.startsWith('/results')}
          >Historial</a
        >
      </nav>
      <a class="user" href="/" title="Cambiar de usuario">👤 {app.user.name}</a>
    </header>
  {/if}
  <main class:full={inSession}>
    {@render children()}
  </main>
{/if}
<PromptHost />

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  nav {
    display: flex;
    gap: 0.25rem;
  }
  nav a,
  .user {
    text-decoration: none;
    color: var(--text);
    padding: 0.35rem 0.75rem;
    border-radius: 6px;
  }
  nav a:hover,
  .user:hover {
    background: var(--surface-2);
  }
  nav a.active {
    background: var(--surface-2);
    font-weight: 600;
  }
  main {
    padding: 1rem;
    max-width: 1200px;
    margin: 0 auto;
  }
  main.full {
    max-width: none;
    padding: 0;
    height: 100vh;
  }
  .center {
    display: grid;
    place-items: center;
    min-height: 100vh;
  }
</style>
