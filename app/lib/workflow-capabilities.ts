export type WorkflowInputDefinition = {
  key: string;
  label: string;
  required: boolean;
  valueType: "text" | "number" | "boolean" | "image" | "video" | "audio" | "json";
};

export type WorkflowOutputDefinition = {
  key: string;
  label: string;
  mediaType: "image" | "video" | "audio" | "json";
};

const capability = <
  const TKey extends string,
  const TInputs extends readonly WorkflowInputDefinition[],
  const TOutputs extends readonly WorkflowOutputDefinition[],
>(definition: { key: TKey; name: string; requirement: string; inputs: TInputs; outputs: TOutputs }) => definition;

export const workflowCapabilities = [
  capability({ key: "script_to_assets", name: "剧本资产拆解", requirement: "输入剧本，输出结构化角色、角色形态、场景、道具和出现集数", inputs: [
    { key: "script", label: "剧本文本", required: true, valueType: "text" },
  ], outputs: [{ key: "assets", label: "资产结构", mediaType: "json" }] }),
  capability({ key: "character_image", name: "角色标准图", requirement: "根据角色设定和参考图生成可复用的角色标准形象", inputs: [
    { key: "prompt", label: "角色设定", required: true, valueType: "text" },
    { key: "referenceImage", label: "参考图", required: false, valueType: "image" },
    { key: "aspectRatio", label: "画面比例", required: false, valueType: "text" },
    { key: "stylePreset", label: "视觉风格", required: false, valueType: "text" },
  ], outputs: [{ key: "image", label: "角色标准图", mediaType: "image" }] }),
  capability({ key: "scene_image", name: "场景标准图", requirement: "根据场景设定生成稳定的场景参考图", inputs: [
    { key: "prompt", label: "场景设定", required: true, valueType: "text" },
    { key: "referenceImage", label: "参考图", required: false, valueType: "image" },
    { key: "aspectRatio", label: "画面比例", required: false, valueType: "text" },
    { key: "stylePreset", label: "视觉风格", required: false, valueType: "text" },
  ], outputs: [{ key: "image", label: "场景标准图", mediaType: "image" }] }),
  capability({ key: "storyboard_frame", name: "分镜首帧", requirement: "引用角色、场景和道具资产生成单个分镜首帧", inputs: [
    { key: "prompt", label: "分镜描述", required: true, valueType: "text" },
    { key: "characterImages", label: "角色参考图", required: false, valueType: "json" },
    { key: "sceneImage", label: "场景参考图", required: false, valueType: "image" },
    { key: "aspectRatio", label: "画面比例", required: false, valueType: "text" },
    { key: "stylePreset", label: "视觉风格", required: false, valueType: "text" },
  ], outputs: [{ key: "image", label: "分镜首帧", mediaType: "image" }] }),
  capability({ key: "image_to_video", name: "图生视频", requirement: "根据分镜首帧、动作描述和时长生成视频片段", inputs: [
    { key: "firstFrame", label: "分镜首帧", required: true, valueType: "image" },
    { key: "prompt", label: "动作描述", required: true, valueType: "text" },
    { key: "duration", label: "片段时长", required: false, valueType: "number" },
    { key: "promptEnhance", label: "动作提示增强", required: false, valueType: "boolean" },
  ], outputs: [{ key: "video", label: "分镜视频", mediaType: "video" }] }),
  capability({ key: "voice_synthesis", name: "固定角色音色", requirement: "根据角色音色标识与台词生成稳定一致的人声", inputs: [
    { key: "text", label: "角色台词", required: true, valueType: "text" },
    { key: "voiceReference", label: "音色参考", required: true, valueType: "audio" },
    { key: "voiceDescription", label: "音色描述", required: false, valueType: "text" },
  ], outputs: [{ key: "audio", label: "角色人声", mediaType: "audio" }] }),
  capability({ key: "lip_sync", name: "口型同步", requirement: "输入视频和角色人声，输出与台词同步的口型视频", inputs: [
    { key: "video", label: "人物视频", required: true, valueType: "video" },
    { key: "audio", label: "最终人声", required: true, valueType: "audio" },
  ], outputs: [{ key: "video", label: "口型视频", mediaType: "video" }] }),
  capability({ key: "native_audio_video", name: "原生有声视频", requirement: "一次生成带对白、动作声和环境声的视频片段", inputs: [
    { key: "firstFrame", label: "分镜首帧", required: true, valueType: "image" },
    { key: "prompt", label: "声音与动作描述", required: true, valueType: "text" },
  ], outputs: [{ key: "video", label: "原生有声视频", mediaType: "video" }] }),
  capability({ key: "ambient_audio", name: "环境声音场", requirement: "根据场景声音预设生成可跨分镜复用的环境底声", inputs: [
    { key: "prompt", label: "声音场描述", required: true, valueType: "text" },
    { key: "duration", label: "持续时长", required: true, valueType: "number" },
    { key: "referenceAudio", label: "参考声音", required: false, valueType: "audio" },
  ], outputs: [{ key: "audio", label: "环境底声", mediaType: "audio" }] }),
  capability({ key: "episode_compose", name: "单集合成", requirement: "按分镜顺序合成视频、对白、环境声和字幕", inputs: [
    { key: "timeline", label: "分镜时间线", required: true, valueType: "json" },
    { key: "subtitles", label: "字幕数据", required: false, valueType: "json" },
  ], outputs: [{ key: "video", label: "单集成片", mediaType: "video" }] }),
] as const;

export type WorkflowCapability = typeof workflowCapabilities[number]["key"];

export function isWorkflowCapability(value: string): value is WorkflowCapability {
  return workflowCapabilities.some((item) => item.key === value);
}

export function getWorkflowCapability(value: string) {
  return workflowCapabilities.find((item) => item.key === value);
}
