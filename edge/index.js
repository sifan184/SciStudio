import { createClient } from "@supabase/supabase-js";

const EDGE_KV_NAMESPACE = "SciStudio";
let ESA_ENV = null;

const SESSION_COOKIE_NAME = "scistudio_session";
const WORKS_INDEX_KEY = "works_index";

function getSupabaseClient() {
  if (!ESA_ENV || typeof ESA_ENV !== "object") {
    throw new Error("Supabase env not available");
  }
  const url = ESA_ENV.SUPABASE_URL;
  const serviceKey = ESA_ENV.SUPABASE_SERVICE_ROLE_KEY || ESA_ENV.SUPABASE_ANON_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase credentials not configured");
  }
  return createClient(url, serviceKey, {
    auth: {
      persistSession: false
    }
  });
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function generateId(prefix) {
  const random = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}${time}_${random}`;
}

function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  const cookies = {};
  if (!header) {
    return cookies;
  }
  const parts = header.split(";");
  for (const part of parts) {
    const [rawName, ...rest] = part.split("=");
    if (!rawName) continue;
    const name = rawName.trim();
    const value = rest.join("=").trim();
    if (!name) continue;
    cookies[name] = value;
  }
  return cookies;
}

function getSessionIdFromRequest(request) {
  const cookies = parseCookies(request);
  const value = cookies[SESSION_COOKIE_NAME];
  if (!value) {
    return "";
  }
  return decodeURIComponent(value);
}

function buildSessionCookie(sessionId) {
  const maxAgeSeconds = 60 * 60 * 24 * 30;
  const encoded = encodeURIComponent(sessionId);
  return `${SESSION_COOKIE_NAME}=${encoded}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function buildClearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function hashPassword(password) {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const chr = password.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return hash.toString(16);
}

async function createSession(userId) {
  const edgeKV = new EdgeKV({ namespace: EDGE_KV_NAMESPACE });
  const sessionId = generateId("s_");
  const now = Date.now();
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000;
  const session = {
    id: sessionId,
    userId,
    createdAt: now,
    expiresAt
  };
  await edgeKV.put(`session_${sessionId}`, JSON.stringify(session));
  return sessionId;
}

async function getUserFromSession(sessionId) {
  if (!sessionId) {
    return null;
  }
  try {
    const edgeKV = new EdgeKV({ namespace: EDGE_KV_NAMESPACE });
    const session = await edgeKV.get(`session_${sessionId}`, { type: "json" });
    if (!session || typeof session !== "object") {
      return null;
    }
    if (typeof session.expiresAt === "number" && Date.now() > session.expiresAt) {
      return null;
    }
    const user = await edgeKV.get(`user_${session.userId}`, { type: "json" });
    if (!user || typeof user !== "object") {
      return null;
    }
    return {
      id: user.id,
      email: user.email ?? null
    };
  } catch (e) {
    return null;
  }
}

async function getUserFromRequest(request) {
  const sessionId = getSessionIdFromRequest(request);
  if (!sessionId) {
    return null;
  }
  return getUserFromSession(sessionId);
}

async function handleWorksRequest(request, url) {
  const path = url.pathname.replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);
  const hasId = segments.length === 3;
  if (!hasId) {
    if (request.method === "GET") {
      return handleWorksList();
    }
    if (request.method === "POST") {
      return handleWorkCreate(request);
    }
    return jsonResponse(
      {
        error: "不支持的作品接口方法"
      },
      405
    );
  }
  const workId = segments[segments.length - 1];
  if (!workId) {
    return jsonResponse(
      {
        error: "缺少作品ID"
      },
      400
    );
  }
  if (request.method === "GET") {
    return handleWorkGet(request, workId);
  }
  if (request.method === "PUT" || request.method === "PATCH") {
    return handleWorkUpdate(request, workId);
  }
  if (request.method === "DELETE") {
    return handleWorkDelete(request, workId);
  }
  return jsonResponse(
    {
      error: "不支持的作品接口方法"
    },
    405
  );
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

  if (pathname.includes("/api/auth/")) {
    return handleAuthRequest(request, url);
  }

  if (pathname.startsWith("/api/works")) {
    return handleWorksRequest(request, url);
  }

  return fetch(request);
}

