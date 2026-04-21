export function explainError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Something went wrong.");
  const normalized = message.toLowerCase();

  if (normalized.includes("file upload node requires runtime file paths")) {
    return "This workflow needs a file before it can run. Attach a document in the File Upload block or use the workflow app URL with an upload form.";
  }
  if (normalized.includes("openrouter_api_key") || normalized.includes("api key")) {
    return "The LLM provider is not ready. Add OPENROUTER_API_KEY to your backend .env, restart FastAPI, then run again.";
  }
  if (normalized.includes("rag") || normalized.includes("knowledge") || normalized.includes("chunks")) {
    return "The RAG step did not find usable knowledge. Ingest a document into the configured collection, then test retrieval from the Knowledge tab.";
  }
  if (normalized.includes("not compatible") || normalized.includes("ports")) {
    return "Those blocks cannot connect because their port data types do not match. Use Merge, Text Extraction, RAG, or an AI block to transform the payload first.";
  }
  if (normalized.includes("missing required config")) {
    return "A block is missing required configuration. Open the builder, select the highlighted node, and complete its settings panel.";
  }

  return message;
}
