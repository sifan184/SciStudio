import {
  EDGE_KV_NAMESPACE,
  WORKS_INDEX_KEY,
  saveWorkRecordToOss,
  loadWorkRecordFromOss,
  deleteWorkRecordFromOss,
  getUserFromRequest,
  generateId,
  parseJsonBody,
  jsonResponse
} from "./common.js";

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

async function handleWorksList() {
  try {
    const edgeKV = new EdgeKV({ namespace: "SciStudio" });
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
  const edgeKV = new EdgeKV({ namespace: "SciStudio" });

  let artifact = baseArtifact;
  let messages = null;

  if (!artifact && sourceWorkId) {
    const sourceRecord = await loadWorkRecordFromOss(sourceWorkId);
    if (sourceRecord && sourceRecord.artifact) {
      artifact = sourceRecord.artifact;
      messages = sourceRecord.messages || null;
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
      ownerPhone: user.phone ?? null
    };
  } else {
    artifact = {
      ...artifact,
      id: workId,
      createdAt: now,
      ownerId: user.id,
      ownerPhone: user.phone ?? null
    };
  }

  const record = {
    id: workId,
    userId: user.id,
    ownerPhone: user.phone ?? null,
    artifact,
    messages
  };

  try {
    await saveWorkRecordToOss({
      ...record,
      createdAt: now,
      updatedAt: now
    });
  } catch (e) {
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
    ownerPhone: user.phone ?? null
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

async function handleWorkGet(request, workId) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return jsonResponse(
      {
        error: "未登录"
      },
      401
    );
  }
  const record = await loadWorkRecordFromOss(workId);
  if (!record || !record.artifact) {
    try {
      const edgeKV = new EdgeKV({ namespace: "SciStudio" });
      let list = await edgeKV.get(WORKS_INDEX_KEY, { type: "json" });
      if (Array.isArray(list)) {
        const filtered = list.filter((item) => item && item.id !== workId);
        await edgeKV.put(WORKS_INDEX_KEY, JSON.stringify(filtered));
      }
      await edgeKV.put(`work_${workId}_owner`, "", {});
    } catch (e) {
    }
    return jsonResponse(
      {
        error: "作品不存在"
      },
      404
    );
  }
  const baseArtifact = record.artifact && typeof record.artifact === "object" ? record.artifact : {};
  const createdAt =
    typeof baseArtifact.createdAt === "number"
      ? baseArtifact.createdAt
      : typeof record.createdAt === "number"
      ? record.createdAt
      : Date.now();
  const artifact = {
    ...baseArtifact,
    id: record.id,
    ownerId: record.userId,
    ownerPhone: record.ownerPhone ?? null,
    createdAt
  };
  return jsonResponse(
    {
      work: artifact,
      messages: Array.isArray(record.messages) ? record.messages : []
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
  const edgeKV = new EdgeKV({ namespace: "SciStudio" });
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
  const existing = await loadWorkRecordFromOss(workId);
  if (!existing) {
    return jsonResponse(
      {
        error: "作品不存在"
      },
      404
    );
  }
  const now = Date.now();
  const updatedRecord = {
    id: workId,
    userId: existing.userId,
    ownerPhone: existing.ownerPhone ?? user.phone ?? null,
    createdAt: typeof existing.createdAt === "number" ? existing.createdAt : now,
    updatedAt: now,
    artifact,
    messages
  };
  try {
    await saveWorkRecordToOss(updatedRecord);
  } catch (e) {
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
  const edgeKV = new EdgeKV({ namespace: "SciStudio" });
  let ownerId = "";
  try {
    ownerId = await edgeKV.get(`work_${workId}_owner`, { type: "text" });
  } catch (e) {
  }
  if (!ownerId || ownerId !== user.id) {
    return jsonResponse(
      {
        error: "无权删除此作品"
      },
      403
    );
  }
  try {
    await deleteWorkRecordFromOss(workId);
  } catch (e) {
  }

  try {
    let list = await edgeKV.get(WORKS_INDEX_KEY, { type: "json" });
    if (Array.isArray(list)) {
      const filtered = list.filter((item) => item && item.id !== workId);
      await edgeKV.put(WORKS_INDEX_KEY, JSON.stringify(filtered));
    }
  } catch (e) {
  }
  try {
    await edgeKV.put(`work_${workId}_owner`, "", {});
  } catch (e) {
  }

  return jsonResponse(
    {
      ok: true
    },
    200
  );
}

export { handleWorksRequest };
