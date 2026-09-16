export type DialogueKind = "dialogue" | "voiceover" | "narration";

export type ShotGenerationStrategy =
  | "silent_visual"
  | "image_to_video"
  | "first_last_frame"
  | "multi_subject_video"
  | "lip_sync"
  | "native_audio_video"
  | "image_audio_video"
  | "video_character_replace"
  | "text_to_video";

export type ProductionCapability =
  | "storyboard_frame"
  | "image_to_video"
  | "first_last_frame_video"
  | "multi_subject_video"
  | "voice_synthesis"
  | "lip_sync"
  | "native_audio_video"
  | "image_audio_video"
  | "text_to_video"
  | "reference_video_character"
  | "ambient_audio"
  | "segment_compose";

export interface ShotProductionIntent {
  characterCount: number;
  hasDialogue: boolean;
  hasVoiceReference: boolean;
  hasFirstFrame: boolean;
  hasLastFrame: boolean;
  needsIdentityReplacement?: boolean;
  preferNativeAudio?: boolean;
  videoCapability?: ProductionCapability;
}

export interface ShotProductionPlan {
  strategy: ShotGenerationStrategy;
  capabilities: ProductionCapability[];
  parallelGroups: ProductionCapability[][];
  explanation: string;
}

export interface SegmentShotIntent extends ShotProductionIntent {
  shotId: string;
}

export interface SegmentProductionIntent {
  segmentId: string;
  shots: SegmentShotIntent[];
  hasEnvironmentPreset: boolean;
  configuredCapabilities?: ProductionCapability[];
}

export interface SegmentProductionStep {
  id: string;
  scope: "segment" | "shot";
  entityId: string;
  capability: ProductionCapability;
  dependsOn: string[];
  mainlineStep: number;
  purpose: string;
}

export interface SegmentProductionPlan {
  segmentId: string;
  shotPlans: Array<{ shotId: string; plan: ShotProductionPlan }>;
  steps: SegmentProductionStep[];
  requiredCapabilities: ProductionCapability[];
}

function visualCapability(intent: ShotProductionIntent, configured: ReadonlySet<ProductionCapability>): ProductionCapability {
  if (intent.videoCapability && configured.has(intent.videoCapability)) return intent.videoCapability;
  if (intent.needsIdentityReplacement && configured.has("reference_video_character")) return "reference_video_character";
  if (intent.characterCount === 0 && configured.has("text_to_video")) return "text_to_video";
  if (intent.hasDialogue && configured.has("image_audio_video")) return "image_audio_video";
  if (intent.hasDialogue && configured.has("native_audio_video")) return "native_audio_video";
  if (intent.hasFirstFrame && intent.hasLastFrame && configured.has("first_last_frame_video")) return "first_last_frame_video";
  if (intent.characterCount > 1 && configured.has("multi_subject_video")) return "multi_subject_video";
  return "image_to_video";
}

