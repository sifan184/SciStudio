import { createClient } from "@supabase/supabase-js";

const EDGE_KV_NAMESPACE = "947407923057872896";

function getSupabaseClient() {
  try {
    const url = (globalThis as any).SUPABASE_URL || "";
    const key = (globalThis as any).SUPABASE_ANON_KEY || "";
    if (!url || !key) {
      return null;
    }
    return createClient(url, key);
  } catch {
    return null;
  }
}

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

  if (pathname.endsWith("/api/cloud/snapshot")) {
    return handleCloudSnapshot(request, url);
  }

  if (pathname.includes("/api/auth/")) {
    return handleAuthRequest(request, url);
  }

  return fetch(request);
}

async function handleAuthRequest(request, url) {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return jsonResponse(
      {
        error: "Supabase 未配置，请在 ESA 环境变量中设置 SUPABASE_URL 和 SUPABASE_ANON_KEY"
      },
      500
    );
  }

  if (request.method !== "POST") {
    return jsonResponse(
      {
        error: "仅支持 POST 请求"
      },
      405
    );
  }

  const path = url.pathname;

  if (path.endsWith("/api/auth/signup")) {
    return handleSignup(request, supabase);
  }

  if (path.endsWith("/api/auth/login")) {
    return handleLogin(request, supabase);
  }

  if (path.endsWith("/api/auth/logout")) {
    return handleLogout();
  }

  return jsonResponse(
    {
      error: "未找到对应的认证接口"
    },
    404
  );
}

async function parseJsonBody(request) {
  try {
    const text = await request.text();
    if (!text) {
      return {};
    }
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function handleSignup(request, supabase) {
  const body = await parseJsonBody(request);
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return jsonResponse(
      {
        error: "邮箱和密码不能为空"
      },
      400
    );
  }

  if (password.length < 6) {
    return jsonResponse(
      {
        error: "密码长度至少为 6 位"
      },
      400
    );
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password
  });

  if (error) {
    return jsonResponse(
      {
        error: error.message
      },
      400
    );
  }

  return jsonResponse(
    {
      user: data.user ?? null,
      session: data.session ?? null
    },
    200
  );
}

async function handleLogin(request, supabase) {
  const body = await parseJsonBody(request);
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return jsonResponse(
      {
        error: "邮箱和密码不能为空"
      },
      400
    );
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    return jsonResponse(
      {
        error: error.message
      },
      401
    );
  }

  return jsonResponse(
    {
      user: data.user ?? null,
      session: data.session ?? null
    },
    200
  );
}

async function handleLogout() {
  return jsonResponse(
    {
      ok: true
    },
    200
  );
}

async function handleCloudSnapshot(request, url) {
  if (request.method === "GET") {
    return handleCloudSnapshotGet(url);
  }

  if (request.method === "POST") {
    return handleCloudSnapshotPost(request);
  }

  return jsonResponse(
    {
      error: "仅支持 GET 和 POST 请求"
    },
    405
  );
}

async function handleCloudSnapshotGet(url) {
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return jsonResponse(
      {
        error: "必须提供 userId"
      },
      400
    );
  }

  try {
    const edgeKV = new EdgeKV({ namespace: EDGE_KV_NAMESPACE });
    const key = `user_${userId}_snapshot`;
    const value = await edgeKV.get(key, { type: "json" });

    if (value === undefined) {
      return jsonResponse(
        {
          snapshot: null
        },
        200
      );
    }

    return jsonResponse(
      {
        snapshot: value
      },
      200
    );
  } catch (e) {
    return jsonResponse(
      {
        error: "读取云端快照失败"
      },
      500
    );
  }
}

async function handleCloudSnapshotPost(request) {
  const body = await parseJsonBody(request);
  const userId = typeof body.userId === "string" ? body.userId : "";
  const snapshot = body.snapshot;

  if (!userId) {
    return jsonResponse(
      {
        error: "必须提供 userId"
      },
      400
    );
  }

  if (!snapshot || typeof snapshot !== "object") {
    return jsonResponse(
      {
        error: "snapshot 内容无效"
      },
      400
    );
  }

  try {
    const edgeKV = new EdgeKV({ namespace: EDGE_KV_NAMESPACE });
    const key = `user_${userId}_snapshot`;
    const value = JSON.stringify(snapshot);
    await edgeKV.put(key, value);

    return jsonResponse(
      {
        ok: true
      },
      200
    );
  } catch (e) {
    return jsonResponse(
      {
        error: "保存云端快照失败"
      },
      500
    );
  }
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

export default {
  async fetch(request) {
    return handleRequest(request);
  }
};
