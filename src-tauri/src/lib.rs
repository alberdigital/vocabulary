use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

const DB_URL: &str = "sqlite:vocab.db";

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "esquema inicial",
            kind: MigrationKind::Up,
            sql: r#"
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  prefs TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE folders (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INTEGER NULL REFERENCES folders(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TABLE quizzes (
  id INTEGER PRIMARY KEY,
  folder_id INTEGER NULL REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lang_a TEXT NOT NULL,
  lang_b TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE pairs (
  id INTEGER PRIMARY KEY,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  a TEXT NOT NULL,
  b TEXT NOT NULL
);
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiz_id INTEGER NULL REFERENCES quizzes(id) ON DELETE SET NULL,
  quiz_name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('AB','BA')),
  answer_mode TEXT NOT NULL CHECK (answer_mode IN ('typed','self')),
  input_mode TEXT NULL CHECK (input_mode IN ('keyboard','handwriting')),
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  pair_count INTEGER NOT NULL,
  rounds INTEGER NOT NULL,
  first_round_errors INTEGER NOT NULL,
  total_errors INTEGER NOT NULL
);
CREATE TABLE answers (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  pair_id INTEGER NULL REFERENCES pairs(id) ON DELETE SET NULL,
  round INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  expected TEXT NOT NULL,
  given TEXT NULL,
  correct INTEGER NOT NULL,
  overridden INTEGER NOT NULL DEFAULT 0,
  elapsed_ms INTEGER NOT NULL
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX idx_folders_parent ON folders(parent_id);
CREATE INDEX idx_quizzes_folder ON quizzes(folder_id);
CREATE INDEX idx_pairs_quiz ON pairs(quiz_id, position);
CREATE INDEX idx_sessions_user ON sessions(user_id, finished_at);
CREATE INDEX idx_answers_session ON answers(session_id);
"#,
        },
        Migration {
            version: 2,
            description: "cajas de Leitner",
            kind: MigrationKind::Up,
            sql: r#"
CREATE TABLE leitner_boxes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  first_capacity INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('AB','BA')),
  answer_mode TEXT NOT NULL CHECK (answer_mode IN ('typed','self')),
  input_mode TEXT NOT NULL CHECK (input_mode IN ('keyboard','handwriting')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE leitner_box_quizzes (
  box_id INTEGER NOT NULL REFERENCES leitner_boxes(id) ON DELETE CASCADE,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  PRIMARY KEY (box_id, quiz_id)
);
CREATE TABLE leitner_excluded_pairs (
  box_id INTEGER NOT NULL REFERENCES leitner_boxes(id) ON DELETE CASCADE,
  pair_id INTEGER NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  PRIMARY KEY (box_id, pair_id)
);
-- compartment: 0 = pendiente, 1-5 = compartimentos, 6 = aprendida
CREATE TABLE leitner_cards (
  box_id INTEGER NOT NULL REFERENCES leitner_boxes(id) ON DELETE CASCADE,
  pair_id INTEGER NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  compartment INTEGER NOT NULL CHECK (compartment BETWEEN 0 AND 6),
  moved_at TEXT NOT NULL,
  PRIMARY KEY (box_id, pair_id)
);
CREATE TABLE leitner_sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  box_id INTEGER NULL REFERENCES leitner_boxes(id) ON DELETE SET NULL,
  box_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  errors INTEGER NOT NULL,
  abandoned INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_leitner_boxes_user ON leitner_boxes(user_id);
CREATE INDEX idx_leitner_box_quizzes_quiz ON leitner_box_quizzes(quiz_id);
CREATE INDEX idx_leitner_excluded_pair ON leitner_excluded_pairs(pair_id);
CREATE INDEX idx_leitner_cards_pair ON leitner_cards(pair_id);
CREATE INDEX idx_leitner_cards_box ON leitner_cards(box_id, compartment);
CREATE INDEX idx_leitner_sessions_user ON leitner_sessions(user_id, finished_at);
"#,
        },
        Migration {
            version: 3,
            description: "antigüedad explícita en las cajas de Leitner",
            kind: MigrationKind::Up,
            sql: r#"
-- seq: antigüedad dentro de la caja (menor = más antigua); sustituye a moved_at.
ALTER TABLE leitner_cards ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;
UPDATE leitner_cards SET seq = (
  SELECT COUNT(*) FROM leitner_cards c
  WHERE c.box_id = leitner_cards.box_id
    AND (c.moved_at < leitner_cards.moved_at OR (c.moved_at = leitner_cards.moved_at AND c.rowid <= leitner_cards.rowid))
);
ALTER TABLE leitner_cards DROP COLUMN moved_at;
DROP INDEX idx_leitner_cards_box;
CREATE INDEX idx_leitner_cards_box ON leitner_cards(box_id, compartment, seq);
-- Las prácticas de una caja no se abandonan: se guardan a cada respuesta.
ALTER TABLE leitner_sessions DROP COLUMN abandoned;
"#,
        },
    ]
}

/// Escribe un fichero de texto en la ruta que el usuario eligió en el diálogo de guardar.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Lee un fichero de texto que el usuario eligió en el diálogo de abrir.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Ruta del fichero de la base de datos, para mostrarla y hacer copias de seguridad.
#[tauri::command]
fn db_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("vocab.db").to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            write_text_file,
            read_text_file,
            db_path
        ])
        .run(tauri::generate_context!())
        .expect("error al arrancar la aplicación");
}
