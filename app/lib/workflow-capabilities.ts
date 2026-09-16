export type WorkflowInputDefinition = {
  key: string;
  label: string;
  required: boolean;
  valueType: "text" | "number" | "boolean" | "image" | "imageList" | "video" | "audio" | "json";
};

export type WorkflowOutputDefinition = {
  key: string;
  label: string;
  mediaType: "image" | "video" | "audio" | "json";
};

export type CapabilityMediaDomain = "image" | "video" | "audio" | "service";

export type CapabilityProductionRequirement = boolean | "route_dependent" | "optional";

export type SettingsSection =
  | "readiness"
  | "text"
  | "comfyui"
  | "image"
  | "video"
  | "audio"
  | "edit"
  | "routing";

type CapabilityDefinition = {
  key: string;
  name: string;
  requirement: string;
  mediaDomain: CapabilityMediaDomain;
  mainlineSteps: readonly number[];
  settingsSection: SettingsSection;
  menuLabel: string;
  requiredForProduction: CapabilityProductionRequirement;
  inputs: readonly WorkflowInputDefinition[];
  outputs: readonly WorkflowOutputDefinition[];
  bindingKey?: string;
};

const capability = (definition: CapabilityDefinition) => definition;

export const workflowCapabilities = [
  capability({
    key: "image_generation",
    name: "文生图",
    requirement: "仅根据文字描述生成图片，不依赖参考图",
    mediaDomain: "image",
    mainlineSteps: [3, 5],
    settingsSection: "image",
    menuLabel: "文生图",
    requiredForProduction: "optional",
    inputs: [
      { key: "prompt", label: "画面描述", required: true, valueType: "text" },
      { key: "aspectRatio", label: "画面比例", required: false, valueType: "text" },
      { key: "stylePreset", label: "视觉风格", required: false, valueType: "text" },
    ],
    outputs: [{ key: "image", label: "生成图片", mediaType: "image" }],
  }),
  capability({
    key: "single_reference_image",
    name: "单参考图生图",
    requirement: "基于一张参考图生成保持风格/构图的新图",
    mediaDomain: "image",
    mainlineSteps: [3, 5],
    settingsSection: "image",
    menuLabel: "单参考图生图",
    requiredForProduction: "optional",
    bindingKey: "image_generation",
    inputs: [
      { key: "prompt", label: "画面描述", required: true, valueType: "text" },
      { key: "referenceImage", label: "参考图", required: true, valueType: "image" },
      { key: "aspectRatio", label: "画面比例", required: false, valueType: "text" },
    ],
    outputs: [{ key: "image", label: "生成图片", mediaType: "image" }],
  }),
  capability({
    key: "multi_reference_image",
    name: "多参考图生图",
    requirement: "基于多张参考图生成合成画面",
    mediaDomain: "image",
    mainlineSteps: [3, 5],
    settingsSection: "image",
    menuLabel: "多参考图生图",
    requiredForProduction: "optional",
    bindingKey: "storyboard_frame",
    inputs: [
      { key: "prompt", label: "画面描述", required: true, valueType: "text" },
      { key: "referenceImages", label: "参考图组", required: true, valueType: "imageList" },
      { key: "aspectRatio", label: "画面比例", required: false, valueType: "text" },
    ],
    outputs: [{ key: "image", label: "生成图片", mediaType: "image" }],
  }),
  capability({
    key: "character_image",
    name: "人物一致性生成器",
    requirement: "一次运行输出完整角色标准图包：主标准图、三视图 turnaround、表情特写、姿势等；工作流内部已写好各分支提示词，只需绑定并测试此工作流",
    mediaDomain: "image",
    mainlineSteps: [3],
    settingsSection: "image",
    menuLabel: "人物一致性生成器",
    requiredForProduction: true,
    inputs: [
      { key: "prompt", label: "角色描述（PROMPT）", required: true, valueType: "text" },
      { key: "referenceImage", label: "可选参考图", required: false, valueType: "image" },
    ],
    outputs: [{ key: "imagePack", label: "标准图包（多图）", mediaType: "image" }],
  }),
  capability({
    key: "scene_image",
    name: "场景图",
    requirement: "生产流程中由文生图能力生成，提示词区分场景与道具，无需单独绑定",
    mediaDomain: "image",
    mainlineSteps: [3],
    settingsSection: "image",
    menuLabel: "场景图",
    requiredForProduction: true,
    bindingKey: "image_generation",
    inputs: [
      { key: "prompt", label: "场景设定", required: true, valueType: "text" },
      { key: "referenceImage", label: "可选构图参考", required: false, valueType: "image" },
      { key: "aspectRatio", label: "画面比例", required: false, valueType: "text" },
      { key: "stylePreset", label: "视觉风格", required: false, valueType: "text" },
    ],
    outputs: [{ key: "image", label: "场景标准图", mediaType: "image" }],
  }),
  capability({
    key: "prop_image",
    name: "道具图",
    requirement: "根据道具描述生成可复用道具参考图",
    mediaDomain: "image",
    mainlineSteps: [3],
    settingsSection: "image",
    menuLabel: "道具图",
    requiredForProduction: "optional",
    bindingKey: "image_generation",
    inputs: [
      { key: "prompt", label: "道具描述", required: true, valueType: "text" },
      { key: "aspectRatio", label: "画面比例", required: false, valueType: "text" },
      { key: "stylePreset", label: "视觉风格", required: false, valueType: "text" },
    ],
    outputs: [{ key: "image", label: "道具图", mediaType: "image" }],
  }),
  capability({
    key: "storyboard_frame",
    name: "分镜图（多参考）",
    requirement: "引用角色、场景和道具资产生成分镜首帧",
    mediaDomain: "image",
    mainlineSteps: [5],
    settingsSection: "image",
    menuLabel: "分镜图（多参考）",
    requiredForProduction: true,
    inputs: [
      { key: "prompt", label: "分镜描述", required: true, valueType: "text" },
      { key: "characterImages", label: "角色参考图", required: false, valueType: "imageList" },
      { key: "sceneImage", label: "场景参考图", required: false, valueType: "image" },
      { key: "propImages", label: "道具参考图组", required: false, valueType: "imageList" },
      { key: "referenceImages", label: "全部视觉参考图", required: false, valueType: "imageList" },
      { key: "aspectRatio", label: "画面比例", required: false, valueType: "text" },
      { key: "stylePreset", label: "视觉风格", required: false, valueType: "text" },
    ],
    outputs: [{ key: "image", label: "分镜首帧", mediaType: "image" }],
  }),
  capability({
    key: "multi_character_storyboard",
    name: "多角色分镜",
    requirement: "多角色同框分镜，避免串脸",
    mediaDomain: "image",
    mainlineSteps: [5],
    settingsSection: "image",
    menuLabel: "多角色分镜",
    requiredForProduction: "optional",
    bindingKey: "storyboard_frame",
    inputs: [
      { key: "prompt", label: "分镜描述", required: true, valueType: "text" },
      { key: "characterImages", label: "角色参考图", required: true, valueType: "imageList" },
      { key: "sceneImage", label: "场景参考图", required: false, valueType: "image" },
    ],
    outputs: [{ key: "image", label: "多角色分镜图", mediaType: "image" }],
  }),
  capability({
    key: "last_frame_image",
    name: "首帧生尾帧",
    requirement: "由首帧和动作结果描述生成尾帧",
    mediaDomain: "image",
    mainlineSteps: [5],
    settingsSection: "image",
    menuLabel: "首帧生尾帧",
    requiredForProduction: "route_dependent",
    bindingKey: "image_generation",
    inputs: [
      { key: "firstFrame", label: "首帧", required: true, valueType: "image" },
      { key: "prompt", label: "动作结果描述", required: true, valueType: "text" },
    ],
    outputs: [{ key: "image", label: "尾帧", mediaType: "image" }],
  }),
  capability({
    key: "image_edit",
    name: "分镜改图",
    requirement: "按修改要求编辑已有分镜图",
    mediaDomain: "image",
    mainlineSteps: [5],
    settingsSection: "image",
    menuLabel: "分镜改图",
    requiredForProduction: "optional",
    bindingKey: "image_generation",
    inputs: [
      { key: "referenceImage", label: "原分镜图", required: true, valueType: "image" },
      { key: "prompt", label: "修改要求", required: true, valueType: "text" },
    ],
    outputs: [{ key: "image", label: "修改后分镜", mediaType: "image" }],
  }),
  capability({
    key: "inpaint_image",
    name: "局部重绘",
    requirement: "对分镜图指定区域进行局部修改",
    mediaDomain: "image",
    mainlineSteps: [5],
    settingsSection: "image",
    menuLabel: "局部重绘",
    requiredForProduction: "optional",
    bindingKey: "image_generation",
    inputs: [
      { key: "referenceImage", label: "原图", required: true, valueType: "image" },
      { key: "prompt", label: "重绘区域描述", required: true, valueType: "text" },
    ],
    outputs: [{ key: "image", label: "重绘结果", mediaType: "image" }],
  }),
  capability({
    key: "matting_image",
    name: "抠图 / 透明底",
    requirement: "从图片中提取主体并输出透明背景",
    mediaDomain: "image",
    mainlineSteps: [3],
    settingsSection: "image",
    menuLabel: "抠图 / 透明底",
    requiredForProduction: "optional",
    bindingKey: "image_generation",
    inputs: [
      { key: "referenceImage", label: "原图", required: true, valueType: "image" },
    ],
    outputs: [{ key: "image", label: "透明底图片", mediaType: "image" }],
  }),
  capability({
    key: "text_to_video",
    name: "文生视频",
    requirement: "空镜、环境、转场等不要求固定角色的镜头",
    mediaDomain: "video",
    mainlineSteps: [7],
    settingsSection: "video",
    menuLabel: "文生视频",
    requiredForProduction: "route_dependent",
    inputs: [
      { key: "prompt", label: "视频描述", required: true, valueType: "text" },
      { key: "duration", label: "片段时长", required: false, valueType: "number" },
      { key: "aspectRatio", label: "画面比例", required: false, valueType: "text" },
    ],
    outputs: [{ key: "video", label: "视频", mediaType: "video" }],
  }),
  capability({
    key: "video_generation",
    name: "通用视频生成",
    requirement: "通用视频工作流，供文生视频等能力回落",
    mediaDomain: "video",
    mainlineSteps: [7],
    settingsSection: "video",
    menuLabel: "通用视频",
    requiredForProduction: "optional",
    inputs: [
      { key: "firstFrame", label: "起始画面", required: true, valueType: "image" },
      { key: "prompt", label: "导演指令", required: true, valueType: "text" },
      { key: "duration", label: "片段时长", required: false, valueType: "number" },
      { key: "aspectRatio", label: "画面比例", required: false, valueType: "text" },
    ],
    outputs: [{ key: "video", label: "生成视频", mediaType: "video" }],
  }),
  capability({
    key: "image_to_video",
    name: "图生视频",
    requirement: "根据分镜首帧、动作描述和时长生成视频片段",
    mediaDomain: "video",
    mainlineSteps: [7],
    settingsSection: "video",
    menuLabel: "图生视频",
    requiredForProduction: "route_dependent",
    inputs: [
      { key: "firstFrame", label: "分镜首帧", required: true, valueType: "image" },
      { key: "prompt", label: "动作描述", required: true, valueType: "text" },
      { key: "duration", label: "片段时长", required: false, valueType: "number" },
      { key: "promptEnhance", label: "动作提示增强", required: false, valueType: "boolean" },
    ],
    outputs: [{ key: "video", label: "分镜视频", mediaType: "video" }],
  }),
  capability({
    key: "first_last_frame_video",
    name: "首尾帧视频",
    requirement: "根据首帧和尾帧控制镜头起止与连续动作",
    mediaDomain: "video",
    mainlineSteps: [7],
    settingsSection: "video",
    menuLabel: "首尾帧视频",
    requiredForProduction: "route_dependent",
    inputs: [
      { key: "firstFrame", label: "首帧", required: true, valueType: "image" },
      { key: "lastFrame", label: "尾帧", required: true, valueType: "image" },
      { key: "prompt", label: "动作描述", required: true, valueType: "text" },
      { key: "duration", label: "片段时长", required: false, valueType: "number" },
    ],
    outputs: [{ key: "video", label: "首尾帧视频", mediaType: "video" }],
  }),
  capability({
    key: "image_audio_video",
    name: "图片 + 音频视频",
    requirement: "单人说话镜头：必须先有对白音频，再生成带口型视频",
    mediaDomain: "video",
    mainlineSteps: [7],
    settingsSection: "video",
    menuLabel: "图片 + 音频",
    requiredForProduction: "route_dependent",
    bindingKey: "native_audio_video",
    inputs: [
      { key: "firstFrame", label: "角色图片", required: true, valueType: "image" },
      { key: "audio", label: "对白音频", required: true, valueType: "audio" },
      { key: "prompt", label: "情绪与轻微动作", required: false, valueType: "text" },
      { key: "duration", label: "片段时长", required: false, valueType: "number" },
    ],
    outputs: [{ key: "video", label: "带口型视频", mediaType: "video" }],
  }),
  capability({
    key: "native_audio_video",
    name: "原生有声视频",
    requirement: "一次生成带对白、动作声和环境声的视频片段",
    mediaDomain: "video",
    mainlineSteps: [7],
    settingsSection: "video",
    menuLabel: "原生有声视频",
    requiredForProduction: "route_dependent",
    inputs: [
      { key: "firstFrame", label: "分镜首帧", required: true, valueType: "image" },
      { key: "prompt", label: "声音与动作描述", required: true, valueType: "text" },
      { key: "duration", label: "片段时长", required: false, valueType: "number" },
    ],
    outputs: [{ key: "video", label: "原生有声视频", mediaType: "video" }],
  }),
  capability({
    key: "multi_subject_video",
    name: "多角色视频",
    requirement: "多人镜头并保持各角色身份",
    mediaDomain: "video",
    mainlineSteps: [7],
    settingsSection: "video",
    menuLabel: "多角色视频",
    requiredForProduction: "route_dependent",
    inputs: [
      { key: "firstFrame", label: "分镜首帧", required: true, valueType: "image" },
      { key: "characterImages", label: "角色参考图", required: true, valueType: "imageList" },
      { key: "prompt", label: "镜头描述", required: true, valueType: "text" },
      { key: "duration", label: "片段时长", required: false, valueType: "number" },
    ],
    outputs: [{ key: "video", label: "多人镜头视频", mediaType: "video" }],
  }),
  capability({
    key: "reference_video_character",
    name: "参考视频换角色",
    requirement: "保留原动作，替换为新角色",
    mediaDomain: "video",
    mainlineSteps: [7],
    settingsSection: "video",
    menuLabel: "参考视频换角色",
    requiredForProduction: "optional",
    inputs: [
      { key: "video", label: "原始动作视频", required: true, valueType: "video" },
      { key: "referenceImage", label: "角色参考图", required: true, valueType: "image" },
      { key: "audio", label: "可选音频", required: false, valueType: "audio" },
    ],
    outputs: [{ key: "video", label: "换角色视频", mediaType: "video" }],
  }),
  capability({
    key: "voice_clone",
    name: "音色 / 克隆",
    requirement: "基于参考音频锁定角色音色",
    mediaDomain: "audio",
    mainlineSteps: [6],
    settingsSection: "audio",
    menuLabel: "音色 / 克隆",
    requiredForProduction: "optional",
    bindingKey: "voice_synthesis",
    inputs: [
      { key: "voiceReference", label: "音色参考", required: true, valueType: "audio" },
      { key: "text", label: "测试台词", required: true, valueType: "text" },
    ],
    outputs: [{ key: "audio", label: "克隆音色样本", mediaType: "audio" }],
  }),
  capability({
    key: "emotional_voice",
    name: "情绪语音",
    requirement: "带情绪标签的对白合成",
    mediaDomain: "audio",
    mainlineSteps: [6],
    settingsSection: "audio",
    menuLabel: "情绪语音",
    requiredForProduction: "optional",
    bindingKey: "voice_synthesis",
    inputs: [
      { key: "text", label: "台词", required: true, valueType: "text" },
      { key: "emotion", label: "情绪与语气", required: true, valueType: "text" },
      { key: "voiceReference", label: "音色参考", required: false, valueType: "audio" },
    ],
    outputs: [{ key: "audio", label: "情绪对白", mediaType: "audio" }],
  }),
  capability({
    key: "voice_synthesis",
    name: "对白 TTS",
    requirement: "根据台词和角色音色生成对白音频；实测时长反推镜头时长",
    mediaDomain: "audio",
    mainlineSteps: [6],
    settingsSection: "audio",
    menuLabel: "对白 TTS",
    requiredForProduction: "route_dependent",
    inputs: [
      { key: "text", label: "角色台词", required: true, valueType: "text" },
      { key: "voiceReference", label: "音色参考", required: false, valueType: "audio" },
      { key: "voiceDescription", label: "音色描述", required: false, valueType: "text" },
    ],
    outputs: [{ key: "audio", label: "角色人声", mediaType: "audio" }],
  }),
  capability({
    key: "lip_sync",
    name: "口型同步",
    requirement: "视频与对白音频合成口型",
    mediaDomain: "video",
    mainlineSteps: [7],
    settingsSection: "video",
    menuLabel: "口型同步",
    requiredForProduction: "route_dependent",
    inputs: [
      { key: "video", label: "人物视频", required: true, valueType: "video" },
      { key: "audio", label: "最终人声", required: true, valueType: "audio" },
    ],
    outputs: [{ key: "video", label: "口型视频", mediaType: "video" }],
  }),
  capability({
    key: "ambient_audio",
    name: "环境音",
    requirement: "按场景声音预设生成连续环境底声",
    mediaDomain: "audio",
    mainlineSteps: [8],
    settingsSection: "audio",
    menuLabel: "环境音",
    requiredForProduction: "optional",
    inputs: [
      { key: "prompt", label: "声音场描述", required: true, valueType: "text" },
      { key: "duration", label: "持续时长", required: true, valueType: "number" },
      { key: "referenceAudio", label: "参考声音", required: false, valueType: "audio" },
    ],
    outputs: [{ key: "audio", label: "环境底声", mediaType: "audio" }],
  }),
  capability({
    key: "sfx_generation",
    name: "音效 SFX",
    requirement: "动作音效与环境细节音效",
    mediaDomain: "audio",
    mainlineSteps: [8],
    settingsSection: "audio",
    menuLabel: "音效 SFX",
    requiredForProduction: "optional",
    inputs: [
      { key: "prompt", label: "音效描述", required: true, valueType: "text" },
      { key: "duration", label: "持续时长", required: false, valueType: "number" },
    ],
    outputs: [{ key: "audio", label: "音效", mediaType: "audio" }],
  }),
  capability({
    key: "bgm_generation",
    name: "背景音乐 BGM",
    requirement: "按镜头情绪生成或匹配背景音乐",
    mediaDomain: "audio",
    mainlineSteps: [8],
    settingsSection: "audio",
    menuLabel: "背景音乐 BGM",
    requiredForProduction: "optional",
    inputs: [
      { key: "prompt", label: "音乐描述", required: true, valueType: "text" },
      { key: "duration", label: "持续时长", required: false, valueType: "number" },
    ],
    outputs: [{ key: "audio", label: "背景音乐", mediaType: "audio" }],
  }),
] as const;

