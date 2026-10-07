import Database from '@tauri-apps/plugin-sql';

let dbPromise: Promise<Database> | null = null;

/** Conexión única a la base de datos de la aplicación (las migraciones se aplican al cargar). */
export function db(): Promise<Database> {
  dbPromise ??= Database.load('sqlite:vocab.db');
  return dbPromise;
}
