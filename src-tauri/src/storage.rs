use std::{collections::HashSet, fs, path::{Path, PathBuf}};

use crate::secure_storage::{self, SecretKey};
use chrono::{DateTime, Local};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const SCHEMA_VERSION: i64 = 2;
const DEFAULT_DISPLAY_NAME: &str = "动漫记录";
const DEFAULT_THEME: &str = "obsidian";
const DEFAULT_AI_PROVIDER: &str = "OpenAI Compatible";
const DEFAULT_AI_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_AI_MODEL: &str = "gpt-4.1-mini";
const MAX_BACKUP_RECORDS: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderSettings {
  pub enabled: bool,
  pub provider: String,
  pub base_url: String,
  pub model: String,
  pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
  pub display_name: String,
  pub theme: String,
  pub ai: AiProviderSettings,
  pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeStorageEntry {
  pub id: String,
  pub title: String,
  pub season: String,
  pub episodes: i64,
  pub progress: i64,
  pub status: String,
  pub score: f64,
  pub tags: Vec<String>,
  pub summary: String,
  pub updated_at: String,
  pub created_at: Option<String>,
  pub original_title: Option<String>,
  pub notes: Option<String>,
  pub cover_url: Option<String>,
  pub duration_minutes: Option<i64>,
  pub start_date: Option<String>,
  pub end_date: Option<String>,
  pub premiere_date: Option<String>,
  pub is_finished: Option<bool>,
  pub cast: Option<Vec<String>>,
  pub cast_aliases: Option<Vec<String>>,
  pub last_watched_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchHistoryEntry {
  pub id: String,
  pub anime_id: String,
  pub anime_title: String,
  pub episode: i64,
  pub watched_at: String,
  pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeStorageSnapshot {
  pub entries: Vec<AnimeStorageEntry>,
  pub history: Vec<WatchHistoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPayload {
  pub schema_version: i64,
  pub source: String,
  pub created_at: String,
  pub entries: Vec<AnimeStorageEntry>,
  pub history: Vec<WatchHistoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
  pub name: String,
  pub size: i64,
  pub created_at: String,
}

pub fn ensure_database(database_path: &Path) -> Result<i64, String> {
  if let Some(parent) = database_path.parent() {
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
  }

  let connection = Connection::open(database_path).map_err(|error| error.to_string())?;

  connection
    .execute_batch(
      r#"
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ai_provider_settings (
        provider TEXT PRIMARY KEY,
        base_url TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        encrypted_api_key TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS optional_app_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0,
        secret_hint TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS anime (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        season TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'planned',
        total_episodes INTEGER NOT NULL DEFAULT 0,
        current_episode INTEGER NOT NULL DEFAULT 0,
        score REAL NOT NULL DEFAULT 0,
        summary TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS watch_history (
        id TEXT PRIMARY KEY,
        anime_id TEXT NOT NULL,
        episode INTEGER NOT NULL,
        watched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        note TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(anime_id) REFERENCES anime(id) ON DELETE CASCADE
      );
      "#,
    )
    .map_err(|error| error.to_string())?;

  ensure_anime_snapshot_schema(&connection)?;

  connection
    .execute(
      r#"
      INSERT INTO app_settings (key, value)
      VALUES ('schema_version', ?1)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
      "#,
      params![SCHEMA_VERSION.to_string()],
    )
    .map_err(|error| error.to_string())?;

  Ok(SCHEMA_VERSION)
}

fn table_has_column(connection: &Connection, table: &str, column: &str) -> Result<bool, String> {
  let mut statement = connection
    .prepare(&format!("PRAGMA table_info({table})"))
    .map_err(|error| error.to_string())?;
  let columns = statement
    .query_map([], |row| row.get::<_, String>(1))
    .map_err(|error| error.to_string())?;

  for item in columns {
    if item.map_err(|error| error.to_string())? == column {
      return Ok(true);
    }
  }

  Ok(false)
}

fn ensure_table_column(connection: &Connection, table: &str, column: &str, definition: &str) -> Result<(), String> {
  if table_has_column(connection, table, column)? {
    return Ok(());
  }

  connection
    .execute(&format!("ALTER TABLE {table} ADD COLUMN {definition}"), [])
    .map_err(|error| error.to_string())?;

  Ok(())
}

fn ensure_anime_snapshot_schema(connection: &Connection) -> Result<(), String> {
  ensure_table_column(connection, "anime", "original_title", "original_title TEXT")?;
  ensure_table_column(connection, "anime", "notes", "notes TEXT")?;
  ensure_table_column(connection, "anime", "cover_url", "cover_url TEXT")?;
  ensure_table_column(connection, "anime", "duration_minutes", "duration_minutes INTEGER")?;
  ensure_table_column(connection, "anime", "start_date", "start_date TEXT")?;
  ensure_table_column(connection, "anime", "end_date", "end_date TEXT")?;
  ensure_table_column(connection, "anime", "premiere_date", "premiere_date TEXT")?;
  ensure_table_column(connection, "anime", "is_finished", "is_finished INTEGER")?;
  ensure_table_column(connection, "anime", "cast_json", "cast_json TEXT")?;
  ensure_table_column(connection, "anime", "cast_aliases_json", "cast_aliases_json TEXT")?;
  ensure_table_column(connection, "anime", "last_watched_at", "last_watched_at TEXT")?;
  Ok(())
}

fn open_database(database_path: &Path) -> Result<Connection, String> {
  ensure_database(database_path)?;
  let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
  connection
    .execute_batch(
      r#"
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      "#,
    )
    .map_err(|error| error.to_string())?;
  Ok(connection)
}

fn resolve_backup_directory(database_path: &Path) -> Result<PathBuf, String> {
  let parent = database_path
    .parent()
    .ok_or_else(|| "无法确定备份目录".to_string())?;
  let directory = parent.join("backups");
  fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
  Ok(directory)
}

fn create_backup_name(created_at: &str) -> String {
  if let Ok(parsed) = DateTime::parse_from_rfc3339(created_at) {
    let local_time = parsed.with_timezone(&Local);
    return format!(
      "animetrack-backup-{}.json",
      local_time.format("%Y-%m-%d_%H-%M-%S")
    );
  }

  let mut sanitized = created_at.replace(':', "-").replace('T', "_");

  if let Some(prefix) = sanitized.strip_suffix('Z') {
    sanitized = prefix.to_string();
    if let Some(dot_index) = sanitized.rfind('.') {
      sanitized.truncate(dot_index);
    }
    sanitized.push('Z');
  }

  format!("animetrack-backup-{sanitized}.json")
}

fn sanitize_backup_file_name(name: &str) -> Result<String, String> {
  if name.contains('/') || name.contains('\\') || name.contains("..") {
    return Err("备份文件名无效".to_string());
  }

  let trimmed = name.trim();
  if trimmed.is_empty() {
    return Err("备份文件名无效".to_string());
  }

  Ok(trimmed.to_string())
}

fn clear_legacy_ai_api_key(connection: &Connection) -> Result<(), String> {
  connection
    .execute(
      "UPDATE ai_provider_settings SET encrypted_api_key = '' WHERE encrypted_api_key <> ''",
      [],
    )
    .map_err(|error| error.to_string())?;

  Ok(())
}

fn resolve_ai_api_key(connection: &Connection, legacy_value: Option<String>) -> Result<String, String> {
  let legacy_api_key = legacy_value
    .as_deref()
    .map(normalize_optional_text)
    .unwrap_or_default();

  let secure_api_key = secure_storage::load_secret_value(SecretKey::AiApiKey)?;

  match secure_api_key {
    Some(value) => {
      if !legacy_api_key.is_empty() {
        clear_legacy_ai_api_key(connection)?;
      }

      Ok(value)
    }
    None if !legacy_api_key.is_empty() => {
      secure_storage::save_secret_value(SecretKey::AiApiKey, &legacy_api_key)?;
      clear_legacy_ai_api_key(connection)?;
      Ok(legacy_api_key)
    }
    None => Ok(String::new()),
  }
}

fn parse_backup_payload_text(raw_text: &str) -> Result<BackupPayload, String> {
  serde_json::from_str::<BackupPayload>(raw_text).map_err(|error| error.to_string())
}

fn read_backup_payload(database_path: &Path, name: &str) -> Result<(BackupPayload, i64), String> {
  let directory = resolve_backup_directory(database_path)?;
  let safe_name = sanitize_backup_file_name(name)?;
  let path = directory.join(&safe_name);
  let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
  let payload = parse_backup_payload_text(&content)?;
  let size = fs::metadata(&path)
    .map_err(|error| error.to_string())?
    .len()
    .try_into()
    .map_err(|_| "备份文件过大".to_string())?;

  Ok((payload, size))
}

fn prune_backup_files(directory: &Path) -> Result<(), String> {
  let mut backups = fs::read_dir(directory)
    .map_err(|error| error.to_string())?
    .filter_map(|entry| entry.ok())
    .filter_map(|entry| {
      let path = entry.path();
      let content = fs::read_to_string(&path).ok()?;
      let payload = parse_backup_payload_text(&content).ok()?;
      Some((payload.created_at, path))
    })
    .collect::<Vec<_>>();

  backups.sort_by(|left, right| right.0.cmp(&left.0));

  for (_, path) in backups.into_iter().skip(MAX_BACKUP_RECORDS) {
    fs::remove_file(path).map_err(|error| error.to_string())?;
  }

  Ok(())
}

fn parse_json_string_array(value: Option<String>) -> Vec<String> {
  value
    .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
    .unwrap_or_default()
    .into_iter()
    .map(|item| item.trim().to_string())
    .filter(|item| !item.is_empty())
    .collect()
}

fn normalize_optional_db_text(value: Option<String>) -> Option<String> {
  value.and_then(|item| {
    let trimmed = item.trim().to_string();
    if trimmed.is_empty() {
      None
    } else {
      Some(trimmed)
    }
  })
}

fn read_app_setting(connection: &Connection, key: &str) -> Result<Option<(String, String)>, String> {
  connection
    .query_row(
      "SELECT value, updated_at FROM app_settings WHERE key = ?1",
      params![key],
      |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn pick_latest_timestamp(values: &[Option<String>]) -> Option<String> {
  values.iter().flatten().max().cloned()
}

fn normalize_required_text(value: &str, fallback: &str) -> String {
  let trimmed = value.trim();
  if trimmed.is_empty() {
    fallback.to_string()
  } else {
    trimmed.to_string()
  }
}

fn normalize_optional_text(value: &str) -> String {
  value.trim().to_string()
}

fn serialize_json_string_array(values: &[String]) -> Result<String, String> {
  serde_json::to_string(values).map_err(|error| error.to_string())
}

fn upsert_anime_entry(connection: &Connection, entry: &AnimeStorageEntry) -> Result<(), String> {
  let tags_json = serialize_json_string_array(&entry.tags)?;
  let cast_json = entry
    .cast
    .as_ref()
    .filter(|values| !values.is_empty())
    .map(|values| serialize_json_string_array(values))
    .transpose()?;
  let cast_aliases_json = entry
    .cast_aliases
    .as_ref()
    .filter(|values| !values.is_empty())
    .map(|values| serialize_json_string_array(values))
    .transpose()?;
  let created_at = entry.created_at.as_deref().unwrap_or(entry.updated_at.as_str());
  let is_finished = entry.is_finished.map(|value| if value { 1 } else { 0 });

  connection
    .execute(
      r#"
      INSERT INTO anime (
        id,
        title,
        season,
        status,
        total_episodes,
        current_episode,
        score,
        summary,
        tags_json,
        created_at,
        updated_at,
        original_title,
        notes,
        cover_url,
        duration_minutes,
        start_date,
        end_date,
        premiere_date,
        is_finished,
        cast_json,
        cast_aliases_json,
        last_watched_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        season = excluded.season,
        status = excluded.status,
        total_episodes = excluded.total_episodes,
        current_episode = excluded.current_episode,
        score = excluded.score,
        summary = excluded.summary,
        tags_json = excluded.tags_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        original_title = excluded.original_title,
        notes = excluded.notes,
        cover_url = excluded.cover_url,
        duration_minutes = excluded.duration_minutes,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        premiere_date = excluded.premiere_date,
        is_finished = excluded.is_finished,
        cast_json = excluded.cast_json,
        cast_aliases_json = excluded.cast_aliases_json,
        last_watched_at = excluded.last_watched_at
      "#,
      params![
        entry.id,
        entry.title,
        entry.season,
        entry.status,
        entry.episodes,
        entry.progress,
        entry.score,
        entry.summary,
        tags_json,
        created_at,
        entry.updated_at,
        entry.original_title.as_deref(),
        entry.notes.as_deref(),
        entry.cover_url.as_deref(),
        entry.duration_minutes,
        entry.start_date.as_deref(),
        entry.end_date.as_deref(),
        entry.premiere_date.as_deref(),
        is_finished,
        cast_json,
        cast_aliases_json,
        entry.last_watched_at.as_deref(),
      ],
    )
    .map_err(|error| error.to_string())?;

  Ok(())
}

fn upsert_watch_history_entry(connection: &Connection, record: &WatchHistoryEntry) -> Result<(), String> {
  connection
    .execute(
      r#"
      INSERT INTO watch_history (id, anime_id, episode, watched_at, note)
      VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(id) DO UPDATE SET
        anime_id = excluded.anime_id,
        episode = excluded.episode,
        watched_at = excluded.watched_at,
        note = excluded.note
      "#,
      params![record.id, record.anime_id, record.episode, record.watched_at, record.note],
    )
    .map_err(|error| error.to_string())?;

  Ok(())
}

pub fn load_settings(database_path: &Path) -> Result<AppSettings, String> {
  let connection = open_database(database_path)?;
  let display_name = read_app_setting(&connection, "display_name")?;
  let theme = read_app_setting(&connection, "theme")?;

  let ai = connection
    .query_row(
      "SELECT provider, base_url, model, encrypted_api_key, enabled, updated_at FROM ai_provider_settings ORDER BY updated_at DESC LIMIT 1",
      [],
      |row| {
        Ok((
          row.get::<_, String>(0)?,
          row.get::<_, String>(1)?,
          row.get::<_, String>(2)?,
          row.get::<_, String>(3)?,
          row.get::<_, i64>(4)? != 0,
          row.get::<_, String>(5)?,
        ))
      },
    )
    .optional()
    .map_err(|error| error.to_string())?;

  let resolved_ai_api_key = resolve_ai_api_key(
    &connection,
    ai.as_ref().map(|(_, _, _, api_key, _, _)| api_key.clone()),
  )?;

  Ok(AppSettings {
    display_name: display_name
      .as_ref()
      .map(|(value, _)| normalize_required_text(value, DEFAULT_DISPLAY_NAME))
      .unwrap_or_else(|| DEFAULT_DISPLAY_NAME.to_string()),
    theme: theme
      .as_ref()
      .map(|(value, _)| normalize_required_text(value, DEFAULT_THEME))
      .unwrap_or_else(|| DEFAULT_THEME.to_string()),
    ai: AiProviderSettings {
      enabled: ai.as_ref().map(|(_, _, _, _, enabled, _)| *enabled).unwrap_or(false),
      provider: ai
        .as_ref()
        .map(|(provider, _, _, _, _, _)| normalize_required_text(provider, DEFAULT_AI_PROVIDER))
        .unwrap_or_else(|| DEFAULT_AI_PROVIDER.to_string()),
      base_url: ai
        .as_ref()
        .map(|(_, base_url, _, _, _, _)| normalize_required_text(base_url, DEFAULT_AI_BASE_URL))
        .unwrap_or_else(|| DEFAULT_AI_BASE_URL.to_string()),
      model: ai
        .as_ref()
        .map(|(_, _, model, _, _, _)| normalize_required_text(model, DEFAULT_AI_MODEL))
        .unwrap_or_else(|| DEFAULT_AI_MODEL.to_string()),
      api_key: resolved_ai_api_key,
    },
    updated_at: pick_latest_timestamp(&[
      display_name.as_ref().map(|(_, updated_at)| updated_at.clone()),
      theme.as_ref().map(|(_, updated_at)| updated_at.clone()),
      ai.as_ref().map(|(_, _, _, _, _, updated_at)| updated_at.clone()),
    ]),
  })
}

pub fn save_settings(database_path: &Path, settings: AppSettings) -> Result<AppSettings, String> {
  let mut connection = open_database(database_path)?;
  let transaction = connection.transaction().map_err(|error| error.to_string())?;

  let display_name = normalize_required_text(&settings.display_name, DEFAULT_DISPLAY_NAME);
  let theme = normalize_required_text(&settings.theme, DEFAULT_THEME);
  let ai_provider = normalize_required_text(&settings.ai.provider, DEFAULT_AI_PROVIDER);
  let ai_base_url = normalize_required_text(&settings.ai.base_url, DEFAULT_AI_BASE_URL);
  let ai_model = normalize_required_text(&settings.ai.model, DEFAULT_AI_MODEL);
  let ai_api_key = normalize_optional_text(&settings.ai.api_key);

  if ai_api_key.is_empty() {
    secure_storage::delete_secret_value(SecretKey::AiApiKey)?;
  } else {
    secure_storage::save_secret_value(SecretKey::AiApiKey, &ai_api_key)?;
  }

  transaction
    .execute(
      r#"
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
      "#,
      params!["display_name", display_name],
    )
    .map_err(|error| error.to_string())?;

  transaction
    .execute(
      r#"
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
      "#,
      params!["theme", theme],
    )
    .map_err(|error| error.to_string())?;

  transaction
    .execute("DELETE FROM ai_provider_settings", [])
    .map_err(|error| error.to_string())?;

  transaction
    .execute(
      r#"
      INSERT INTO ai_provider_settings (provider, base_url, model, encrypted_api_key, enabled, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      "#,
      params![
        ai_provider,
        ai_base_url,
        ai_model,
        "",
        if settings.ai.enabled { 1 } else { 0 },
      ],
    )
    .map_err(|error| error.to_string())?;

  transaction.commit().map_err(|error| error.to_string())?;
  load_settings(database_path)
}

pub fn load_anime_snapshot(database_path: &Path) -> Result<AnimeStorageSnapshot, String> {
  let connection = open_database(database_path)?;
  let mut anime_statement = connection
    .prepare(
      r#"
      SELECT
        id,
        title,
        season,
        status,
        total_episodes,
        current_episode,
        score,
        summary,
        tags_json,
        created_at,
        updated_at,
        original_title,
        notes,
        cover_url,
        duration_minutes,
        start_date,
        end_date,
        premiere_date,
        is_finished,
        cast_json,
        cast_aliases_json,
        last_watched_at
      FROM anime
      ORDER BY datetime(updated_at) DESC, title COLLATE NOCASE ASC
      "#,
    )
    .map_err(|error| error.to_string())?;

  let anime_rows = anime_statement
    .query_map([], |row| {
      let cast = parse_json_string_array(row.get::<_, Option<String>>(19)?);
      let cast_aliases = parse_json_string_array(row.get::<_, Option<String>>(20)?);

      Ok(AnimeStorageEntry {
        id: row.get(0)?,
        title: row.get(1)?,
        season: row.get(2)?,
        status: row.get(3)?,
        episodes: row.get(4)?,
        progress: row.get(5)?,
        score: row.get(6)?,
        summary: row.get(7)?,
        tags: parse_json_string_array(row.get::<_, Option<String>>(8)?),
        created_at: normalize_optional_db_text(row.get::<_, Option<String>>(9)?),
        updated_at: row.get(10)?,
        original_title: normalize_optional_db_text(row.get::<_, Option<String>>(11)?),
        notes: normalize_optional_db_text(row.get::<_, Option<String>>(12)?),
        cover_url: normalize_optional_db_text(row.get::<_, Option<String>>(13)?),
        duration_minutes: row.get::<_, Option<i64>>(14)?,
        start_date: normalize_optional_db_text(row.get::<_, Option<String>>(15)?),
        end_date: normalize_optional_db_text(row.get::<_, Option<String>>(16)?),
        premiere_date: normalize_optional_db_text(row.get::<_, Option<String>>(17)?),
        is_finished: row.get::<_, Option<i64>>(18)?.map(|value| value != 0),
        cast: if cast.is_empty() { None } else { Some(cast) },
        cast_aliases: if cast_aliases.is_empty() { None } else { Some(cast_aliases) },
        last_watched_at: normalize_optional_db_text(row.get::<_, Option<String>>(21)?),
      })
    })
    .map_err(|error| error.to_string())?;

  let entries = anime_rows
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| error.to_string())?;

  let mut history_statement = connection
    .prepare(
      r#"
      SELECT
        watch_history.id,
        watch_history.anime_id,
        COALESCE(anime.title, '未命名番剧') AS anime_title,
        watch_history.episode,
        watch_history.watched_at,
        watch_history.note
      FROM watch_history
      LEFT JOIN anime ON anime.id = watch_history.anime_id
      ORDER BY datetime(watch_history.watched_at) DESC, watch_history.id DESC
      "#,
    )
    .map_err(|error| error.to_string())?;

  let history_rows = history_statement
    .query_map([], |row| {
      Ok(WatchHistoryEntry {
        id: row.get(0)?,
        anime_id: row.get(1)?,
        anime_title: row.get(2)?,
        episode: row.get(3)?,
        watched_at: row.get(4)?,
        note: row.get(5)?,
      })
    })
    .map_err(|error| error.to_string())?;

  let history = history_rows
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| error.to_string())?;

  Ok(AnimeStorageSnapshot { entries, history })
}

pub fn save_anime_snapshot(
  database_path: &Path,
  snapshot: AnimeStorageSnapshot,
) -> Result<AnimeStorageSnapshot, String> {
  let mut connection = open_database(database_path)?;
  let transaction = connection.transaction().map_err(|error| error.to_string())?;

  transaction
    .execute("DELETE FROM watch_history", [])
    .map_err(|error| error.to_string())?;
  transaction
    .execute("DELETE FROM anime", [])
    .map_err(|error| error.to_string())?;

  let mut anime_ids = HashSet::new();
  for entry in &snapshot.entries {
    upsert_anime_entry(&transaction, entry)?;
    anime_ids.insert(entry.id.clone());
  }

  for record in &snapshot.history {
    if !anime_ids.contains(&record.anime_id) {
      continue;
    }

    upsert_watch_history_entry(&transaction, record)?;
  }

  transaction.commit().map_err(|error| error.to_string())?;
  load_anime_snapshot(database_path)
}

pub fn upsert_anime_entry_record(
  database_path: &Path,
  entry: AnimeStorageEntry,
) -> Result<AnimeStorageEntry, String> {
  let mut connection = open_database(database_path)?;
  let transaction = connection.transaction().map_err(|error| error.to_string())?;

  upsert_anime_entry(&transaction, &entry)?;

  transaction.commit().map_err(|error| error.to_string())?;
  Ok(entry)
}

pub fn save_watch_history_entry(
  database_path: &Path,
  record: WatchHistoryEntry,
) -> Result<WatchHistoryEntry, String> {
  let mut connection = open_database(database_path)?;
  let transaction = connection.transaction().map_err(|error| error.to_string())?;

  upsert_watch_history_entry(&transaction, &record)?;

  transaction.commit().map_err(|error| error.to_string())?;
  Ok(record)
}

pub fn delete_anime_entries(database_path: &Path, ids: Vec<String>) -> Result<usize, String> {
  let mut connection = open_database(database_path)?;
  let transaction = connection.transaction().map_err(|error| error.to_string())?;
  let mut deleted = 0;

  for id in ids.into_iter().map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) {
    deleted += transaction
      .execute("DELETE FROM anime WHERE id = ?1", params![id])
      .map_err(|error| error.to_string())?;
  }

  transaction.commit().map_err(|error| error.to_string())?;
  Ok(deleted)
}

pub fn delete_watch_history_entries(database_path: &Path, ids: Vec<String>) -> Result<usize, String> {
  let mut connection = open_database(database_path)?;
  let transaction = connection.transaction().map_err(|error| error.to_string())?;
  let mut deleted = 0;

  for id in ids.into_iter().map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) {
    deleted += transaction
      .execute("DELETE FROM watch_history WHERE id = ?1", params![id])
      .map_err(|error| error.to_string())?;
  }

  transaction.commit().map_err(|error| error.to_string())?;
  Ok(deleted)
}

pub fn list_backups(database_path: &Path) -> Result<Vec<BackupFile>, String> {
  let directory = resolve_backup_directory(database_path)?;
  let mut backups = fs::read_dir(&directory)
    .map_err(|error| error.to_string())?
    .filter_map(|entry| entry.ok())
    .filter_map(|entry| {
      let path = entry.path();
      let name = path.file_name()?.to_str()?.to_string();
      let content = fs::read_to_string(&path).ok()?;
      let payload = parse_backup_payload_text(&content).ok()?;
      let size = entry.metadata().ok()?.len().try_into().ok()?;

      Some(BackupFile {
        name,
        size,
        created_at: payload.created_at,
      })
    })
    .collect::<Vec<_>>();

  backups.sort_by(|left, right| right.created_at.cmp(&left.created_at));
  Ok(backups)
}

pub fn save_backup(
  database_path: &Path,
  payload: BackupPayload,
) -> Result<BackupFile, String> {
  let directory = resolve_backup_directory(database_path)?;
  let name = create_backup_name(&payload.created_at);
  let path = directory.join(&name);
  let content = serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?;

  fs::write(&path, content).map_err(|error| error.to_string())?;
  prune_backup_files(&directory)?;

  let size = fs::metadata(&path)
    .map_err(|error| error.to_string())?
    .len()
    .try_into()
    .map_err(|_| "备份文件过大".to_string())?;

  Ok(BackupFile {
    name,
    size,
    created_at: payload.created_at,
  })
}

pub fn read_backup(database_path: &Path, name: &str) -> Result<BackupPayload, String> {
  let (payload, _) = read_backup_payload(database_path, name)?;
  Ok(payload)
}

pub fn delete_backup(database_path: &Path, name: &str) -> Result<(), String> {
  let directory = resolve_backup_directory(database_path)?;
  let safe_name = sanitize_backup_file_name(name)?;
  let path = directory.join(safe_name);

  if path.exists() {
    fs::remove_file(path).map_err(|error| error.to_string())?;
  }

  Ok(())
}