export type WorkflowCapability = typeof workflowCapabilities[number]["key"];

export function isWorkflowCapability(value: string): value is WorkflowCapability {
  return workflowCapabilities.some((item) => item.key === value);
}

export function getWorkflowCapability(value: string) {
  return workflowCapabilities.find((item) => item.key === value);
}

export function bindingCapabilityKey(capability: string) {
  const definition = getWorkflowCapability(capability);
  return definition?.bindingKey ?? capability;
}

export function capabilitiesForSettingsSection(section: SettingsSection) {
  return workflowCapabilities.filter((item) => item.settingsSection === section);
}

export function summarizeVideoCapabilitiesForPrompt(configured: ReadonlySet<string>) {
  const labels = workflowCapabilities
    .filter((item) => item.mediaDomain === "video" && item.key !== "lip_sync" && configured.has(item.key))
    .map((item) => `${item.name}（${item.key}）`);
  return labels.length ? labels.join("、") : "图生视频（image_to_video，默认兜底）";
}

export const settingsMenuSections = [
  { key: "readiness" as const, label: "主线就绪", step: "①", hint: "九步总览" },
  { key: "text" as const, label: "文本与剧本", step: "②", hint: "LLM · 步骤 1～2、4" },
  { key: "comfyui" as const, label: "ComfyUI 服务", step: "③", hint: "连接，不是能力" },
  { key: "image" as const, label: "图片能力", step: "④", hint: "步骤 3.2、5" },
  { key: "video" as const, label: "视频能力", step: "⑤", hint: "步骤 7" },
  { key: "audio" as const, label: "音频能力", step: "⑥", hint: "步骤 6、8" },
  { key: "edit" as const, label: "剪辑与导出", step: "⑦", hint: "步骤 9" },
  { key: "routing" as const, label: "路由规则", step: "⑧", hint: "编排层，不是选 JSON" },
] as const;

