<script lang="ts">
  import type { Folder } from '$lib/db/types';

  let {
    folders,
    selected,
    onselect,
  }: { folders: Folder[]; selected: number | null; onselect: (id: number | null) => void } = $props();

  // Carpetas plegadas (por defecto todas desplegadas).
  let collapsed = $state(new Set<number>());

  const childrenOf = (id: number | null) => folders.filter((f) => f.parentId === id);

  function toggle(id: number) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsed = next;
  }
</script>

{#snippet branch(parent: number | null, depth: number)}
  {#each childrenOf(parent) as f (f.id)}
    {@const kids = childrenOf(f.id)}
    <li>
      <div class="item" class:selected={selected === f.id} style:padding-left="{0.4 + depth * 1}rem">
        {#if kids.length > 0}
          <button class="twisty" onclick={() => toggle(f.id)} aria-label={collapsed.has(f.id) ? 'Desplegar' : 'Plegar'}>
            {collapsed.has(f.id) ? '▸' : '▾'}
          </button>
        {:else}
          <span class="twisty"></span>
        {/if}
        <button class="name" onclick={() => onselect(f.id)}>📁 {f.name}</button>
      </div>
      {#if kids.length > 0 && !collapsed.has(f.id)}
        <ul>{@render branch(f.id, depth + 1)}</ul>
      {/if}
    </li>
  {/each}
{/snippet}

<ul class="tree">
  <li>
    <div class="item" class:selected={selected === null} style:padding-left="0.4rem">
      <span class="twisty"></span>
      <button class="name" onclick={() => onselect(null)}>🗂️ Sin carpeta</button>
    </div>
  </li>
  {@render branch(null, 0)}
</ul>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .item {
    display: flex;
    align-items: center;
    border-radius: 6px;
  }
  .item:hover {
    background: var(--surface-2);
  }
  .item.selected {
    background: var(--surface-2);
    font-weight: 600;
  }
  .twisty {
    width: 1.4rem;
    flex: none;
    border: none;
    background: none;
    padding: 0;
    color: var(--muted);
  }
  .name {
    flex: 1;
    text-align: left;
    border: none;
    background: none;
    padding: 0.3rem 0.4rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item:hover .name,
  .twisty:hover {
    background: none;
  }
</style>
