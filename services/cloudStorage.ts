import { ScienceArtifact, ChatMessage, ModelConfig } from "../types";

interface CloudSnapshot {
  works: ScienceArtifact[];
  messagesMap: Record<string, ChatMessage[]>;
  selectedModelId: string | null;
  modelsWithoutKeys: Omit<ModelConfig, "apiKey">[];
}

export const loadCloudSnapshot = async (userId: string | null): Promise<CloudSnapshot | null> => {
  if (!userId) return null;
  try {
    const params = new URLSearchParams({ userId });
    const res = await fetch(`/api/cloud/snapshot?${params.toString()}`, {
      method: "GET",
      credentials: "include"
    });
    if (!res.ok) {
      return null;
    }
    const json = await res.json().catch(() => null);
    if (!json || typeof json !== "object") {
      return null;
    }
    if (!("snapshot" in json) || json.snapshot == null) {
      return null;
    }
    return json.snapshot as CloudSnapshot;
  } catch {
    return null;
  }
};

export const saveCloudSnapshot = async (userId: string | null, snapshot: CloudSnapshot): Promise<void> => {
  if (!userId) return;
  try {
    await fetch("/api/cloud/snapshot", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify({
        userId,
        snapshot
      })
    });
  } catch {
  }
};