export const settingsImageCapabilityOrder = [
  "image_generation",
  "single_reference_image",
  "multi_reference_image",
  "character_image",
  "storyboard_frame",
  "multi_character_storyboard",
  "last_frame_image",
  "image_edit",
  "inpaint_image",
  "matting_image",
] as const;

export const settingsVideoCapabilityOrder = [
  "text_to_video",
  "image_to_video",
  "first_last_frame_video",
  "image_audio_video",
  "reference_video_character",
] as const;

export const settingsAudioCapabilityOrder = [
  "voice_synthesis",
  "voice_clone",
  "emotional_voice",
  "ambient_audio",
  "sfx_generation",
  "bgm_generation",
] as const;

export const routingRuleGroups = [
  { key: "video", title: "分镜 → 视频方式", description: "镜头类型默认映射到哪种视频能力", ruleKeys: ["empty_shot_text_to_video", "dialogue_image_audio", "multi_subject", "identity_replace", "default_image_to_video"] },
  { key: "frame", title: "分镜 → 首帧/尾帧策略", description: "何时生成尾帧、走首尾帧视频", ruleKeys: ["first_last_frame"] },
  { key: "audio", title: "对白 → 音频 / 口型策略", description: "有对白时先 TTS 再口型，或走原生有声", ruleKeys: ["dialogue_image_audio"] },
] as const;

