export const workflowCapabilities = [
  { key: "script_to_assets", name: "剧本资产拆解", requirement: "输入剧本，输出结构化角色、角色形态、场景、道具和出现集数" },
  { key: "character_image", name: "角色标准图", requirement: "根据角色设定和参考图生成可复用的角色标准形象" },
  { key: "scene_image", name: "场景标准图", requirement: "根据场景设定生成稳定的场景参考图" },
  { key: "storyboard_frame", name: "分镜首帧", requirement: "引用角色、场景和道具资产生成单个分镜首帧" },
  { key: "image_to_video", name: "图生视频", requirement: "根据分镜首帧、动作描述和时长生成视频片段" },
  { key: "voice_synthesis", name: "固定角色音色", requirement: "根据角色音色标识与台词生成稳定一致的人声" },
  { key: "lip_sync", name: "口型同步", requirement: "输入视频和角色人声，输出与台词同步的口型视频" },
  { key: "native_audio_video", name: "原生有声视频", requirement: "一次生成带对白、动作声和环境声的视频片段" },
  { key: "ambient_audio", name: "环境声音场", requirement: "根据场景声音预设生成可跨分镜复用的环境底声" },
  { key: "episode_compose", name: "单集合成", requirement: "按分镜顺序合成视频、对白、环境声和字幕" },
] as const;

export type WorkflowCapability = typeof workflowCapabilities[number]["key"];

export function isWorkflowCapability(value: string): value is WorkflowCapability {
  return workflowCapabilities.some((item) => item.key === value);
}
