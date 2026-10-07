<script lang="ts">
  import { promptState } from '$lib/dialogs.svelte';

  let dialog: HTMLDialogElement | undefined = $state();
  let value = $state('');
  const req = $derived(promptState.current);

  $effect(() => {
    if (!dialog) return;
    if (req) {
      value = req.value;
      dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!req) return;
    if (!req.options && value.trim() === '') return;
    req.resolve(req.options ? value : value.trim());
  }
</script>

<dialog bind:this={dialog} oncancel={(e) => { e.preventDefault(); req?.resolve(null); }}>
  {#if req}
    <form onsubmit={submit}>
      <h2>{req.title}</h2>
      {#if req.label}<label for="prompt-input" class="muted">{req.label}</label>{/if}
      {#if req.options}
        <select id="prompt-input" bind:value>
          {#each req.options as o (o.value)}
            <option value={o.value}>{o.label}</option>
          {/each}
        </select>
      {:else}
        <!-- svelte-ignore a11y_autofocus -->
        <input id="prompt-input" bind:value autofocus />
      {/if}
      <div class="row buttons">
        <button type="button" onclick={() => req.resolve(null)}>Cancelar</button>
        <button type="submit" class="primary">{req.okLabel}</button>
      </div>
    </form>
  {/if}
</dialog>

<style>
  dialog {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    min-width: 360px;
    padding: 1.25rem;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .buttons {
    justify-content: flex-end;
    margin-top: 0.5rem;
  }
</style>
