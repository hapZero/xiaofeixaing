export function describeGenerationError(message?: string | null) {
  if (!message) return "请检查工作流参数和输出映射";
  if (message.startsWith("COMFYUI_EXECUTION_FAILED:")) {
    const detail = message.slice("COMFYUI_EXECUTION_FAILED:".length).trim();
    return detail || "ComfyUI 工作流执行失败，请查看 Spark 节点日志";
  }
  if (message === "COMFYUI_EXECUTION_FAILED") return "ComfyUI 工作流执行失败，请查看 Spark 节点日志";
  if (message.startsWith("COMFYUI_INPUT_UPLOAD_FAILED:")) {
    return "参考图占位上传失败，请确认 Spark 可访问且 upload/image 接口可用";
  }
  if (message.startsWith("COMFYUI_QUEUE_FAILED:")) {
    const detail = message.slice("COMFYUI_QUEUE_FAILED:".length).replace(/^\d+:?/, "").trim();
    return detail ? `ComfyUI 拒绝了这次工作流：${detail}` : "ComfyUI 拒绝了这次工作流，请检查字段映射与参考图数量";
  }
  if (message.startsWith("WORKFLOW_OUTPUT_MISSING")) {
    return "工作流没有产出可用图片/音频，请检查输出节点映射是否在设置里绑定到 SaveImage 或 PreviewAudio";
  }
  if (message.startsWith("WORKFLOW_INPUT_NOT_APPLIED:")) {
    const detail = message.slice("WORKFLOW_INPUT_NOT_APPLIED:".length);
    if (/characterImages|sceneImage|referenceImages|propImages/.test(detail)) {
      return "参考图没有写进 ComfyUI 工作流，请在设置里重新保存绑定并测试";
    }
    return "工作流输入没有生效，请在设置里检查字段映射后重新测试";
  }
  if (message.startsWith("WORKFLOW_INPUT_NOT_MAPPED:")) {
    return `工作流绑定缺少必填映射：${message.slice("WORKFLOW_INPUT_NOT_MAPPED:".length)}`;
  }
  if (message.startsWith("WORKFLOW_NOT_VERIFIED") || message.includes("需要先绑定并通过一次真实测试")) {
    return message;
  }
  if (message.startsWith("CHARACTER_REFERENCE_REQUIRED") || message.includes("人物一致性需要已有参考图")) {
    return message;
  }
  return message;
}