async function handleAuthRequest(request, url) {
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) {
    path = path.replace(/\/+$/, "");
  }

  if (path.endsWith("/api/auth/user")) {
    if (request.method !== "GET") {
      return jsonResponse(
        {
          error: "仅支持 GET 请求"
        },
        405
      );
    }
    const user = await getUserFromRequest(request);
    return jsonResponse(
      {
        user: user
      },
      200
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

  if (path.endsWith("/api/auth/signup")) {
    return handleSignup(request);
  }

  if (path.endsWith("/api/auth/login")) {
    return handleLogin(request);
  }

  if (path.endsWith("/api/auth/logout")) {
    return handleLogout(request);
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

async function handleWorksList() {
  try {
    const edgeKV = new EdgeKV({ namespace: EDGE_KV_NAMESPACE });
    const list = await edgeKV.get(WORKS_INDEX_KEY, { type: "json" });
    if (!Array.isArray(list)) {
      return jsonResponse(
        {
          works: []
        },
        200
      );
    }
    return jsonResponse(
      {
        works: list
      },
      200
    );
  } catch (e) {
    return jsonResponse(
      {
        error: "读取作品列表失败"
      },
      500
    );
  }
}

async function handleWorkCreate(request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return jsonResponse(
      {
        error: "未登录"
      },
      401
    );
  }
  const body = await parseJsonBody(request);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const baseArtifact = typeof body.baseArtifact === "object" && body.baseArtifact !== null ? body.baseArtifact : null;
  const sourceWorkId = typeof body.sourceWorkId === "string" ? body.sourceWorkId : "";
  const now = Date.now();
  const workId = generateId("w_");
  const edgeKV = new EdgeKV({ namespace: EDGE_KV_NAMESPACE });
  const supabase = getSupabaseClient();

  let artifact = baseArtifact;
  let messages = null;

  if (!artifact && sourceWorkId) {
    const { data, error } = await supabase
      .from("works")
      .select("artifact,messages,title,description,created_at")
      .eq("id", sourceWorkId)
      .maybeSingle();
    if (!error && data && data.artifact) {
      artifact = data.artifact;
      messages = data.messages || null;
    }
  }

  if (!artifact) {
    artifact = {
      id: workId,
      createdAt: now,
      title: title || "未命名作品",
      description: description || "",
      code: "",
      ownerId: user.id,
      ownerEmail: user.email ?? null
    };
  } else {
    artifact = {
      ...artifact,
      id: workId,
      createdAt: now,
      ownerId: user.id,
      ownerEmail: user.email ?? null
    };
  }

  const supabasePayload = {
    id: workId,
    user_id: user.id,
    owner_email: user.email ?? null,
    title: artifact.title,
    description: artifact.description,
    code: artifact.code,
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    artifact,
    messages
  };

  const { error: insertError } = await supabase.from("works").insert(supabasePayload);
  if (insertError) {
    return jsonResponse(
      {
        error: "创建作品失败"
      },
      500
    );
  }

  let currentList = await edgeKV.get(WORKS_INDEX_KEY, { type: "json" });
  if (!Array.isArray(currentList)) {
    currentList = [];
  }
  const summary = {
    id: workId,
    title: artifact.title,
    description: artifact.description,
    createdAt: now,
    ownerId: user.id,
    ownerEmail: user.email ?? null
  };
  await edgeKV.put(WORKS_INDEX_KEY, JSON.stringify([summary, ...currentList]));
  await edgeKV.put(`work_${workId}_owner`, user.id);

  return jsonResponse(
    {
      work: {
        ...artifact
      }
    },
    200
  );
}

async function handleSignup(request) {
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

  try {
    const normalizedEmail = normalizeEmail(email);
    const edgeKV = new EdgeKV({ namespace: EDGE_KV_NAMESPACE });
    const emailKey = `user_email_${normalizedEmail}`;
    const existingUserId = await edgeKV.get(emailKey, { type: "text" });
    if (existingUserId) {
      return jsonResponse(
        {
          error: "该邮箱已被注册"
        },
        400
      );
    }

    const userId = generateId("u_");
    const passwordHash = hashPassword(password);
    const userRecord = {
      id: userId,
      email: normalizedEmail,
      passwordHash,
      createdAt: Date.now()
    };

    await edgeKV.put(`user_${userId}`, JSON.stringify(userRecord));
    await edgeKV.put(emailKey, userId);

    const sessionId = await createSession(userId);
    const cookie = buildSessionCookie(sessionId);

  return jsonResponse(
    {
      user: {
        id: userRecord.id,
        email: userRecord.email
      }
    },
    200,
    {
      "Set-Cookie": cookie
    }
  );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse(
      {
        error: `注册失败，请稍后重试：${message}`
      },
      500
    );
  }
}

async function handleWorkGet(request, workId) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("works")
    .select("id,user_id,owner_email,title,description,code,artifact,created_at,updated_at,messages")
    .eq("id", workId)
    .maybeSingle();
  if (error || !data) {
    return jsonResponse(
      {
        error: "作品不存在"
      },
      404
    );
  }
  const createdAt = data.artifact && typeof data.artifact.createdAt === "number" ? data.artifact.createdAt : Date.parse(data.created_at || "") || Date.now();
  const artifact = data.artifact && typeof data.artifact === "object"
    ? {
        ...data.artifact,
        id: data.id,
        ownerId: data.user_id,
        ownerEmail: data.owner_email ?? null,
        createdAt
      }
    : {
        id: data.id,
        createdAt,
        title: data.title || "",
        description: data.description || "",
        code: data.code || "",
        ownerId: data.user_id,
        ownerEmail: data.owner_email ?? null
      };
  return jsonResponse(
    {
      work: artifact,
      messages: data.messages || []
    },
    200
  );
}

async function handleWorkUpdate(request, workId) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return jsonResponse(
      {
        error: "未登录"
      },
      401
    );
  }
  const edgeKV = new EdgeKV({ namespace: EDGE_KV_NAMESPACE });
  const ownerId = await edgeKV.get(`work_${workId}_owner`, { type: "text" });
  if (!ownerId || ownerId !== user.id) {
    return jsonResponse(
      {
        error: "无权编辑此作品"
      },
      403
    );
  }
  const body = await parseJsonBody(request);
  const artifact = body.artifact && typeof body.artifact === "object" ? body.artifact : null;
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!artifact) {
    return jsonResponse(
      {
        error: "缺少作品内容"
      },
      400
    );
  }
  const supabase = getSupabaseClient();
  const nowIso = new Date().toISOString();
  const updatePayload = {
    title: artifact.title,
    description: artifact.description,
    code: artifact.code,
    updated_at: nowIso,
    artifact,
    messages
  };
  const { error } = await supabase.from("works").update(updatePayload).eq("id", workId);
  if (error) {
    return jsonResponse(
      {
        error: "更新作品失败"
      },
      500
    );
  }

  let list = await edgeKV.get(WORKS_INDEX_KEY, { type: "json" });
  if (Array.isArray(list)) {
    const updated = list.map((item) =>
      item && item.id === workId
        ? {
            ...item,
            title: artifact.title,
            description: artifact.description
          }
        : item
    );
    await edgeKV.put(WORKS_INDEX_KEY, JSON.stringify(updated));
  }

  return jsonResponse(
    {
      ok: true
    },
    200
  );
}

