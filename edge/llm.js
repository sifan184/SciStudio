import { parseJsonBody, jsonResponse } from "./common.js";

async function forwardGlm(request, url) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "仅支持 POST 请求" }, 405);
  }

  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!authHeader || !/^Bearer\s+.+/.test(authHeader)) {
    return jsonResponse({ error: "缺少或不正确的 Authorization 头（需要 Bearer Token）" }, 401);
  }

  const body = await parseJsonBody(request);
  const targetUrl = "https://api.z.ai/api/paas/v4/chat/completions";

  try {
    const resp = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
        "Accept-Language": request.headers.get("Accept-Language") || "zh-CN,zh;q=0.9"
      },
      body: JSON.stringify(body)
    });

    const text = await resp.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!resp.ok) {
      const message = data && typeof data === "object" && (data.error || data.message)
        ? (data.error || data.message)
        : text || `GLM 上游错误（HTTP ${resp.status}）`;
      return jsonResponse({ error: message, status: resp.status }, resp.status);
    }

    return jsonResponse(data ?? { ok: true }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: `转发 GLM 请求失败：${message}` }, 502);
  }
}

export async function handleLlmRequest(request, url) {
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/api/llm/glm/chat")) {
    return forwardGlm(request, url);
  }
  return jsonResponse({ error: "未找到对应的 LLM 接口" }, 404);
}

