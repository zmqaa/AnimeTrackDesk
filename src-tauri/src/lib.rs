mod secure_storage;
mod storage;

use std::{fs, path::PathBuf, time::{Duration, Instant}};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
  app_name: String,
  app_version: String,
  storage_mode: String,
  app_data_dir: Option<String>,
  database_path: Option<String>,
  schema_version: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiConnectionTestResult {
  ok: bool,
  message: String,
  provider: String,
  endpoint: Option<String>,
  status_code: Option<u16>,
  latency_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveTextFileFilter {
  name: String,
  extensions: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveTextFileRequest {
  suggested_name: String,
  content: String,
  filters: Vec<SaveTextFileFilter>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveTextFileResult {
  canceled: bool,
  path: Option<String>,
}

fn build_ai_test_result(
  ok: bool,
  provider: String,
  message: String,
  endpoint: Option<String>,
  status_code: Option<u16>,
  latency_ms: Option<u64>,
) -> AiConnectionTestResult {
  AiConnectionTestResult {
    ok,
    message,
    provider,
    endpoint,
    status_code,
    latency_ms,
  }
}

fn should_use_ai_json_format(endpoint: &str, model: &str) -> bool {
  !endpoint.contains(".volces.com") && !model.trim().to_lowercase().starts_with("ep-")
}

fn should_disable_ai_thinking(endpoint: &str, model: &str) -> bool {
  endpoint.contains("dashscope.aliyuncs.com") || model.trim().to_lowercase().starts_with("qwen")
}

fn parse_ai_json_content(content: &str) -> Result<Value, String> {
  let normalized = content.trim();
  if normalized.is_empty() {
    return Err("AI 未返回结构化内容。".to_string());
  }

  if let Ok(value) = serde_json::from_str::<Value>(normalized) {
    return Ok(value);
  }

  if let (Some(start), Some(end)) = (normalized.find('{'), normalized.rfind('}')) {
    if end > start {
      let candidate = &normalized[start..=end];
      if let Ok(value) = serde_json::from_str::<Value>(candidate) {
        return Ok(value);
      }
    }
  }

  Err("AI 返回内容不是有效 JSON。".to_string())
}

#[tauri::command]
async fn parse_quick_record(
  text: String,
  settings: storage::AiProviderSettings,
) -> Result<Value, String> {
  let normalized_text = text.trim().to_string();
  if normalized_text.is_empty() {
    return Err("请输入一句话记录。".to_string());
  }

  let provider = if settings.provider.trim().is_empty() {
    "AI Provider".to_string()
  } else {
    settings.provider.trim().to_string()
  };

  if settings.model.trim().is_empty() {
    return Err("请先填写模型名。".to_string());
  }

  if settings.api_key.trim().is_empty() {
    return Err("请先填写 API Key。".to_string());
  }

  let endpoint = normalize_ai_test_endpoint(&settings.base_url)?;
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(30))
    .user_agent("AnimeTrack Quick Record")
    .build()
    .map_err(|error| format!("无法初始化 AI 客户端：{error}"))?;

  let mut request_body = json!({
    "model": settings.model.trim(),
    "messages": [
      {
        "role": "system",
        "content": "你是动漫观看记录结构化助手，只输出 JSON，不输出解释。未知信息留空，不要编造。你的核心任务是精确理解用户自然语言中的观看意图，特别是判断用户是看完整部/整季，还是只看了某几集。"
      },
      {
        "role": "user",
        "content": format!(r#"请把这句话解析成动漫观看记录：{normalized_text}

输出 JSON：
{{
  "records": [
    {{
      "animeTitle": "通行标题，必须；优先使用最自然、最稳定的常用标题，不强制中文",
      "originalTitle": "原名，可空",
      "titleKind": "official|generic-season|null",
      "season": 1,
      "episode": 1,
      "progress": 1,
      "watchedAt": "YYYY-MM-DD，可空",
      "premiereDate": "YYYY-MM-DD，可空",
      "status": "watching|completed|dropped|plan_to_watch|null",
      "score": null,
      "tags": [],
      "totalEpisodes": null,
      "durationMinutes": null,
      "summary": null,
      "coverUrl": null,
      "cast": [],
      "castAliases": [],
      "isFinished": null,
      "isHistorical": false,
      "rewatchTag": null
    }}
  ]
}}

规则：
1. 看完了/看过/补完/追完/以前看的，在没有具体集数时优先判定为 completed。
2. 提到具体集数，如看了第3集、追到第5集，优先判定为 watching，并填写 episode/progress。
3. 一句话里如果提到多部作品或多季，拆成多个 records。
4. 如果提到第一第二季、第一到第二季，必须拆成多个季的 records。
5. animeTitle 必须对应具体动画条目的常用标题；能识别稳定官方副标题时优先官方标题。
6. 如果用户明确说了“第 N 季”，你就不能改写成别的季度。只有在你能高置信度确认该季的官方副标题时，才可以返回该副标题；如果不确定，就保留为通用写法，并让 season 保持为用户明确给出的 N。
7. 只有明确提到的信息才能填写；不知道就留空，不要编造。
8. 以前/之前/小时候/很久前/早就 这类时间线索，isHistorical=true；没给具体日期时 watchedAt 留空。
9. 二刷/重刷/重温/再刷 写到 rewatchTag。
10. 不要生成个人备注、观后感、主观短评，这些不属于 AI 快速录入字段。
11. 完全识别不出来时返回 {{"records": []}}。"#),
      }
    ],
    "temperature": 0.1
  });

  if should_use_ai_json_format(&endpoint, &settings.model) {
    request_body["response_format"] = json!({ "type": "json_object" });
  }

  if should_disable_ai_thinking(&endpoint, &settings.model) {
    request_body["enable_thinking"] = json!(false);
  }

  let response = client
    .post(endpoint.clone())
    .header("Content-Type", "application/json")
    .bearer_auth(settings.api_key.trim())
    .json(&request_body)
    .send()
    .await
    .map_err(|error| {
      if error.is_timeout() {
        "AI 录入超时，请检查网络、Base URL 或代理设置。".to_string()
      } else {
        format!("AI 录入失败：{error}")
      }
    })?;

  let status_code = response.status().as_u16();
  let response_text = response.text().await.unwrap_or_default();
  if !(200..300).contains(&status_code) {
    let detail = extract_ai_error_message(&response_text)
      .unwrap_or_else(|| format!("请求失败，HTTP {status_code}"));
    return Err(format!("{provider} AI 录入失败：{detail}（HTTP {status_code}）"));
  }

  let parsed_value = serde_json::from_str::<Value>(&response_text)
    .map_err(|_| "AI 返回结果不是有效 JSON。".to_string())?;
  let content = parsed_value
    .get("choices")
    .and_then(Value::as_array)
    .and_then(|choices| choices.first())
    .and_then(|choice| choice.get("message"))
    .and_then(|message| message.get("content"))
    .and_then(Value::as_str)
    .ok_or_else(|| "AI 未返回可用的结构化内容。".to_string())?;

  parse_ai_json_content(content)
}

#[tauri::command]
async fn enrich_anime_metadata(
  query_name: String,
  settings: storage::AiProviderSettings,
) -> Result<Value, String> {
  let normalized_query = query_name.trim().to_string();
  if normalized_query.is_empty() {
    return Err("请先提供番剧标题。".to_string());
  }

  let provider = if settings.provider.trim().is_empty() {
    "AI Provider".to_string()
  } else {
    settings.provider.trim().to_string()
  };

  if !settings.enabled {
    return Err("请先在设置页启用 AI Provider。".to_string());
  }

  if settings.model.trim().is_empty() {
    return Err("请先填写模型名。".to_string());
  }

  if settings.api_key.trim().is_empty() {
    return Err("请先填写 API Key。".to_string());
  }

  let endpoint = normalize_ai_test_endpoint(&settings.base_url)?;
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(30))
    .user_agent("AnimeTrack Metadata Enrichment")
    .build()
    .map_err(|error| format!("无法初始化 AI 客户端：{error}"))?;

  let mut request_body = json!({
    "model": settings.model.trim(),
    "messages": [
      {
        "role": "system",
        "content": "你是动漫资料整理助手，只输出 JSON，不输出解释。信息不确定时宁可留空，不要编造。"
      },
      {
        "role": "user",
        "content": format!(r#"请识别这部动画，并返回 JSON。

原始名字：{normalized_query}

返回结构：
{{
  "officialTitle": "通行显示标题",
  "originalTitle": "日文原始标题",
  "totalEpisodes": 12,
  "durationMinutes": 24,
  "synopsis": "简体中文简介",
  "tags": ["校园", "喜剧"],
  "premiereDate": "YYYY-MM-DD 或 null",
  "isFinished": true,
  "coverUrl": null
}}

字段要求：
1. officialTitle 表示这部动画在记录列表中最自然、最稳定的通行标题，不是字段名意义上的“必须中文”。
2. 如果某部作品没有稳定常用的中文标题，或中文译名明显生硬、不自然，就保留更通行的原文、英文或罗马字写法；不要为了中文而生造翻译。
3. 如果有稳定通行的中文标题，优先返回中文标题，例如“葬送的芙莉莲”“孤独摇滚！”。
4. 如果是分季、续作、剧场版、OVA、OAD，返回该具体动画条目的标题。
5. 如果某一季有稳定通行的官方中文副标题，优先返回副标题形式，不要强行改写成“第 N 季”。
6. originalTitle 必须返回该动画条目在日本官方使用的可搜索准确标题，不要返回中文翻译。
7. 所有字段都必须对应动画版本本身，不要混入漫画、原作或企划信息。
8. premiereDate 必须是该动画第一集的电视或网络首播日期，精确到日；不确定就填 null，不要猜测。
9. 注意区分不同季度，不能把别季的放送日期和集数混进来。
如果无法识别，也返回同结构，但未知字段用 null 或空数组。"#),
      }
    ],
    "temperature": 0.1
  });

  if should_use_ai_json_format(&endpoint, &settings.model) {
    request_body["response_format"] = json!({ "type": "json_object" });
  }

  if should_disable_ai_thinking(&endpoint, &settings.model) {
    request_body["enable_thinking"] = json!(false);
  }

  let response = client
    .post(endpoint.clone())
    .header("Content-Type", "application/json")
    .bearer_auth(settings.api_key.trim())
    .json(&request_body)
    .send()
    .await
    .map_err(|error| {
      if error.is_timeout() {
        "AI 补充超时，请检查网络、Base URL 或代理设置。".to_string()
      } else {
        format!("AI 补充失败：{error}")
      }
    })?;

  let status_code = response.status().as_u16();
  let response_text = response.text().await.unwrap_or_default();
  if !(200..300).contains(&status_code) {
    let detail = extract_ai_error_message(&response_text)
      .unwrap_or_else(|| format!("请求失败，HTTP {status_code}"));
    return Err(format!("{provider} AI 补充失败：{detail}（HTTP {status_code}）"));
  }

  let parsed_value = serde_json::from_str::<Value>(&response_text)
    .map_err(|_| "AI 返回结果不是有效 JSON。".to_string())?;
  let content = parsed_value
    .get("choices")
    .and_then(Value::as_array)
    .and_then(|choices| choices.first())
    .and_then(|choice| choice.get("message"))
    .and_then(|message| message.get("content"))
    .and_then(Value::as_str)
    .ok_or_else(|| "AI 未返回可用的结构化内容。".to_string())?;

  parse_ai_json_content(content)
}

fn normalize_ai_test_endpoint(base_url: &str) -> Result<String, String> {
  let normalized = base_url.trim().trim_end_matches('/');
  if normalized.is_empty() {
    return Err("请先填写 Base URL。".to_string());
  }

  let endpoint = if normalized.ends_with("/chat/completions") {
    normalized.to_string()
  } else {
    format!("{normalized}/chat/completions")
  };

  let parsed = reqwest::Url::parse(&endpoint).map_err(|_| "Base URL 格式无效。".to_string())?;
  match parsed.scheme() {
    "http" | "https" => Ok(parsed.to_string()),
    _ => Err("Base URL 必须是 http 或 https 地址。".to_string()),
  }
}

fn shorten_text(value: &str, max_chars: usize) -> String {
  let normalized = value.trim();
  if normalized.chars().count() <= max_chars {
    return normalized.to_string();
  }

  let shortened: String = normalized.chars().take(max_chars).collect();
  format!("{shortened}...")
}

fn extract_ai_error_message(raw_text: &str) -> Option<String> {
  let normalized = raw_text.trim();
  if normalized.is_empty() {
    return None;
  }

  if let Ok(parsed_value) = serde_json::from_str::<Value>(normalized) {
    if let Some(message) = parsed_value
      .get("error")
      .and_then(|error| error.get("message").or_else(|| error.get("msg")))
      .and_then(Value::as_str)
      .map(str::trim)
      .filter(|value| !value.is_empty())
    {
      return Some(message.to_string());
    }

    if let Some(message) = parsed_value
      .get("message")
      .and_then(Value::as_str)
      .map(str::trim)
      .filter(|value| !value.is_empty())
    {
      return Some(message.to_string());
    }
  }

  Some(shorten_text(normalized, 220))
}

fn build_save_text_file_result(canceled: bool, path: Option<String>) -> SaveTextFileResult {
  SaveTextFileResult {
    canceled,
    path,
  }
}

fn resolve_database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let app_data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
  Ok(app_data_dir.join("animetrack.db"))
}

#[tauri::command]
fn get_runtime_info(app: tauri::AppHandle) -> Result<RuntimeInfo, String> {
  let app_data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
  let database_path = resolve_database_path(&app)?;
  let schema_version = storage::ensure_database(&database_path)?;

  Ok(RuntimeInfo {
    app_name: app.package_info().name.clone(),
    app_version: app.package_info().version.to_string(),
    storage_mode: "sqlite-bootstrap".to_string(),
    app_data_dir: Some(app_data_dir.display().to_string()),
    database_path: Some(database_path.display().to_string()),
    schema_version: Some(schema_version),
  })
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<storage::AppSettings, String> {
  let database_path = resolve_database_path(&app)?;
  storage::load_settings(&database_path)
}

#[tauri::command]
fn load_secret(key: String) -> Result<secure_storage::SecretValue, String> {
  secure_storage::load_secret_by_name(&key)
}

#[tauri::command]
fn save_secret(
  key: String,
  value: String,
) -> Result<secure_storage::SecretOperationResult, String> {
  secure_storage::save_secret_by_name(&key, &value)
}

#[tauri::command]
fn delete_secret(key: String) -> Result<secure_storage::SecretOperationResult, String> {
  secure_storage::delete_secret_by_name(&key)
}

#[tauri::command]
fn save_settings(
  app: tauri::AppHandle,
  settings: storage::AppSettings,
) -> Result<storage::AppSettings, String> {
  let database_path = resolve_database_path(&app)?;
  storage::save_settings(&database_path, settings)
}

#[tauri::command]
fn save_text_file(
  app: tauri::AppHandle,
  request: SaveTextFileRequest,
) -> Result<SaveTextFileResult, String> {
  let suggested_name = request.suggested_name.trim();
  if suggested_name.is_empty() {
    return Err("缺少默认文件名。".to_string());
  }

  let mut dialog = rfd::FileDialog::new().set_file_name(suggested_name);
  if let Ok(download_dir) = app.path().download_dir() {
    dialog = dialog.set_directory(download_dir);
  }

  for filter in request.filters.iter() {
    let extensions = filter
      .extensions
      .iter()
      .map(|item| item.trim())
      .filter(|item| !item.is_empty())
      .collect::<Vec<_>>();

    if !extensions.is_empty() {
      dialog = dialog.add_filter(&filter.name, &extensions);
    }
  }

  let Some(target_path) = dialog.save_file() else {
    return Ok(build_save_text_file_result(true, None));
  };

  if let Some(parent) = target_path.parent() {
    fs::create_dir_all(parent).map_err(|error| format!("创建目录失败：{error}"))?;
  }

  fs::write(&target_path, request.content.as_bytes()).map_err(|error| format!("写入文件失败：{error}"))?;

  Ok(build_save_text_file_result(
    false,
    Some(target_path.display().to_string()),
  ))
}

#[tauri::command]
async fn test_ai_connection(settings: storage::AiProviderSettings) -> AiConnectionTestResult {
  let provider = if settings.provider.trim().is_empty() {
    "AI Provider".to_string()
  } else {
    settings.provider.trim().to_string()
  };

  if settings.model.trim().is_empty() {
    return build_ai_test_result(
      false,
      provider,
      "请先填写模型名。".to_string(),
      None,
      None,
      None,
    );
  }

  if settings.api_key.trim().is_empty() {
    return build_ai_test_result(
      false,
      provider,
      "请先填写 API Key。".to_string(),
      None,
      None,
      None,
    );
  }

  let endpoint = match normalize_ai_test_endpoint(&settings.base_url) {
    Ok(value) => value,
    Err(message) => {
      return build_ai_test_result(false, provider, message, None, None, None);
    }
  };

  let client = match reqwest::Client::builder()
    .timeout(Duration::from_secs(20))
    .user_agent("AnimeTrack AI Probe")
    .build()
  {
    Ok(value) => value,
    Err(error) => {
      return build_ai_test_result(
        false,
        provider,
        format!("无法初始化 AI 测试客户端：{error}"),
        Some(endpoint),
        None,
        None,
      );
    }
  };

  let request_body = json!({
    "model": settings.model.trim(),
    "messages": [
      {
        "role": "user",
        "content": "Reply with OK only."
      }
    ],
    "temperature": 0.0,
    "max_tokens": 1,
    "stream": false
  });

  let started_at = Instant::now();
  let response = match client
    .post(endpoint.clone())
    .header("Content-Type", "application/json")
    .bearer_auth(settings.api_key.trim())
    .json(&request_body)
    .send()
    .await
  {
    Ok(value) => value,
    Err(error) => {
      let message = if error.is_timeout() {
        "AI 连接测试超时，请检查网络、Base URL 或代理设置。".to_string()
      } else {
        format!("AI 连接测试失败：{error}")
      };

      return build_ai_test_result(false, provider, message, Some(endpoint), None, None);
    }
  };

  let latency_ms = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
  let status_code = response.status().as_u16();
  let response_text = response.text().await.unwrap_or_default();

  if !(200..300).contains(&status_code) {
    let detail = extract_ai_error_message(&response_text)
      .unwrap_or_else(|| format!("请求失败，HTTP {status_code}"));
    let message = format!("{provider} 探活失败：{detail}（HTTP {status_code}）");
    return build_ai_test_result(
      false,
      provider,
      message,
      Some(endpoint),
      Some(status_code),
      Some(latency_ms),
    );
  }

  if let Ok(parsed_value) = serde_json::from_str::<Value>(&response_text) {
    if let Some(detail) = parsed_value
      .get("error")
      .and_then(|value| value.get("message").or_else(|| value.get("msg")))
      .and_then(Value::as_str)
      .map(str::trim)
      .filter(|value| !value.is_empty())
    {
      let message = format!("{provider} 探活失败：{detail}");
      return build_ai_test_result(
        false,
        provider,
        message,
        Some(endpoint),
        Some(status_code),
        Some(latency_ms),
      );
    }
  }

  let message = format!(
    "{provider} 连接成功，模型 {} 可访问（{} ms）。",
    settings.model.trim(),
    latency_ms,
  );
  build_ai_test_result(
    true,
    provider,
    message,
    Some(endpoint),
    Some(status_code),
    Some(latency_ms),
  )
}

#[tauri::command]
fn load_anime_snapshot(app: tauri::AppHandle) -> Result<storage::AnimeStorageSnapshot, String> {
  let database_path = resolve_database_path(&app)?;
  storage::load_anime_snapshot(&database_path)
}

#[tauri::command]
fn save_anime_snapshot(
  app: tauri::AppHandle,
  snapshot: storage::AnimeStorageSnapshot,
) -> Result<storage::AnimeStorageSnapshot, String> {
  let database_path = resolve_database_path(&app)?;
  storage::save_anime_snapshot(&database_path, snapshot)
}

#[tauri::command]
fn upsert_anime_entry(
  app: tauri::AppHandle,
  entry: storage::AnimeStorageEntry,
) -> Result<storage::AnimeStorageEntry, String> {
  let database_path = resolve_database_path(&app)?;
  storage::upsert_anime_entry_record(&database_path, entry)
}

#[tauri::command]
fn save_watch_history_entry(
  app: tauri::AppHandle,
  record: storage::WatchHistoryEntry,
) -> Result<storage::WatchHistoryEntry, String> {
  let database_path = resolve_database_path(&app)?;
  storage::save_watch_history_entry(&database_path, record)
}

#[tauri::command]
fn delete_anime_entries(app: tauri::AppHandle, ids: Vec<String>) -> Result<usize, String> {
  let database_path = resolve_database_path(&app)?;
  storage::delete_anime_entries(&database_path, ids)
}

#[tauri::command]
fn delete_watch_history_entries(app: tauri::AppHandle, ids: Vec<String>) -> Result<usize, String> {
  let database_path = resolve_database_path(&app)?;
  storage::delete_watch_history_entries(&database_path, ids)
}

#[tauri::command]
fn list_backups(app: tauri::AppHandle) -> Result<Vec<storage::BackupFile>, String> {
  let database_path = resolve_database_path(&app)?;
  storage::list_backups(&database_path)
}

#[tauri::command]
fn save_backup(
  app: tauri::AppHandle,
  payload: storage::BackupPayload,
) -> Result<storage::BackupFile, String> {
  let database_path = resolve_database_path(&app)?;
  storage::save_backup(&database_path, payload)
}

#[tauri::command]
fn read_backup(
  app: tauri::AppHandle,
  name: String,
) -> Result<storage::BackupPayload, String> {
  let database_path = resolve_database_path(&app)?;
  storage::read_backup(&database_path, &name)
}

#[tauri::command]
fn delete_backup(app: tauri::AppHandle, name: String) -> Result<(), String> {
  let database_path = resolve_database_path(&app)?;
  storage::delete_backup(&database_path, &name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_runtime_info,
      load_settings,
      load_secret,
      save_secret,
      delete_secret,
      save_settings,
      save_text_file,
      test_ai_connection,
      parse_quick_record,
      enrich_anime_metadata,
      load_anime_snapshot,
      save_anime_snapshot,
      upsert_anime_entry,
      save_watch_history_entry,
      delete_anime_entries,
      delete_watch_history_entries,
      list_backups,
      save_backup,
      read_backup,
      delete_backup
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
