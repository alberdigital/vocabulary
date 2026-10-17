# Vocabulario

Aplicación de escritorio para aprender vocabulario con cuestionarios de pares de palabras (Tauri 2 + Svelte 5 + SQLite).

- Pregunta las palabras en orden aleatorio y repite las falladas al final, en nuevas rondas, hasta acertarlas todas.
- Al terminar muestra el tiempo, los errores de la primera vuelta y los errores totales. El historial se guarda por usuario.
- Modos: sentido A→B o B→A; respuesta escrita (con teclado o a mano) o autoevaluación.
- Cuestionarios en carpetas anidadas, compartidos por todos los usuarios. Exportación e importación en JSON.
- Cajas de Leitner por usuario, con palabras elegidas de cualquier cuestionario (ver más abajo).
- Escritura a mano reconocida en local con [TrOCR-small-handwritten](https://huggingface.co/Xenova/trocr-small-handwritten) (incluido en la aplicación; no hace falta conexión).

## Reglas de corrección

- **Teclado:** la respuesta debe coincidir exactamente, tildes incluidas. Solo se tolera que la primera letra cambie de mayúscula a minúscula o al revés, y se ignoran los espacios sobrantes.
- **Aclaraciones:** lo que va entre paréntesis (`bank (of a river)`) se muestra al preguntar, pero no hace falta escribirlo.
- **A mano:** no se comprueban tildes ni la diferencia ñ/n. Si la IA lee mal una respuesta correcta, el botón «La IA se equivocó» (tecla <kbd>C</kbd>) la da por buena.
- **Autoevaluación:** <kbd>Espacio</kbd>/<kbd>Intro</kbd> muestran la respuesta y, después, la dan por buena; <kbd>N</kbd> la da por mala.

## Cajas de Leitner

- Cada caja tiene 5 compartimentos con capacidades en la proporción clásica 1:2:5:8:14 a partir de la del 1.º (por defecto 20 → 20/40/100/160/280).
- Se eligen carpetas, cuestionarios o palabras sueltas. Las palabras entran en el 1.º mientras quepan; el resto espera en «pendientes» y va entrando según hay sitio. Las palabras que se añadan después a un cuestionario marcado entran solas.
- No hay sesiones: tras cada respuesta se elige la siguiente palabra. Se revisan los compartimentos del 5.º al 2.º y, si alguno ha alcanzado su capacidad, se pregunta su palabra más antigua (así ninguno la supera). Si no hay ninguno lleno, se pregunta la más antigua del 1.º, esté lleno o no.
- Acierto: la palabra sube un compartimento (desde el 5.º queda como aprendida). Fallo: vuelve al 1.º como la más reciente, así que se vuelve a preguntar después de las demás del 1.º.
- Si el 1.º se queda vacío y ningún otro está lleno, no hay nada que preguntar hasta que se añadan palabras.
- Cada respuesta se guarda al momento, y el historial guarda un registro por práctica (desde «Practicar» hasta «Terminar»).
- Durante la práctica se puede quitar una palabra de la caja (sigue en su cuestionario) y ocultar de qué cuestionario es.
- Al exportar una caja se incluyen sus cuestionarios y el progreso; al importarla, los cuestionarios se crean en una carpeta nueva.

## Requisitos (Linux Mint / Ubuntu)

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

y Node.js 20 o superior.

## Uso

```bash
npm install          # también descarga el modelo de escritura a mano (~65 MB) a static/models
npm run tauri dev    # aplicación en modo desarrollo
npm run tauri build  # instaladores .deb y AppImage en src-tauri/target/release/bundle/
```

Los datos se guardan en `~/.config/com.asantos.vocabulario/vocab.db` (la ruta exacta aparece en la pantalla de usuarios). Para hacer una copia de seguridad completa basta con copiar ese fichero.

## Desarrollo

```bash
npm test             # tests unitarios (corrección, motor de rondas, cajas de Leitner, exportar/importar)
npm run check        # comprobación de tipos (svelte-check)
npm run dev          # solo la interfaz, en un navegador normal en http://localhost:1420
```

Con `npm run dev` en un navegador (sin Tauri) se activa un simulador **solo de desarrollo** (`src/lib/db/devMock.ts`). Usa SQLite en WebAssembly con las mismas migraciones de `src-tauri/src/lib.rs` y guarda los datos en `localStorage`. No se incluye en la aplicación empaquetada. Vite no vigila `src-tauri`: tras añadir una migración hay que reiniciar `npm run dev`.

Prueba manual del reconocimiento con imágenes (`<fuente>_<palabra>.png`):

```bash
HW_IMAGES=/ruta/a/imagenes npx vitest run tests-manual --silent=false --reporter=verbose
```

Los umbrales de aceptación (`MARGIN`, `MIN_SCORE`) están en `src/lib/handwriting/core.ts`. Durante una sesión a mano, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> muestra las puntuaciones para calibrarlos.

## Estructura

| Ruta | Contenido |
|---|---|
| `src/lib/quiz/` | Corrección de respuestas, motor de rondas, lista de idiomas |
| `src/lib/leitner/` | Reglas de las cajas de Leitner (capacidades, siguiente palabra, movimientos, relleno) |
| `src/lib/components/` | Sesión de práctica común, árbol de carpetas, selector de contenido y dibujo de las cajas |
| `src/lib/db/` | Acceso a SQLite (`repo.ts` concentra todo el SQL) |
| `src/lib/handwriting/` | Lienzo, Web Worker y lógica de reconocimiento |
| `src/routes/` | Pantallas: usuarios, cuestionarios, cajas de Leitner, editores, práctica, resultados, historial |
| `src-tauri/src/lib.rs` | Migraciones de la base de datos y comandos para leer y escribir ficheros de exportación |
