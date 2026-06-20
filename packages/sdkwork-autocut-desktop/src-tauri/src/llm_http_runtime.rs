use std::collections::BTreeMap;
use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};

const MAX_AUTOCUT_LLM_REQUEST_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_AUTOCUT_LLM_RESPONSE_BODY_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutLlmHttpRequest {
    pub url: String,
    pub method: String,
    pub headers: BTreeMap<String, String>,
    pub body_text: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCutLlmHttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: BTreeMap<String, String>,
    pub body_text: String,
}

pub fn send_autocut_llm_http_request(
    request: AutoCutLlmHttpRequest,
) -> Result<AutoCutLlmHttpResponse, String> {
    validate_autocut_llm_http_request(&request)?;
    send_autocut_llm_http_request_with_client(&build_autocut_llm_http_client()?, request)
}

fn build_autocut_llm_http_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| format!("Failed to build AutoCut LLM HTTP client: {error}"))
}

fn send_autocut_llm_http_request_with_client(
    client: &Client,
    request: AutoCutLlmHttpRequest,
) -> Result<AutoCutLlmHttpResponse, String> {
    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|error| format!("Invalid AutoCut LLM HTTP method: {error}"))?;
    let mut request_builder = client
        .request(method, request.url)
        .headers(to_header_map(&request.headers)?);

    if let Some(body_text) = request.body_text {
        request_builder = request_builder.body(body_text);
    }

    let response = request_builder
        .send()
        .map_err(|error| format!("AutoCut LLM HTTP request failed: {error}"))?;
    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let headers = from_header_map(response.headers());
    let body_bytes = response
        .bytes()
        .map_err(|error| format!("Failed to read AutoCut LLM HTTP response: {error}"))?;

    if body_bytes.len() > MAX_AUTOCUT_LLM_RESPONSE_BODY_BYTES {
        return Err("AutoCut LLM HTTP response body is too large.".to_string());
    }

    let body_text = String::from_utf8(body_bytes.to_vec())
        .map_err(|error| format!("AutoCut LLM HTTP response body is not valid UTF-8: {error}"))?;

    Ok(AutoCutLlmHttpResponse {
        status: status.as_u16(),
        status_text,
        headers,
        body_text,
    })
}

fn validate_autocut_llm_http_request(request: &AutoCutLlmHttpRequest) -> Result<(), String> {
    let parsed_url = reqwest::Url::parse(&request.url).map_err(|error| {
        format!("AutoCut LLM HTTP bridge received an invalid URL: {error}")
    })?;
    if parsed_url.scheme() != "https" {
        return Err("AutoCut LLM HTTP bridge only allows https:// endpoints.".to_string());
    }

    let method = request.method.to_uppercase();
    if method != "POST" && method != "GET" {
        return Err("AutoCut LLM HTTP bridge only allows GET and POST requests.".to_string());
    }

    if let Some(body_text) = &request.body_text {
        if body_text.len() > MAX_AUTOCUT_LLM_REQUEST_BODY_BYTES {
            return Err("AutoCut LLM HTTP request body is too large.".to_string());
        }
    }

    Ok(())
}

fn to_header_map(headers: &BTreeMap<String, String>) -> Result<HeaderMap, String> {
    let mut header_map = HeaderMap::new();
    for (name, value) in headers {
        let header_name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| format!("Invalid AutoCut LLM HTTP header name {name}: {error}"))?;
        let header_value = HeaderValue::from_str(value).map_err(|error| {
            format!("Invalid AutoCut LLM HTTP header value for {name}: {error}")
        })?;
        header_map.insert(header_name, header_value);
    }
    Ok(header_map)
}

fn from_header_map(headers: &HeaderMap) -> BTreeMap<String, String> {
    let mut output = BTreeMap::new();
    for (name, value) in headers {
        if let Ok(value_text) = value.to_str() {
            output.insert(name.as_str().to_string(), value_text.to_string());
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_https_llm_endpoints() {
        let error = validate_autocut_llm_http_request(&AutoCutLlmHttpRequest {
            url: "http://api.example.com/v1/chat/completions".to_string(),
            method: "POST".to_string(),
            headers: BTreeMap::new(),
            body_text: Some("{}".to_string()),
        })
        .expect_err("non-https endpoint must be rejected");

        assert!(error.contains("https://"));
    }

    #[test]
    fn rejects_unsupported_llm_http_methods() {
        let error = validate_autocut_llm_http_request(&AutoCutLlmHttpRequest {
            url: "https://api.example.com/v1/chat/completions".to_string(),
            method: "DELETE".to_string(),
            headers: BTreeMap::new(),
            body_text: None,
        })
        .expect_err("unsupported method must be rejected");

        assert!(error.contains("GET and POST"));
    }

    #[test]
    fn accepts_https_post_llm_requests() {
        validate_autocut_llm_http_request(&AutoCutLlmHttpRequest {
            url: "https://api.example.com/v1/chat/completions".to_string(),
            method: "POST".to_string(),
            headers: BTreeMap::new(),
            body_text: Some("{}".to_string()),
        })
        .expect("https POST LLM request should be accepted");
    }
}
