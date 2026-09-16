import type { WorkflowCapability } from "./workflow-capabilities";

export type ProductionRouteKey = "visual_assets" | "segment_video" | "sound_enhancement";

export type ProductionRouteDefinition = {
  key: ProductionRouteKey;
  name: string;
  description: string;
  required: boolean;
  capabilities: readonly WorkflowCapability[];
  strategies: readonly {
    key: string;
    name: string;
    description: string;
    requiredCapabilities: readonly WorkflowCapability[];
  }[];
  optionalCapabilities: readonly WorkflowCapability[];
};

export const productionRoutes: readonly ProductionRouteDefinition[] = [
  {
    key: "visual_assets",
    name: "视觉资产生成",
    description: "生成并复用角色形态、场景和分镜参考画面，保证全剧视觉连续性。",
    required: true,
    capabilities: ["image_generation", "character_image", "scene_image", "storyboard_frame"],
    strategies: [
      {
        key: "general_image_service",
        name: "一套通用图像服务",
        description: "只配置文生图一次，角色走人物一致性生成器，场景/道具/分镜由流程提示词区分。",
        requiredCapabilities: ["image_generation", "character_image"],
      },
      {
        key: "specialized_visual_assets",
        name: "三套专用图像工作流",
        description: "可选的精细路线：分别为角色、场景和分镜配置不同工作流。",
        requiredCapabilities: ["character_image", "scene_image", "storyboard_frame"],
      },
    ],
    optionalCapabilities: ["character_image", "scene_image", "storyboard_frame"],
  },
  {
    key: "segment_video",
    name: "片段视频生成",
    description: "小飞象按片段组织多个分镜，并自动选择一条完整的视频与对白生成路线。",
    required: true,
    capabilities: ["video_generation", "native_audio_video", "image_to_video", "voice_synthesis", "lip_sync", "multi_subject_video", "first_last_frame_video"],
    strategies: [
      {
        key: "native_audio",
        name: "原生有声视频",
        description: "一次生成画面、对白和环境声音；配置后优先用于有对白片段。",
        requiredCapabilities: ["native_audio_video"],
      },
      {
        key: "general_video_separate_voice",
        name: "通用视频 + 固定音色 + 口型",
        description: "用一套通用视频工作流生成全部普通镜头，再由小飞象完成对白与口型。",
        requiredCapabilities: ["video_generation", "voice_synthesis", "lip_sync"],
      },
      {
        key: "separate_voice",
        name: "视频 + 固定音色 + 口型",
        description: "视频模型不带可靠声音时，由小飞象自动补充角色声音与口型。",
        requiredCapabilities: ["image_to_video", "voice_synthesis", "lip_sync"],
      },
    ],
    optionalCapabilities: ["image_to_video", "multi_subject_video", "first_last_frame_video"],
  },
  {
    key: "sound_enhancement",
    name: "声音与氛围增强",
    description: "可选的连续环境声增强；不再作为所有项目必须配置的固定步骤。",
    required: false,
    capabilities: ["ambient_audio"],
    strategies: [],
    optionalCapabilities: ["ambient_audio"],
  },
] as const;

export function describeProductionRoute(route: ProductionRouteDefinition, configured: ReadonlySet<string>) {
  const completedStrategies = route.strategies.filter((strategy) => strategy.requiredCapabilities.every((capability) => configured.has(capability)));
  const configuredCapabilities = route.capabilities.filter((capability) => configured.has(capability));
  const ready = route.required ? completedStrategies.length > 0 : configuredCapabilities.length > 0;
  return {
    ready,
    status: ready ? "ready" as const : configuredCapabilities.length ? "partial" as const : "unconfigured" as const,
    configuredCapabilities,
    completedStrategies: completedStrategies.map((strategy) => strategy.key),
  };
}
