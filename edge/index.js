import { setEnv, getEnv, jsonResponse, EDGE_KV_NAMESPACE, WORKS_INDEX_KEY } from "./common.js";
import { handleAuthRequest } from "./auth.js";
import { handleWorksRequest } from "./works.js";

async function handleMigrateKvWorks(request, url) {
  if (request.method !== "POST") {
    return jsonResponse(
      {
        error: "仅支持 POST 请求"
      },
      405
    );
  }
  const env = getEnv() || {};
  const adminToken = env.ADMIN_TOKEN || "";
  if (adminToken) {
    const headerToken = request.headers.get("x-admin-token") || "";
    const queryToken = url.searchParams.get("token") || "";
    const token = headerToken || queryToken;
    if (!token || token !== adminToken) {
      return jsonResponse(
        {
          error: "未授权的迁移请求"
        },
        401
      );
    }
  }
  const legacyNamespace = env.EDGE_KV_NAMESPACE || EDGE_KV_NAMESPACE;
  const workInfoNamespace = env.WORKINFO_KV_NAMESPACE;
  if (!legacyNamespace || !workInfoNamespace) {
    return jsonResponse(
      {
        error: "KV 命名空间未配置"
      },
      500
    );
  }
  const legacyKV = new EdgeKV({ namespace: legacyNamespace });
  const workInfoKV = new EdgeKV({ namespace: workInfoNamespace });
  let list = await legacyKV.get(WORKS_INDEX_KEY, { type: "json" });
  if (!Array.isArray(list)) {
    list = [];
  }
  let migrated = 0;
  let skipped = 0;
  let missing = 0;
  for (const item of list) {
    if (!item || typeof item.id !== "string") {
      continue;
    }
    const workId = item.id;
    const key = `work_${workId}_full`;
    const value = await legacyKV.get(key, { type: "text" });
    if (!value) {
      missing++;
      continue;
    }
    const exists = await workInfoKV.get(key, { type: "text" });
    if (exists) {
      skipped++;
      continue;
    }
    await workInfoKV.put(key, value);
    migrated++;
  }
  return jsonResponse(
    {
      ok: true,
      totalFromIndex: list.length,
      migrated,
      skipped,
      missing
    },
    200
  );
}

async function handleRequest(request) {
  const url = new URL(request.url);
  let pathname = url.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.replace(/\/+$/, "");
  }

  if (pathname.endsWith("/api/health")) {
    return jsonResponse(
      {
        ok: true
      },
      200
    );
  }

  if (pathname.endsWith("/api/admin/migrate-kv-works")) {
    return handleMigrateKvWorks(request, url);
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