export function resolveShotProductionPlan(intent: ShotProductionIntent, configured: ReadonlySet<ProductionCapability> = new Set()): ShotProductionPlan {
  if (intent.needsIdentityReplacement && configured.has("reference_video_character")) {
    return {
      strategy: "video_character_replace",
      capabilities: ["reference_video_character"],
      parallelGroups: [["reference_video_character"]],
      explanation: "已有动作视频，保持运动并替换角色身份",
    };
  }

  const preparation: ProductionCapability[] = intent.hasFirstFrame ? [] : ["storyboard_frame"];
  const voice: ProductionCapability[] = intent.hasDialogue && !configured.has("native_audio_video") && !configured.has("image_audio_video")
    ? ["voice_synthesis"]
    : [];

  if (intent.hasDialogue && configured.has("native_audio_video")) {
    return {
      strategy: "native_audio_video",
      capabilities: [...preparation, "native_audio_video"],
      parallelGroups: [preparation.length ? preparation : [], ["native_audio_video"]].filter((group) => group.length),
      explanation: "对白镜头直接生成原生声音，并使用角色固定音色作为参考",
    };
  }

  const visual = visualCapability(intent, configured);
  if (visual === "image_audio_video") {
    return {
      strategy: "image_audio_video",
      capabilities: [...preparation, ...voice, "image_audio_video"],
      parallelGroups: [[...preparation, ...voice].filter(Boolean), ["image_audio_video"]],
      explanation: "分镜画面与对白配音并行完成后，用图片和对白音频生成口型视频",
    };
  }

  if (intent.hasDialogue) {
    return {
      strategy: "lip_sync",
      capabilities: [...preparation, ...voice, visual, "lip_sync"],
      parallelGroups: [[...preparation, ...voice].filter((item, index, list) => list.indexOf(item) === index), [visual], ["lip_sync"]],
      explanation: "分镜画面与对白配音并行，再生成镜头视频并完成口型同步",
    };
  }

  if (intent.characterCount > 1) {
    return {
      strategy: "multi_subject_video",
      capabilities: [...preparation, "multi_subject_video"],
      parallelGroups: [preparation.length ? preparation : [], ["multi_subject_video"]],
      explanation: "多人镜头使用多个角色形象引用和构图约束",
    };
  }

  if (intent.hasFirstFrame && intent.hasLastFrame) {
    return {
      strategy: "first_last_frame",
      capabilities: ["first_last_frame_video"],
      parallelGroups: [["first_last_frame_video"]],
      explanation: "首尾画面都已确定，使用首尾帧控制动作和构图终点",
    };
  }

  if (intent.characterCount === 0 && visual === "text_to_video") {
    return {
      strategy: "text_to_video",
      capabilities: ["text_to_video"],
      parallelGroups: [["text_to_video"]],
      explanation: "空镜或环境镜头，直接文生视频",
    };
  }

  return {
    strategy: intent.characterCount === 0 ? "silent_visual" : "image_to_video",
    capabilities: [...preparation, visual],
    parallelGroups: [preparation.length ? preparation : [], [visual]],
    explanation: intent.characterCount === 0 ? "环境或空镜，沿用场景资产生成" : "单人无对白镜头，沿用角色首帧生成动作",
  };
}

export function resolveSegmentProductionPlan(intent: SegmentProductionIntent): SegmentProductionPlan {
  const configured = new Set(intent.configuredCapabilities ?? []);
  const shotPlans = intent.shots.map((shot) => ({ shotId: shot.shotId, plan: resolveShotProductionPlan(shot, configured) }));
  const steps: SegmentProductionStep[] = [];
  const composeDependencies: string[] = [];

  for (const { shotId, plan } of shotPlans) {
    const parallelIds: string[] = [];
    for (const group of plan.parallelGroups) {
      const groupIds: string[] = [];
      for (const capability of group) {
        const id = `${shotId}:${capability}`;
        const mainlineStep = capability === "storyboard_frame"
          ? 5
          : capability === "voice_synthesis"
            ? 6
            : ["ambient_audio", "sfx_generation", "bgm_generation"].includes(capability)
              ? 8
              : capability === "segment_compose"
                ? 9
                : 7;
        steps.push({
          id,
          scope: "shot",
          entityId: shotId,
          capability,
          dependsOn: [...parallelIds],
          mainlineStep,
          purpose: plan.explanation,
        });
        groupIds.push(id);
      }
      if (groupIds.length) parallelIds.push(...groupIds);
    }
    composeDependencies.push(parallelIds[parallelIds.length - 1] ?? `${shotId}:compose`);
  }

  if (intent.hasEnvironmentPreset && configured.has("ambient_audio")) {
    const id = `${intent.segmentId}:ambient_audio`;
    steps.push({
      id,
      scope: "segment",
      entityId: intent.segmentId,
      capability: "ambient_audio",
      dependsOn: [],
      mainlineStep: 8,
      purpose: "生成本片段连续的场景声音基线",
    });
    composeDependencies.push(id);
  }

  steps.push({
    id: `${intent.segmentId}:compose`,
    scope: "segment",
    entityId: intent.segmentId,
    capability: "segment_compose",
    dependsOn: [...new Set(composeDependencies.filter(Boolean))],
    mainlineStep: 9,
    purpose: "按时间线合成片段视频、对白、环境音和字幕",
  });

  return {
    segmentId: intent.segmentId,
    shotPlans,
    steps,
    requiredCapabilities: [...new Set(steps.map((step) => step.capability))],
  };
}

export interface ProductionHierarchy {
  projectId: string;
  episodeId: string;
  sceneId: string | null;
  segmentId: string;
  shotId: string;
}
