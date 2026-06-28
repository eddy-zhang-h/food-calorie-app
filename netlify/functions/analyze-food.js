const { analyzeImage, isDataUrl, isProviderConfigured, getProviderStatus } = require("../../server");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return response(204, "");
  }

  if (event.httpMethod === "GET") {
    return response(200, getProviderStatus());
  }

  if (event.httpMethod !== "POST") {
    return response(405, { error: "Method not allowed" });
  }

  try {
    if (!isProviderConfigured()) {
      return response(503, { error: "未配置 AI API key。" });
    }

    const body = JSON.parse(event.body || "{}");
    if (!body.imageData || !isDataUrl(body.imageData)) {
      return response(400, { error: "请上传有效图片。" });
    }

    const estimate = await analyzeImage(body.imageData);
    return response(200, estimate);
  } catch (error) {
    console.error(error);
    return response(500, { error: error.message || "服务器处理失败。" });
  }
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=utf-8"
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  };
}
