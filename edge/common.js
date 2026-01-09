const EDGE_KV_NAMESPACE = "SciStudio";
const OSS_BUCKET_NAME = "scistudio";
const SESSION_COOKIE_NAME = "scistudio_session";
const WORKS_INDEX_KEY = "works_index";

let ESA_ENV = null;

function setEnv(env) {
  ESA_ENV = env;
}

function getEnv() {
  return ESA_ENV;
}

async function getOssClient() {
  if (!ESA_ENV || typeof ESA_ENV !== "object") {
    throw new Error("OSS env not available");
  }
  const region = ESA_ENV.OSS_REGION;
  const accessKeyId = ESA_ENV.OSS_ACCESS_KEY_ID;
  const accessKeySecret = ESA_ENV.OSS_ACCESS_KEY_SECRET;
  const bucket = ESA_ENV.OSS_BUCKET || OSS_BUCKET_NAME;
  if (!region || !accessKeyId || !accessKeySecret) {
    throw new Error("OSS credentials not configured");
  }
  const mod = await import("ali-oss");
  const OSS = mod.default || mod;
  return new OSS({
    region,
    accessKeyId,
    accessKeySecret,
    bucket
  });
}

async function saveWorkRecordToOss(record) {
  try {
    const client = await getOssClient();
    const key = `${record.id}.json`;
    const body = JSON.stringify(record);
    await client.put(key, body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    });
    return;
  } catch (e) {
  }
  const edgeKV = new EdgeKV({ namespace: EDGE_KV_NAMESPACE });
  const fallbackKey = `work_${record.id}_full`;
  await edgeKV.put(fallbackKey, JSON.stringify(record));
}

async function loadWorkRecordFromOss(workId) {
  try {
    const client = await getOssClient();
    const key = `${workId}.json`;
    try {
      const result = await client.get(key);
      const body = result.content;
      let text;
      if (typeof body === "string") {
        text = body;
      } else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        const decoder = new TextDecoder("utf-8");
        text = decoder.decode(body);
      } else {
        text = String(body);
      }
      return JSON.parse(text);
    } catch (e) {
      if (e && e.code === "NoSuchKey") {
        return null;
      }
      throw e;
    }
  } catch (e) {
  }
  const edgeKV = new EdgeKV({ namespace: EDGE_KV_NAMESPACE });
  const fallbackKey = `work_${workId}_full`;
  const text = await edgeKV.get(fallbackKey, { type: "text" });
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function deleteWorkRecordFromOss(workId) {
  try {
    const client = await getOssClient();
    const key = `${workId}.json`;
    try {
      await client.delete(key);
      return;
    } catch (e) {
      if (e && e.code === "NoSuchKey") {
        return;
      }
      throw e;
    }
  } catch (e) {
  }
  const edgeKV = new EdgeKV({ namespace: EDGE_KV_NAMESPACE });
  const fallbackKey = `work_${workId}_full`;
  try {
    await edgeKV.delete(fallbackKey);
  } catch {
  }
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

export {
  EDGE_KV_NAMESPACE,
  SESSION_COOKIE_NAME,
  WORKS_INDEX_KEY,
  setEnv,
  getEnv,
  getOssClient,
  saveWorkRecordToOss,
  loadWorkRecordFromOss,
  deleteWorkRecordFromOss,
  normalizeEmail,
  generateId,
  getSessionIdFromRequest,
  buildSessionCookie,
  buildClearSessionCookie,
  hashPassword,
  createSession,
  getUserFromSession,
  getUserFromRequest,
  parseJsonBody,
  jsonResponse
};
