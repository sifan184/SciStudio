import { createClient } from "@supabase/supabase-js";
import { ScienceArtifact, ChatMessage, ModelConfig } from "../types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const bucketName = "scistudio";
const publicProfilePath = "profiles/public.json";

interface CloudSnapshot {
  works: ScienceArtifact[];
  messagesMap: Record<string, ChatMessage[]>;
  selectedModelId: string | null;
  modelsWithoutKeys: Omit<ModelConfig, "apiKey">[];
}

const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export const loadCloudSnapshot = async (): Promise<CloudSnapshot | null> => {
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from(bucketName).download(publicProfilePath);
  if (error || !data) {
    return null;
  }
  const text = await data.text();
  try {
    const parsed = JSON.parse(text) as CloudSnapshot;
    return parsed;
  } catch {
    return null;
  }
};

export const saveCloudSnapshot = async (snapshot: CloudSnapshot): Promise<void> => {
  if (!supabase) return;
  const json = JSON.stringify(snapshot);
  const blob = new Blob([json], { type: "application/json" });

  await supabase.storage.from(bucketName).upload(publicProfilePath, blob, {
    upsert: true
  });
};
