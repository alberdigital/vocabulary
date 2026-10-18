<!--
  Dibujo de una caja de Leitner: compartimentos con N/M, más anchos cuanto más capacidad tienen.
  El ancho sigue la capacidad elevada a 0,7: proporcional, el 5.º sería 14 veces el 1.º y no
  cabrían los números; con una escala logarítmica o la raíz cuadrada parecerían casi iguales.
-->
<script lang="ts">
  import { capacities, LEARNED, PENDING } from '$lib/leitner/core';

  let {
    counts,
    firstCapacity,
    highlight = null,
  }: {
    /** [pendientes, c1…c5, aprendidas] */
    counts: number[];
    firstCapacity: number;
    /** Compartimento (1–5) a resaltar. */
    highlight?: number | null;
  } = $props();

  const caps = $derived(capacities(firstCapacity));
  /** Ancho relativo: con las proporciones 1:2:5:8:14 queda en 1 : 1,6 : 3,1 : 4,3 : 6,3. */
  const width = (cap: number) => cap ** 0.7;
</script>

<div class="leitner">
  <div class="side" title="Palabras que esperan a que haya sitio en el 1.er compartimento">
    <strong>{counts[PENDING]}</strong> pendiente{counts[PENDING] === 1 ? '' : 's'}
  </div>
  <div class="box">
    {#each caps as cap, i (i)}
      {@const n = counts[i + 1]}
      <div
        class="comp"
        class:full={n >= cap}
        class:hl={highlight === i + 1}
        style:flex-grow={width(cap)}
        title="Compartimento {i + 1}: {n} de {cap} palabras"
      >
        <div class="fill" style:height="{Math.min(100, (n / cap) * 100)}%"></div>
        <span class="num">{n}/{cap}</span>
      </div>
    {/each}
  </div>
  <div class="side learned" title="Palabras acertadas en el último compartimento">
    ✓ <strong>{counts[LEARNED]}</strong> aprendida{counts[LEARNED] === 1 ? '' : 's'}
  </div>
</div>

<style>
  .leitner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
  }
  .side {
    flex: none;
    font-size: 0.85rem;
    color: var(--muted);
    white-space: nowrap;
  }
  .learned {
    color: var(--ok);
  }
  .box {
    flex: 1;
    display: flex;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    background: var(--surface);
  }
  .comp {
    position: relative;
    flex-basis: 0;
    /* Sin mínimo fijo: el ancho sigue la capacidad mientras quepa el número. El relleno deja
       sitio al borde del resaltado (.hl) para que no toque el número. */
    padding: 0 calc(3px + 0.3rem);
    height: 2.2rem;
    display: grid;
    place-items: center;
    border-left: 1px solid var(--border);
  }
  .comp:first-child {
    border-left: none;
  }
  .fill {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    transition: height 0.25s;
  }
  .full .fill {
    background: color-mix(in srgb, var(--full) 30%, transparent);
  }
  .num {
    position: relative;
    font-size: 0.72rem;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .hl {
    outline: 3px solid var(--accent);
    outline-offset: -3px;
    font-weight: 700;
  }
</style>
