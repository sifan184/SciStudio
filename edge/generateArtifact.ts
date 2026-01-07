import { generateScienceArtifactInternal } from "../services/geminiService";
import { ModelConfig, ScienceArtifact, ChatMessage, GenerationResponse } from "../types";

type EdgeGenerateRequest = {
  prompt: string;
  images?: string[];
  modelConfig: ModelConfig;
  currentArtifact?: ScienceArtifact | null;
  history?: ChatMessage[];
};

export async function handleEdgeGenerateArtifact(
  payload: EdgeGenerateRequest
): Promise<GenerationResponse> {
  const prompt = payload.prompt || "";
  const images = Array.isArray(payload.images) ? payload.images : [];
  const modelConfig = payload.modelConfig;
  const currentArtifact = payload.currentArtifact ?? null;
  const history = Array.isArray(payload.history) ? payload.history : [];
  return generateScienceArtifactInternal(prompt, images, modelConfig, currentArtifact, history);
}

export default async function generateArtifactEntry(request: any): Promise<any> {
  if (!request || typeof request.json !== "function") {
    throw new Error("Edge entry expects a Request-like object with json() method");
  }
  const body = (await request.json()) as EdgeGenerateRequest;
  const result = await handleEdgeGenerateArtifact(body);
  if (typeof Response !== "undefined") {
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  return result;
}

