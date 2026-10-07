// SOLO PARA DESARROLLO: permite abrir la interfaz en un navegador normal (`npm run dev`) sin Tauri.
// Simula el plugin SQL con sql.js (SQLite en WebAssembly) usando las mismas migraciones de src-tauri/src/lib.rs,
// y guarda la base de datos en localStorage. No se incluye en la aplicación empaquetada.

import { mockIPC } from '@tauri-apps/api/mocks';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import libRs from '../../../src-tauri/src/lib.rs?raw';

const STORAGE_KEY = 'vocabulario-dev-db';

function migrationSql(): string {
  const m = libRs.match(/sql: r#"([\s\S]*?)"#/);
  if (!m) throw new Error('No se encontró la migración en lib.rs');
  return m[1];
}

function persist(db: Database) {
  try {
    const bytes = db.export();
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    localStorage.setItem(STORAGE_KEY, btoa(bin));
  } catch {
    // Sin localStorage los datos solo duran hasta recargar.
  }
}

function restore(): Uint8Array | null {
  try {
    const b64 = localStorage.getItem(STORAGE_KEY);
    if (!b64) return null;
    const bin = atob(b64);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function bind(values: unknown[]): Record<string, SqlValue> {
  return Object.fromEntries(values.map((v, i) => [`$${i + 1}`, (v === undefined ? null : v) as SqlValue]));
}

export async function install(): Promise<void> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = restore();
  const db = saved ? new SQL.Database(saved) : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  if (!saved) {
    db.exec(migrationSql());
    persist(db);
  }
  const files = new Map<string, string>();

  mockIPC((cmd, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case 'plugin:sql|load':
        return args.db;
      case 'plugin:sql|execute': {
        db.run(args.query as string, bind(args.values as unknown[]));
        const changes = db.getRowsModified();
        const lastId = db.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? 0;
        persist(db);
        return [changes, lastId];
      }
      case 'plugin:sql|select': {
        const stmt = db.prepare(args.query as string, bind(args.values as unknown[]));
        const rows: Record<string, unknown>[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      }
      case 'plugin:dialog|message': {
        // ask/confirm usan este mismo comando y comparan la etiqueta del botón pulsado.
        const b = args.buttons as { OkCancelCustom?: [string, string] } | string | undefined;
        if (typeof b === 'object' && b.OkCancelCustom) {
          const [ok, cancel] = b.OkCancelCustom;
          return window.confirm(String(args.message)) ? ok : cancel;
        }
        if (b === 'YesNo') return window.confirm(String(args.message)) ? 'Yes' : 'No';
        if (b === 'OkCancel') return window.confirm(String(args.message)) ? 'Ok' : 'Cancel';
        window.alert(String(args.message));
        return 'Ok';
      }
      case 'plugin:dialog|save': {
        const name = window.prompt('[dev] Nombre del fichero a guardar', 'export.json');
        return name ? `dev:${name}` : null;
      }
      case 'plugin:dialog|open': {
        const name = window.prompt(`[dev] Fichero a abrir (${[...files.keys()].join(', ') || 'ninguno'})`);
        return name ? `dev:${name}` : null;
      }
      case 'write_text_file':
        files.set(String(args.path).replace(/^dev:/, ''), String(args.contents));
        console.info('[dev] fichero guardado', args.path, args.contents);
        return null;
      case 'read_text_file': {
        const c = files.get(String(args.path).replace(/^dev:/, ''));
        if (c === undefined) throw new Error('No existe ese fichero (dev)');
        return c;
      }
      case 'db_path':
        return '(navegador de desarrollo: localStorage)';
      default:
        throw new Error(`[dev] Comando no simulado: ${cmd}`);
    }
  });
}