async function handleLogin(request) {
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

  try {
    const normalizedEmail = normalizeEmail(email);
    const edgeKV = new EdgeKV({ namespace: EDGE_KV_NAMESPACE });
    const emailKey = `user_email_${normalizedEmail}`;
    const userId = await edgeKV.get(emailKey, { type: "text" });
    if (!userId) {
      return jsonResponse(
        {
          error: "邮箱或密码错误"
        },
        401
      );
    }

    const userRecord = await edgeKV.get(`user_${userId}`, { type: "json" });
    if (!userRecord || typeof userRecord !== "object") {
      return jsonResponse(
        {
          error: "邮箱或密码错误"
        },
        401
      );
    }

    const storedHash = userRecord.passwordHash;
    const currentHash = hashPassword(password);
    if (!storedHash || storedHash !== currentHash) {
      return jsonResponse(
        {
          error: "邮箱或密码错误"
        },
        401
      );
    }

    const sessionId = await createSession(userRecord.id);
    const cookie = buildSessionCookie(sessionId);

  return jsonResponse(
    {
      user: {
        id: userRecord.id,
        email: userRecord.email ?? null
      }
    },
    200,
    {
      "Set-Cookie": cookie
    }
  );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse(
      {
        error: `登录失败，请稍后重试：${message}`
      },
      500
    );
  }
}

async function handleLogout(request) {
  const sessionId = getSessionIdFromRequest(request);
  if (sessionId) {
    try {
      const edgeKV = new EdgeKV({ namespace: EDGE_KV_NAMESPACE });
      await edgeKV.put(`session_${sessionId}`, "", {});
    } catch (e) {
    }
  }
  const cookie = buildClearSessionCookie();
  return jsonResponse(
    {
      ok: true
    },
    200,
    {
      "Set-Cookie": cookie
    }
  );
}

async function handleWorkDelete(request, workId) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return jsonResponse(
      {
        error: "未登录"
      },
      401
    );
  }
  const edgeKV = new EdgeKV({ namespace: EDGE_KV_NAMESPACE });
  const ownerId = await edgeKV.get(`work_${workId}_owner`, { type: "text" });
  if (!ownerId || ownerId !== user.id) {
    return jsonResponse(
      {
        error: "无权删除此作品"
      },
      403
    );
  }
  const supabase = getSupabaseClient();
  await supabase.from("works").delete().eq("id", workId);

  let list = await edgeKV.get(WORKS_INDEX_KEY, { type: "json" });
  if (Array.isArray(list)) {
    const filtered = list.filter((item) => item && item.id !== workId);
    await edgeKV.put(WORKS_INDEX_KEY, JSON.stringify(filtered));
  }
  await edgeKV.put(`work_${workId}_owner`, "", {});

  return jsonResponse(
    {
      ok: true
    },
    200
  );
}

function jsonResponse(body, status, extraHeaders) {
  const baseHeaders = {
    "content-type": "application/json; charset=utf-8"
  };
  const headers = extraHeaders
    ? {
        ...baseHeaders,
        ...extraHeaders
      }
    : baseHeaders;
  return new Response(JSON.stringify(body), {
    status,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    if (env && typeof env === "object") {
      ESA_ENV = env;
    }
    return handleRequest(request);
  }
};

export async function fetch(request, env, ctx) {
  if (env && typeof env === "object") {
    ESA_ENV = env;
  }
  return handleRequest(request);
}
