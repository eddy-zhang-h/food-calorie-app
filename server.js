const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;

loadLocalEnv();

const PORT = Number(process.env.PORT || 8081);
const PROVIDER = (process.env.AI_PROVIDER || "openai").toLowerCase();
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const PACKYCODE_MODEL = process.env.PACKYCODE_MODEL || "gpt-4.1-mini";
const PACKYCODE_BASE_URL = normalizeBaseUrl(process.env.PACKYCODE_BASE_URL || "");
const MAX_BODY_BYTES = 7 * 1024 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

function loadLocalEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fsSync.existsSync(envPath)) return;

  const lines = fsSync.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = unquoteEnvValue(rawValue);
  }
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

const server = http.createServer(async (request, response) => {
  try {
    setCorsHeaders(request, response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        provider: PROVIDER,
        model: getProviderModel(),
        configured: isProviderConfigured(),
        needsBaseUrl: PROVIDER === "packycode" && !PACKYCODE_BASE_URL
      });
      return;
    }

    if (url.pathname === "/api/analyze-food") {
      await handleAnalyzeFood(request, response);
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: error.message || "服务器处理失败。" });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Food calorie app running at http://localhost:${PORT}`);
    console.log(`AI provider: ${PROVIDER} (${isProviderConfigured() ? "configured" : "missing config"})`);
  });
}

async function handleAnalyzeFood(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  if (!isProviderConfigured()) {
    sendJson(response, 503, { error: "未配置 AI API key。" });
    return;
  }

  const body = await readJsonBody(request);
  if (!body.imageData || !isDataUrl(body.imageData)) {
    sendJson(response, 400, { error: "请上传有效图片。" });
    return;
  }

  const estimate = await analyzeImage(body.imageData);

  sendJson(response, 200, estimate);
}

async function analyzeImage(imageData) {
  if (PROVIDER === "anthropic") return analyzeWithAnthropic(imageData);
  if (PROVIDER === "packycode") return analyzeWithPackyCode(imageData);
  return analyzeWithOpenAI(imageData);
}

async function analyzeWithOpenAI(imageData) {
  const apiKey = process.env.OPENAI_API_KEY;
  const result = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: buildPrompt() },
            { type: "input_image", image_url: imageData, detail: "low" }
          ]
        }
      ]
    })
  });

  const payload = await result.json();
  if (!result.ok) throw new Error(payload.error?.message || "OpenAI request failed");
  return normalizeModelJson(extractOpenAIText(payload), "ai");
}

async function analyzeWithAnthropic(imageData) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const { mediaType, base64 } = splitDataUrl(imageData);
  const result = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 700,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 }
            },
            { type: "text", text: buildPrompt() }
          ]
        }
      ]
    })
  });

  const payload = await result.json();
  if (!result.ok) throw new Error(payload.error?.message || "Anthropic request failed");
  const text = payload.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n") || "";
  return normalizeModelJson(text, "ai");
}

async function analyzeWithPackyCode(imageData) {
  if (!PACKYCODE_BASE_URL) {
    throw new Error("PACKYCODE_BASE_URL is required for AI_PROVIDER=packycode");
  }

  if (PACKYCODE_MODEL.startsWith("claude-")) {
    return analyzeWithPackyCodeAnthropic(imageData);
  }

  const apiKey = process.env.PACKYCODE_API_KEY;
  const result = await fetch(getOpenAICompatibleChatUrl(PACKYCODE_BASE_URL), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: PACKYCODE_MODEL,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildPrompt() },
            { type: "image_url", image_url: { url: imageData, detail: "low" } }
          ]
        }
      ]
    })
  });

  const payload = await readProviderPayload(result, "PackyCode");
  if (!result.ok) throw new Error(payload.error?.message || payload.error || "PackyCode request failed");
  const text = payload.choices?.[0]?.message?.content || "";
  return normalizeModelJson(text, "ai");
}

async function analyzeWithPackyCodeAnthropic(imageData) {
  const apiKey = process.env.PACKYCODE_API_KEY;
  const { mediaType, base64 } = splitDataUrl(imageData);
  const result = await fetch(getAnthropicCompatibleMessagesUrl(PACKYCODE_BASE_URL), {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: PACKYCODE_MODEL,
      max_tokens: 700,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 }
            },
            { type: "text", text: buildPrompt() }
          ]
        }
      ]
    })
  });

  const payload = await readProviderPayload(result, "PackyCode");
  if (!result.ok) throw new Error(payload.error?.message || payload.error || "PackyCode request failed");
  const text = payload.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n") || "";
  return normalizeModelJson(text, "ai");
}