export function orderedSettingsCapabilities(section: "image" | "video" | "audio") {
  const order = section === "image" ? settingsImageCapabilityOrder : section === "video" ? settingsVideoCapabilityOrder : settingsAudioCapabilityOrder;
  const byKey = new Map(workflowCapabilities.filter((item) => item.settingsSection === section).map((item) => [item.key, item]));
  return order.map((key) => byKey.get(key)).filter((item): item is typeof workflowCapabilities[number] => Boolean(item));
}

export const mainlineStepDefinitions = [
  { step: 1, key: "content_input", name: "内容输入", required: false },
  { step: 2, key: "script_structure", name: "剧本结构化", required: true, settingsSection: "text" as const },
  { step: 3, key: "visual_assets", name: "视觉设定与核心资产", required: true, settingsSection: "image" as const },
  { step: 4, key: "storyboard_script", name: "分镜脚本", required: true, settingsSection: "routing" as const },
  { step: 5, key: "storyboard_frames", name: "分镜画面", required: true, settingsSection: "image" as const, capability: "storyboard_frame" },
  { step: 6, key: "dialogue_dubbing", name: "对白配音", required: true, settingsSection: "audio" as const, capability: "voice_synthesis" },
  { step: 7, key: "shot_video", name: "单镜头视频", required: true, settingsSection: "video" as const },
  { step: 8, key: "sfx_bgm", name: "音效 / BGM", required: false, settingsSection: "audio" as const },
  { step: 9, key: "edit_export", name: "剪辑成片", required: true, settingsSection: "edit" as const },
] as const;
