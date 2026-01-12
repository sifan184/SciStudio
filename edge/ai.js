import { getEnv, parseJsonBody, jsonResponse } from "./common.js";

async function readGlmStream(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    try {
      const data = await response.json();
      const content =
        data &&
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content;
      if (!content) {
        throw new Error("No response content from GLM");
      }
      return typeof content === "string" ? content : String(content);
    } catch (e) {
      const text = await response.text().catch(() => "");
      if (text) {
        return text;
      }
      throw e;
    }
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    const fallbackText = await response.text().catch(() => "");
    if (!fallbackText) {
      throw new Error("No response body from GLM");
    }
    return fallbackText;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let fullText = "";
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    buffer += decoder.decode(result.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) {
        continue;
      }
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") {
        continue;
      }
      try {
        const json = JSON.parse(payload);
        let delta = null;
        if (json.choices && json.choices.length > 0) {
          const choice = json.choices[0];
          if (choice.delta && choice.delta.content != null) {
            delta = choice.delta.content;
          } else if (choice.message && choice.message.content != null) {
            delta = choice.message.content;
          }
        }
        if (delta) {
          fullText += typeof delta === "string" ? delta : String(delta);
        }
      } catch (e) {
      }
    }
  }
  if (!fullText && buffer) {
    fullText = buffer;
  }
  if (!fullText) {
    throw new Error("No response content from GLM");
  }
  return fullText;
}

async function callGlmWithStreaming(model, apiKey, systemInstruction, userContent) {
  const response = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: userContent }
      ],
      max_tokens: 4096,
      temperature: 0.2,
      stream: true
    })
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    const suffix = errorText ? ` - ${errorText}` : "";
    throw new Error(`GLM API Error: ${response.status} ${response.statusText}${suffix}`);
  }
  const text = await readGlmStream(response);
  return text;
}

async function proxyGlmStreamToClient(model, apiKey, systemInstruction, userContent) {
  const res = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: userContent }
      ],
      max_tokens: 4096,
      temperature: 0.2,
      stream: true
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const suffix = text ? ` - ${text}` : "";
    return jsonResponse(
      {
        error: `GLM API Error: ${res.status} ${res.statusText}${suffix}`
      },
      res.status
    );
  }
  const encoder = new TextEncoder();
  const glmReader = res.body && typeof res.body.getReader === "function" ? res.body.getReader() : null;
  const stream = new ReadableStream({
    async start(controller) {
      if (!glmReader) {
        const text = await res.text().catch(() => "");
        if (text) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: text })}\n\n`));
        }
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
        return;
      }
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      while (true) {
        const { done, value } = await glmReader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          const s = line.trim();
          if (!s || !s.startsWith("data:")) continue;
          const payload = s.slice(5).trim();
          if (!payload || payload === "[DONE]") {
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            continue;
          }
          try {
            const json = JSON.parse(payload);
            let delta = null;
            if (json.choices && json.choices.length > 0) {
              const choice = json.choices[0];
              if (choice.delta && choice.delta.content != null) {
                delta = choice.delta.content;
              } else if (choice.message && choice.message.content != null) {
                delta = choice.message.content;
              }
            }
            if (delta != null) {
              const str = typeof delta === "string" ? delta : String(delta);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: str })}\n\n`));
            }
          } catch (e) {
          }
        }
      }
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
}

async function handleAiRequest(request, url) {
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) {
    path = path.replace(/\/+$/, "");
  }
  if (path.endsWith("/api/ai/glm-chat/stream")) {
    if (request.method !== "POST") {
      return jsonResponse(
        {
          error: "仅支持 POST 请求"
        },
        405
      );
    }
    const body = await parseJsonBody(request);
    const model = typeof body.model === "string" && body.model ? body.model : "glm-4.7";
    const systemInstruction =
      typeof body.systemInstruction === "string" ? body.systemInstruction : "";
    const userContent =
      typeof body.userContent === "string" ? body.userContent : "";
    if (!userContent) {
      return jsonResponse(
        {
          error: "缺少 userContent"
        },
        400
      );
    }
    const env = getEnv() || {};
    let apiKey = "";
    if (body.apiKey && typeof body.apiKey === "string" && body.apiKey.trim()) {
      apiKey = body.apiKey.trim();
    } else {
      apiKey =
        env.VITE_GLM_API_KEY ||
        env.VITE_ZAI_API_KEY ||
        env.GLM_API_KEY ||
        env.ZAI_API_KEY ||
        "";
    }
    if (!apiKey || apiKey === "PLACEHOLDER_API_KEY") {
      return jsonResponse(
        {
          error:
            "GLM API Key 未配置或仍为占位值，请在环境变量中设置 ZAI_API_KEY 或相关配置。"
        },
        500
      );
    }
    return proxyGlmStreamToClient(model, apiKey, systemInstruction, userContent);
  }
  if (path.endsWith("/api/ai/glm-chat")) {
    if (request.method !== "POST") {
      return jsonResponse(
        {
          error: "仅支持 POST 请求"
        },
        405
      );
    }
    const body = await parseJsonBody(request);
    const model = typeof body.model === "string" && body.model ? body.model : "glm-4.7";
    const systemInstruction =
      typeof body.systemInstruction === "string" ? body.systemInstruction : "";
    const userContent =
      typeof body.userContent === "string" ? body.userContent : "";
    if (!userContent) {
      return jsonResponse(
        {
          error: "缺少 userContent"
        },
        400
      );
    }
    const env = getEnv() || {};
    let apiKey = "";
    if (body.apiKey && typeof body.apiKey === "string" && body.apiKey.trim()) {
      apiKey = body.apiKey.trim();
    } else {
      apiKey =
        env.VITE_GLM_API_KEY ||
        env.VITE_ZAI_API_KEY ||
        env.GLM_API_KEY ||
        env.ZAI_API_KEY ||
        "";
    }
    if (!apiKey || apiKey === "PLACEHOLDER_API_KEY") {
      return jsonResponse(
        {
          error:
            "GLM API Key 未配置或仍为占位值，请在环境变量中设置 ZAI_API_KEY 或相关配置。"
        },
        500
      );
    }
    try {
      const text = await callGlmWithStreaming(
        model,
        apiKey,
        systemInstruction,
        userContent
      );
      return jsonResponse(
        {
          text
        },
        200
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      let status = 500;
      if (
        message.includes("GLM API Error: 401") ||
        message.includes('"code":"401"') ||
        message.includes("令牌已过期或验证不正确")
      ) {
        status = 401;
      }
      return jsonResponse(
        {
          error: message
        },
        status
      );
    }
  }
  return jsonResponse(
    {
      error: "未找到对应的 AI 接口"
    },
    404
  );
}

export { handleAiRequest };