function buildPrompt() {
  return [
    "你是一个谨慎的食物照片热量估算助手。",
    "只根据图片判断，不要假装确定看不清的内容。",
    "如果图片里没有明确食物，isFood 必须为 false，caloriesKcal 为 0。",
    "如果是食物，估算可食用部分总热量，并给出 0 到 1 的 confidence。",
    "只返回 JSON，不要 Markdown，不要解释。",
    "JSON 字段：isFood, foodName, portion, portionUnit, caloriesKcal, confidence, mealTypeSuggestion, notes。",
    "portionUnit 必须是 份、碗、克、个 之一；mealTypeSuggestion 必须是 早餐、午餐、晚餐、加餐 之一。",
    "notes 用中文简短说明估算依据和不确定性。"
  ].join("\n");
}

function normalizeModelJson(text, source) {
  const parsed = parseJsonFromText(text);
  const isFood = Boolean(parsed.isFood);
  return {
    isFood,
    foodName: isFood ? String(parsed.foodName || "待确认食物").slice(0, 40) : "未检测到食物",
    portion: clampNumber(parsed.portion, 0.1, 20, 1),
    portionUnit: normalizeOption(parsed.portionUnit, ["份", "碗", "克", "个"], "份"),
    caloriesKcal: isFood ? Math.round(clampNumber(parsed.caloriesKcal, 1, 5000, 300)) : 0,
    confidence: clampNumber(parsed.confidence, 0, 1, 0.4),
    mealTypeSuggestion: normalizeOption(parsed.mealTypeSuggestion, ["早餐", "午餐", "晚餐", "加餐"], "午餐"),
    notes: String(parsed.notes || "").slice(0, 160),
    source
  };
}

function parseJsonFromText(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model did not return JSON");
    return JSON.parse(match[0]);
  }
}

function extractOpenAIText(payload) {
  if (payload.output_text) return payload.output_text;
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("\n");
}

function isProviderConfigured() {
  if (PROVIDER === "packycode") return Boolean(process.env.PACKYCODE_API_KEY && PACKYCODE_BASE_URL);
  if (PROVIDER === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
  return Boolean(process.env.OPENAI_API_KEY);
}

async function readProviderPayload(response, providerName) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, " ").slice(0, 140);
    throw new Error(`${providerName} returned non-JSON response from ${response.url}: ${preview}`);
  }
}

function getOpenAICompatibleChatUrl(baseUrl) {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/v1") ? `${path}/chat/completions` : `${path}/v1/chat/completions`;
  return url.toString();
}

function getAnthropicCompatibleMessagesUrl(baseUrl) {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/v1") ? `${path}/messages` : `${path}/v1/messages`;
  return url.toString();
}

function getProviderModel() {
  if (PROVIDER === "packycode") return PACKYCODE_MODEL;
  if (PROVIDER === "anthropic") return ANTHROPIC_MODEL;
  return OPENAI_MODEL;
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Image payload too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

async function serveStatic(urlPath, response) {
  const safePath = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const requestedPath = safePath === "/" ? "/index.html" : safePath;
  const filePath = path.join(ROOT, requestedPath);

  if (!filePath.startsWith(ROOT)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const extension = path.extname(filePath);
    response.writeHead(200, { "Content-Type": MIME_TYPES[extension] || "application/octet-stream" });
    response.end(content);
  } catch {
    sendText(response, 404, "Not found");
  }
}

function setCorsHeaders(request, response) {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean);
  const origin = request.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function sendText(response, status, text) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

function isDataUrl(value) {
  return /^data:image\/(png|jpe?g|webp);base64,/i.test(value);
}

function splitDataUrl(value) {
  const match = value.match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i);
  if (!match) throw new Error("Invalid image data URL");
  return { mediaType: match[1].toLowerCase(), base64: match[2] };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeOption(value, options, fallback) {
  return options.includes(value) ? value : fallback;
}

module.exports = {
  analyzeImage,
  isDataUrl,
  isProviderConfigured,
  getProviderModel,
  getProviderStatus: () => ({
    ok: true,
    provider: PROVIDER,
    model: getProviderModel(),
    configured: isProviderConfigured(),
    needsBaseUrl: PROVIDER === "packycode" && !PACKYCODE_BASE_URL
  })
};
