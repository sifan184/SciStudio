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

const createJsonResponse = (data: any, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
};

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return createJsonResponse({ error: "Method Not Allowed" }, 405);
    }

    let body: EdgeGenerateRequest;
    try {
      body = (await request.json()) as EdgeGenerateRequest;
    } catch {
      return createJsonResponse({ error: "Invalid JSON body" }, 400);
    }

    try {
      const result = await handleEdgeGenerateArtifact(body);
      return createJsonResponse(result, 200);
    } catch (e: any) {
      const message = e instanceof Error ? e.message : String(e);
      return createJsonResponse({ error: message }, 500);
    }
  }
};
