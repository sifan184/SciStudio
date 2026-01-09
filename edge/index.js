import { setEnv, jsonResponse } from "./common.js";
import { handleAuthRequest } from "./auth.js";
import { handleWorksRequest } from "./works.js";

async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname.endsWith("/api/health")) {
    return jsonResponse(
      {
        ok: true
      },
      200
    );
  }

  if (pathname.includes("/api/auth/")) {
    return handleAuthRequest(request, url);
  }

  if (pathname.startsWith("/api/works")) {
    return handleWorksRequest(request, url);
  }

  return globalThis.fetch(request);
}

async function handleRequestSafe(request) {
  try {
    return await handleRequest(request);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse(
      {
        error: `服务内部错误：${message}`
      },
      500
    );
  }
}

export default {
  async fetch(request, env, ctx) {
    if (env && typeof env === "object") {
      setEnv(env);
    }
    return handleRequestSafe(request);
  }
};
