import {
  EDGE_KV_NAMESPACE,
  normalizePhone,
  parseJsonBody,
  generateId,
  getUserFromRequest,
  createSession,
  buildSessionCookie,
  buildClearSessionCookie,
  getSessionIdFromRequest,
  hashPassword,
  jsonResponse
} from "./common.js";

function normalizeEmailForLegacy(email) {
  return String(email).trim().toLowerCase();
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

function isValidPhone(phone) {
  const normalized = normalizePhone(phone);
  return normalized.length === 11 && normalized.startsWith("1");
}

async function handleSignup(request) {
  const body = await parseJsonBody(request);
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!phone || !password) {
    return jsonResponse(
      {
        error: "手机号和密码不能为空"
      },
      400
    );
  }

  if (!isValidPhone(phone)) {
    return jsonResponse(
      {
        error: "手机号格式不正确"
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
    const normalizedPhone = normalizePhone(phone);
    const edgeKV = new EdgeKV({ namespace: "SciStudio" });
    const phoneKey = `user_phone_${normalizedPhone}`;
    const existingUserId = await edgeKV.get(phoneKey, { type: "text" });
    if (existingUserId) {
      return jsonResponse(
        {
          error: "该手机号已被注册"
        },
        400
      );
    }

    const userId = generateId("u_");
    const passwordHash = hashPassword(password);
    const userRecord = {
      id: userId,
      phone: normalizedPhone,
      passwordHash,
      createdAt: Date.now()
    };

    await edgeKV.put(`user_${userId}`, JSON.stringify(userRecord));
    await edgeKV.put(phoneKey, userId);

    const sessionId = await createSession(userId);
    const cookie = buildSessionCookie(sessionId);

    return jsonResponse(
      {
        user: {
          id: userRecord.id,
          phone: userRecord.phone
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

async function handleLogin(request) {
  const body = await parseJsonBody(request);
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!phone || !password) {
    return jsonResponse(
      {
        error: "手机号和密码不能为空"
      },
      400
    );
  }

  if (!isValidPhone(phone)) {
    return jsonResponse(
      {
        error: "手机号或密码错误"
      },
      401
    );
  }

  try {
    const normalizedPhone = normalizePhone(phone);
    const edgeKV = new EdgeKV({ namespace: "SciStudio" });
    const phoneKey = `user_phone_${normalizedPhone}`;
    let userId = await edgeKV.get(phoneKey, { type: "text" });
    if (!userId) {
      if (normalizedPhone === "13135545221") {
        const legacyEmail = "1444@qq.com";
        const legacyEmailKey = `user_email_${normalizeEmailForLegacy(legacyEmail)}`;
        const legacyUserId = await edgeKV.get(legacyEmailKey, { type: "text" });
        if (legacyUserId) {
          userId = legacyUserId;
          await edgeKV.put(phoneKey, legacyUserId);
          const legacyUserRecord = await edgeKV.get(`user_${legacyUserId}`, { type: "json" });
          if (legacyUserRecord && typeof legacyUserRecord === "object") {
            legacyUserRecord.phone = normalizedPhone;
            await edgeKV.put(`user_${legacyUserId}`, JSON.stringify(legacyUserRecord));
          }
        }
      }
      if (!userId) {
        return jsonResponse(
          {
            error: "手机号或密码错误"
          },
          401
        );
      }
    }

    const userRecord = await edgeKV.get(`user_${userId}`, { type: "json" });
    if (!userRecord || typeof userRecord !== "object") {
      return jsonResponse(
        {
          error: "手机号或密码错误"
        },
        401
      );
    }

    const storedHash = userRecord.passwordHash;
    const currentHash = hashPassword(password);
    if (!storedHash || storedHash !== currentHash) {
      return jsonResponse(
        {
          error: "手机号或密码错误"
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
          phone: userRecord.phone ?? null
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
      const edgeKV = new EdgeKV({ namespace: "SciStudio" });
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

export { handleAuthRequest };
