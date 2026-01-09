const EDGE_KV_NAMESPACE = "947407923057872896";
let ESA_ENV = null;

const SESSION_COOKIE_NAME = "scistudio_session";

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
    const existingUserId = await edgeKV.get(emailKey);
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
    return jsonResponse(
      {
        error: "注册失败，请稍后重试"
      },
      500
    );
  }
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
    const userId = await edgeKV.get(emailKey);
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
    return jsonResponse(
      {
        error: "登录失败，请稍后重试"
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
