use std::{collections::HashMap, sync::OnceLock};

use keyring_core::{Entry, Error as KeyringError};
use serde::Serialize;

const DESKTOP_SECRET_SERVICE: &str = "com.zmqqqa.animetrack.desktop";
pub const DESKTOP_SECRET_STORAGE_MODE_OS_KEYCHAIN: &str = "os-keychain";
pub const DESKTOP_SECRET_STORAGE_MODE_ENCRYPTED_SQLITE: &str = "encrypted-sqlite";

static SECRET_STORE_MODE: OnceLock<Result<&'static str, String>> = OnceLock::new();

#[derive(Debug, Clone, Copy)]
pub enum DesktopSecretKey {
  AiApiKey,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSecretValue {
  pub value: Option<String>,
  pub storage_mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSecretOperationResult {
  pub storage_mode: String,
}

impl DesktopSecretKey {
  fn user(self) -> &'static str {
    match self {
      DesktopSecretKey::AiApiKey => "ai-provider-api-key",
    }
  }

  pub fn parse(value: &str) -> Result<Self, String> {
    match value.trim() {
      "ai-api-key" => Ok(DesktopSecretKey::AiApiKey),
      _ => Err("不支持的安全存储键。".to_string()),
    }
  }
}

fn normalize_secret_store_error(error: KeyringError) -> String {
  match error {
    KeyringError::BadEncoding(bytes) => {
      let preview = String::from_utf8_lossy(&bytes);
      format!("安全存储中的密钥数据编码无效：{preview}")
    }
    other => format!("访问系统安全存储失败：{other}"),
  }
}

fn ensure_desktop_secret_store() -> Result<&'static str, String> {
  let initialization = SECRET_STORE_MODE.get_or_init(|| {
    keyring::use_native_store(true)
      .map(|_| DESKTOP_SECRET_STORAGE_MODE_OS_KEYCHAIN)
      .or_else(|native_error| {
        let fallback_config = HashMap::new();
        keyring::use_sqlite_store(&fallback_config)
          .map(|_| DESKTOP_SECRET_STORAGE_MODE_ENCRYPTED_SQLITE)
          .map_err(|sqlite_error| {
            format!(
              "初始化安全存储失败：native={native_error}; sqlite={sqlite_error}"
            )
          })
      })
  });

  match initialization {
    Ok(mode) => Ok(*mode),
    Err(message) => Err(message.clone()),
  }
}

fn build_secret_entry(key: DesktopSecretKey) -> Result<(Entry, &'static str), String> {
  let storage_mode = ensure_desktop_secret_store()?;
  let entry = Entry::new(DESKTOP_SECRET_SERVICE, key.user()).map_err(normalize_secret_store_error)?;
  Ok((entry, storage_mode))
}

pub fn load_secret_value(key: DesktopSecretKey) -> Result<Option<String>, String> {
  let (entry, _storage_mode) = build_secret_entry(key)?;

  match entry.get_password() {
    Ok(value) => Ok(Some(value)),
    Err(KeyringError::NoEntry) => Ok(None),
    Err(error) => Err(normalize_secret_store_error(error)),
  }
}

pub fn save_secret_value(
  key: DesktopSecretKey,
  value: &str,
) -> Result<DesktopSecretOperationResult, String> {
  let (entry, storage_mode) = build_secret_entry(key)?;
  entry.set_password(value).map_err(normalize_secret_store_error)?;

  Ok(DesktopSecretOperationResult {
    storage_mode: storage_mode.to_string(),
  })
}

pub fn delete_secret_value(key: DesktopSecretKey) -> Result<DesktopSecretOperationResult, String> {
  let (entry, storage_mode) = build_secret_entry(key)?;

  match entry.delete_credential() {
    Ok(()) | Err(KeyringError::NoEntry) => Ok(DesktopSecretOperationResult {
      storage_mode: storage_mode.to_string(),
    }),
    Err(error) => Err(normalize_secret_store_error(error)),
  }
}

pub fn load_secret_by_name(key: &str) -> Result<DesktopSecretValue, String> {
  let parsed_key = DesktopSecretKey::parse(key)?;
  let storage_mode = ensure_desktop_secret_store()?.to_string();
  let value = load_secret_value(parsed_key)?;

  Ok(DesktopSecretValue {
    value,
    storage_mode,
  })
}

pub fn save_secret_by_name(
  key: &str,
  value: &str,
) -> Result<DesktopSecretOperationResult, String> {
  let parsed_key = DesktopSecretKey::parse(key)?;
  save_secret_value(parsed_key, value)
}

pub fn delete_secret_by_name(key: &str) -> Result<DesktopSecretOperationResult, String> {
  let parsed_key = DesktopSecretKey::parse(key)?;
  delete_secret_value(parsed_key)
}