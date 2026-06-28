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

## 核心：观看状态判断

status 字段是最重要的判断。请从用户的自然语言中推断观看意图：

### status=completed（看完整部/整季）的识别信号：
- 明确说完："看完了""看完的""补完了""追完了""刷完了""啃完了""撸完了""肝完了"
- 过去式完成："看过""看过了""看过的""补过了""追过""补过"
- 定语修饰形式："以前看完的XXX""之前追完的XXX""小时候看过的XXX"
- 历史回忆语气："以前看的XXX""之前看的XXX""很久前看的XXX""小时候看的XXX"——当没有指定具体集数时，默认理解为看完整部
- 批量录入式："以前看完了A、B、C""之前补了A和B"

### status=watching（正在追/只看了部分）的识别信号：
- 提到具体集数："看了第一集""追到第5集""看到第三集"
- 正在进行："在看""在追""正在追""开始看了""刚开始看"
- 只说"看了"而非"看完了"且提到了集数

### 关键区分：
- "看完了XXX" / "看完的XXX" → completed（整部看完）
- "看完了XXX第3集" / "看完了第3集" → watching，episode=3（只看完单集）
- "以前看的XXX" → completed（回忆性表述，没有集数说明已经看完）
- "看了XXX第1集" → watching，episode=1（明确指定了集数）
- "看了XXX" → 如果没有任何集数信息，且有"以前/之前"等时间线索 → completed；否则 → watching

## 其他规则：
1. 一句话里如果明确提到多部作品或多条记录，拆成多个 records。
2. 如果出现"第一第二季 / 第一到第二季 / 第一、第二季"，必须拆成多个 seasons 对应的 records，不能只保留一个季。
3. animeTitle 必须对应"具体动画条目"的通行标题，不是原作总标题。
4. 如果作品没有稳定常用中文名，或者中文译名明显生硬、不自然，可以直接保留更常见的原文/英文/罗马字写法，例如"Slow Start""NEW GAME!"；不要为了中文硬翻。
5. 如果该季或续作有稳定通行的官方中文副标题，直接使用官方标题，例如"南家三姐妹 再来一碗""南家三姐妹 欢迎回来"；此时 titleKind=official，并且不要把标题改写成"第X季"。
6. 只有在无法确定该季官方中文副标题时，才使用"基础标题 第X季"；此时 titleKind=generic-season。
7. season 可以填写，但不要因为填了 season 就把官方标题强行改成"第X季"。
8. 只有用户明确提到的信息才填写；不知道就用 null、空字符串或空数组，不要补全设定。
9. "以前、之前、小时候、很久前、早就"这类表述，isHistorical=true；没给具体日期时 watchedAt 留空。
10. "二刷、三刷、重刷、重温、再刷"填到 rewatchTag。
11. 不要凭常识生成简介、封面、声优、总集数、时长、标签；这些后续会再补全。
12. 完全识别不出来时返回 {{"records": []}}。

## 示例：
- "我以前看完了我心里危险的东西第一第二季，还有阴阳眼见子" → 3 条：我心里危险的东西 第一季（completed）、我心里危险的东西 第二季（completed）、看得见的女孩（completed）；三条都 isHistorical=true。
- "我今天看了放学后海堤日记第一集" → 1 条，status=watching，episode=1，progress=1。
- "我以前看了南家三姐妹第二季" → 优先返回"南家三姐妹 再来一碗"，season=2，titleKind=official，status=completed，isHistorical=true。
- "以前看完的间谍过家家第二季" → 间谍过家家 第二季，status=completed，isHistorical=true。
- "之前看过孤独摇滚" → 孤独摇滚！，status=completed，isHistorical=true。
- "之前看过 slow start 和 new game" → Slow Start、NEW GAME!，status=completed，isHistorical=true。
- "我昨天开始看葬送的芙莉莲" → 葬送的芙莉莲，status=watching，episode 留空。
- "小时候看的名侦探柯南" → 名侦探柯南，status=completed，isHistorical=true。
- "我看了3集无职转生" → 无职转生，status=watching，episode=3，progress=3。"#),
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
1. officialTitle 表示这部动画在记录列表中最自然、最稳定的通行标题，不是字段名意义上的"必须中文"。
2. 如果某部作品没有稳定常用的中文标题，或中文译名明显生硬、不自然，就保留更通行的原文/英文/罗马字写法，例如"Slow Start""NEW GAME!"；不要为了中文而生造翻译。
3. 如果有稳定通行的中文标题，优先返回中文标题，例如"葬送的芙莉莲""孤独摇滚！"。
4. 如果是分季、续作、剧场版、OVA、OAD，返回该具体动画条目的标题。
5. 如果某一季有稳定通行的官方中文副标题，优先返回副标题形式，例如"南家三姐妹 再来一碗"；不要强行改写成"南家三姐妹 第二季"。
6. originalTitle 是最关键的字段之一，必须返回该动画条目在日本官方使用的日文标题（含日文汉字、假名、英文混写均可），例如"SPY×FAMILY Season 2""僕のヒーローアカデミア""Re:ゼロから始める異世界生活"。这个字段会被用来搜索 Bangumi 等数据库，所以必须是可搜索的准确标题，不要返回中文翻译。
7. 所有字段都必须对应动画版本本身，不要混入漫画连载开始时间、原作书名或企划信息。
8. premiereDate 是该动画第一集的电视/网络首播日期，精确到日。必须根据知识给出历史真实日期——如果该季动画是 2022 年播出的，就不能填 2025 年或 2026 年的日期。不确定就填 null，绝对不要猜测，更不要填当前年份作为占位。
9. 注意区分不同季度：例如"间谍过家家"第一季首播于 2022 年 4 月，第二季首播于 2023 年 10 月，第三季首播于 2025 年 10 月，不要搞混。
10. isFinished 根据实际播出状态判断：已全部播完、官方宣布完结、或最后一集已播出超过半年的 → true；仍在连载/播出中、官方已宣布续季、或距最后一集播出不足半年 → false。如果无法确定播出状态，填 null，不要猜。
11. totalEpisodes 是该季/该条目实际已播出的总集数。如果动画仍在播出中且未公布总集数，填 null。
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
