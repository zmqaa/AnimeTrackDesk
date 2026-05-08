use std::{collections::HashMap, sync::OnceLock};

use keyring_core::{Entry, Error as KeyringError};
use serde::Serialize;

const SECRET_SERVICE: &str = "com.zmqqqa.animetrack.desktop";
pub const SECRET_STORAGE_MODE_OS_KEYCHAIN: &str = "os-keychain";
pub const SECRET_STORAGE_MODE_ENCRYPTED_SQLITE: &str = "encrypted-sqlite";

static SECRET_STORE_MODE: OnceLock<Result<&'static str, String>> = OnceLock::new();

#[derive(Debug, Clone, Copy)]
pub enum SecretKey {
  AiApiKey,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretValue {
  pub value: Option<String>,
  pub storage_mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretOperationResult {
  pub storage_mode: String,
}

impl SecretKey {
  fn user(self) -> &'static str {
    match self {
      SecretKey::AiApiKey => "ai-provider-api-key",
    }
  }

  pub fn parse(value: &str) -> Result<Self, String> {
    match value.trim() {
      "ai-api-key" => Ok(SecretKey::AiApiKey),
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

fn ensure_secret_store() -> Result<&'static str, String> {
  let initialization = SECRET_STORE_MODE.get_or_init(|| {
    keyring::use_native_store(true)
      .map(|_| SECRET_STORAGE_MODE_OS_KEYCHAIN)
      .or_else(|native_error| {
        let fallback_config = HashMap::new();
        keyring::use_sqlite_store(&fallback_config)
          .map(|_| SECRET_STORAGE_MODE_ENCRYPTED_SQLITE)
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

fn build_secret_entry(key: SecretKey) -> Result<(Entry, &'static str), String> {
  let storage_mode = ensure_secret_store()?;
  let entry = Entry::new(SECRET_SERVICE, key.user()).map_err(normalize_secret_store_error)?;
  Ok((entry, storage_mode))
}

pub fn load_secret_value(key: SecretKey) -> Result<Option<String>, String> {
  let (entry, _storage_mode) = build_secret_entry(key)?;

  match entry.get_password() {
    Ok(value) => Ok(Some(value)),
    Err(KeyringError::NoEntry) => Ok(None),
    Err(error) => Err(normalize_secret_store_error(error)),
  }
}

pub fn save_secret_value(
  key: SecretKey,
  value: &str,
) -> Result<SecretOperationResult, String> {
  let (entry, storage_mode) = build_secret_entry(key)?;
  entry.set_password(value).map_err(normalize_secret_store_error)?;

  Ok(SecretOperationResult {
    storage_mode: storage_mode.to_string(),
  })
}

pub fn delete_secret_value(key: SecretKey) -> Result<SecretOperationResult, String> {
  let (entry, storage_mode) = build_secret_entry(key)?;

  match entry.delete_credential() {
    Ok(()) | Err(KeyringError::NoEntry) => Ok(SecretOperationResult {
      storage_mode: storage_mode.to_string(),
    }),
    Err(error) => Err(normalize_secret_store_error(error)),
  }
}

pub fn load_secret_by_name(key: &str) -> Result<SecretValue, String> {
  let parsed_key = SecretKey::parse(key)?;
  let storage_mode = ensure_secret_store()?.to_string();
  let value = load_secret_value(parsed_key)?;

  Ok(SecretValue {
    value,
    storage_mode,
  })
}

pub fn save_secret_by_name(
  key: &str,
  value: &str,
) -> Result<SecretOperationResult, String> {
  let parsed_key = SecretKey::parse(key)?;
  save_secret_value(parsed_key, value)
}

pub fn delete_secret_by_name(key: &str) -> Result<SecretOperationResult, String> {
  let parsed_key = SecretKey::parse(key)?;
  delete_secret_value(parsed_key)
}