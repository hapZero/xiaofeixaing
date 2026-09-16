type WorkflowDocument = Record<string, { inputs?: Record<string, unknown>; class_type?: string; [key: string]: unknown }>;
export type ComfyOutputFile = { filename: string; subfolder?: string; type?: string; outputKey?: string; nodeId?: string };

export function saveImageNodeIds(workflow: WorkflowDocument | null | undefined) {
  if (!workflow) return [];
  return Object.entries(workflow)
    .filter(([, node]) => /saveimage/i.test(String(node.class_type ?? "")))
    .map(([nodeId]) => nodeId);
}

export function selectAllWorkflowImageOutputs(record: Record<string, unknown>, workflow?: WorkflowDocument | null): ComfyOutputFile[] {
  const outputs = record.outputs as Record<string, Record<string, unknown>> | undefined;
  if (!outputs) return [];
  const allowedNodes = workflow ? new Set(saveImageNodeIds(workflow)) : null;
  const files: ComfyOutputFile[] = [];
  const seen = new Set<string>();
  for (const [nodeId, nodeOutput] of Object.entries(outputs)) {
    if (allowedNodes && !allowedNodes.has(nodeId)) continue;
    for (const [outputKey, candidates] of Object.entries(nodeOutput)) {
      if (!Array.isArray(candidates)) continue;
      for (const candidate of candidates) {
        const file = candidate as Partial<ComfyOutputFile> & { type?: string };
        if (!file?.filename || !/\.(png|jpe?g|webp|gif)$/i.test(file.filename)) continue;
        if (file.type === "input") continue;
        const dedupeKey = `${file.subfolder ?? ""}:${file.filename}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        files.push({ filename: file.filename, subfolder: file.subfolder, type: file.type, outputKey, nodeId });
      }
    }
  }
  return files;
}
