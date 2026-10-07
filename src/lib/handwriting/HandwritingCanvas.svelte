<script lang="ts">
  // Lienzo para escribir con ratón, pantalla táctil o tableta (el grosor depende de la presión del lápiz).

  interface Point {
    x: number;
    y: number;
    w: number;
  }

  let { disabled = false, onchange }: { disabled?: boolean; onchange?: (empty: boolean) => void } = $props();

  const BASE_WIDTH = 3.2;
  let canvas: HTMLCanvasElement | undefined = $state();
  let strokes: Point[][] = [];
  let current: Point[] | null = null;

  function widthFor(e: PointerEvent): number {
    // El ratón informa presión 0.5 al pulsar; el lápiz, la real.
    const p = e.pointerType === 'mouse' || e.pressure === 0 ? 0.5 : e.pressure;
    return BASE_WIDTH * (0.5 + p);
  }

  function point(e: PointerEvent): Point {
    const r = canvas!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: widthFor(e) };
  }

  function drawStroke(ctx: CanvasRenderingContext2D, s: Point[], dx = 0, dy = 0) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (s.length === 1) {
      ctx.beginPath();
      ctx.arc(s[0].x + dx, s[0].y + dy, s[0].w / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    for (let i = 1; i < s.length; i++) {
      ctx.lineWidth = (s[i - 1].w + s[i].w) / 2;
      ctx.beginPath();
      ctx.moveTo(s[i - 1].x + dx, s[i - 1].y + dy);
      ctx.lineTo(s[i].x + dx, s[i].y + dy);
      ctx.stroke();
    }
  }

  function redraw() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    // Línea de escritura como guía.
    ctx.strokeStyle = '#d8d4cc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(16, height * 0.72);
    ctx.lineTo(width - 16, height * 0.72);
    ctx.stroke();
    ctx.strokeStyle = '#111111';
    ctx.fillStyle = '#111111';
    for (const s of strokes) drawStroke(ctx, s);
    if (current) drawStroke(ctx, current);
  }

  function down(e: PointerEvent) {
    if (disabled || e.button > 0) return;
    e.preventDefault();
    canvas!.setPointerCapture(e.pointerId);
    current = [point(e)];
    redraw();
  }

  function move(e: PointerEvent) {
    if (!current) return;
    e.preventDefault();
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e]) current.push(point(ev));
    redraw();
  }

  function up() {
    if (!current) return;
    strokes.push(current);
    current = null;
    redraw();
    onchange?.(false);
  }

  export function clear() {
    strokes = [];
    current = null;
    redraw();
    onchange?.(true);
  }

  export function undo() {
    strokes.pop();
    redraw();
    onchange?.(strokes.length === 0);
  }

  export function isEmpty(): boolean {
    return strokes.length === 0;
  }

  /** Imagen recortada a lo escrito, negro sobre blanco, con margen. null si no hay nada escrito. */
  export function getImage(): ImageData | null {
    if (strokes.length === 0) return null;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const s of strokes)
      for (const p of s) {
        minX = Math.min(minX, p.x - p.w);
        minY = Math.min(minY, p.y - p.w);
        maxX = Math.max(maxX, p.x + p.w);
        maxY = Math.max(maxY, p.y + p.w);
      }
    const w = maxX - minX;
    const h = maxY - minY;
    const margin = Math.max(12, 0.1 * Math.max(w, h));
    const out = document.createElement('canvas');
    out.width = Math.ceil(w + 2 * margin);
    out.height = Math.ceil(h + 2 * margin);
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#000000';
    for (const s of strokes) drawStroke(ctx, s, margin - minX, margin - minY);
    return ctx.getImageData(0, 0, out.width, out.height);
  }

  $effect(() => {
    if (!canvas) return;
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  });
</script>

<canvas
  bind:this={canvas}
  class:disabled
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  aria-label="Zona para escribir a mano"
></canvas>

<style>
  canvas {
    width: 100%;
    height: 220px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    touch-action: none;
    cursor: crosshair;
    display: block;
  }
  canvas.disabled {
    cursor: default;
    opacity: 0.85;
  }
</style>
