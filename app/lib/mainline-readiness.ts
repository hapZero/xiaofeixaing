import type { SettingsSection } from "./workflow-capabilities";
import { bindingCapabilityKey, mainlineStepDefinitions, workflowCapabilities } from "./workflow-capabilities";
import { effectiveVerifiedCapabilities } from "./workflow-routing";
import { testMediaWorkerConnection } from "./server/media-worker";
import { readServiceTestMetadata } from "./service-readiness";

export type MainlineStageStatus = "ready" | "needs_configuration" | "needs_test" | "optional";

export type MainlineStage = {
  step: number;
  key: string;
  name: string;
  required: boolean;
  status: MainlineStageStatus;
  settingsSection: SettingsSection | null;
  capability?: string;
  missingItems: string[];
  actionLabel: string | null;
};

export type MainlineReadiness = {
  ready: boolean;
  readyRequired: number;
  requiredTotal: number;
  stages: MainlineStage[];
};

type ReadinessContext = {
  verifiedCapabilities: ReadonlySet<string>;
  llmTestStatus: string | null;
  llmConfigured: boolean;
  mediaWorkerReady: boolean;
};

function verifiedCapabilitySet(verifiedBindings: Array<{ capability: string }>) {
  const verified = effectiveVerifiedCapabilities(verifiedBindings);
  if (verified.has("image_generation")) {
    for (const definition of workflowCapabilities.filter((item) => item.bindingKey === "image_generation")) verified.add(definition.key);
  }
  if (verified.has("video_generation")) verified.add("text_to_video");
  if (verified.has("native_audio_video")) verified.add("image_audio_video");
  for (const definition of workflowCapabilities) {
    if (definition.bindingKey && verified.has(definition.key)) verified.add(definition.bindingKey);
    if (definition.bindingKey && verified.has(definition.bindingKey)) verified.add(definition.key);
  }
  return verified;
}

function imageAssetsReady(configured: ReadonlySet<string>) {
  const characterReady = configured.has("character_image");
  const scenePropReady = configured.has("image_generation") || configured.has("scene_image");
  if (characterReady && scenePropReady) return { ready: true, missing: [] as string[] };
  const missing = [
    ...(characterReady ? [] : ["人物一致性生成器"]),
    ...(scenePropReady ? [] : ["文生图（场景/道具由流程区分）"]),
  ];
  return { ready: false, missing };
}

function videoRouteReady(configured: ReadonlySet<string>) {
  const videoKeys = workflowCapabilities.filter((item) => item.mediaDomain === "video" && item.key !== "lip_sync").map((item) => item.key);
  const readyKeys = videoKeys.filter((key) => configured.has(bindingCapabilityKey(key)));
  return { ready: readyKeys.length > 0, missing: readyKeys.length ? [] : ["至少一种视频能力"] };
}

export function computeMainlineReadiness(context: ReadinessContext): MainlineReadiness {
  const configured = context.verifiedCapabilities;
  const stages: MainlineStage[] = mainlineStepDefinitions.map((definition) => {
    if (definition.key === "content_input") {
      return { ...definition, status: "ready" as const, settingsSection: null, missingItems: [], actionLabel: null };
    }
    if (definition.key === "script_structure") {
      const status: MainlineStageStatus = !context.llmConfigured
        ? "needs_configuration"
        : context.llmTestStatus === "succeeded"
          ? "ready"
          : "needs_test";
      return {
        step: definition.step,
        key: definition.key,
        name: definition.name,
        required: definition.required,
        settingsSection: definition.settingsSection,
        status,
        missingItems: status === "ready" ? [] : ["文本智能服务"],
        actionLabel: status === "ready" ? null : "配置文本智能",
      };
    }
    if (definition.key === "visual_assets") {
      const assets = imageAssetsReady(configured);
      return {
        step: definition.step,
        key: definition.key,
        name: definition.name,
        required: definition.required,
        settingsSection: definition.settingsSection,
        status: assets.ready ? "ready" : "needs_configuration",
        missingItems: assets.missing,
        actionLabel: assets.ready ? null : "配置图片能力",
      };
    }
    if (definition.key === "storyboard_script") {
      const llmReady = context.llmConfigured && context.llmTestStatus === "succeeded";
      const video = videoRouteReady(configured);
      const ready = llmReady && video.ready;
      return {
        step: definition.step,
        key: definition.key,
        name: definition.name,
        required: definition.required,
        settingsSection: definition.settingsSection,
        status: ready ? "ready" : llmReady ? "needs_configuration" : "needs_test",
        missingItems: ready ? [] : [...(llmReady ? [] : ["文本智能"]), ...(video.ready ? [] : video.missing)],
        actionLabel: ready ? null : "配置路由规则",
      };
    }
    if (definition.key === "storyboard_frames") {
      const ready = configured.has("storyboard_frame") || configured.has("image_generation");
      return {
        step: definition.step,
        key: definition.key,
        name: definition.name,
        required: definition.required,
        settingsSection: definition.settingsSection,
        capability: definition.capability,
        status: ready ? "ready" : "needs_configuration",
        missingItems: ready ? [] : ["分镜图（多参考）"],
        actionLabel: ready ? null : "配置分镜图",
      };
    }
    if (definition.key === "dialogue_dubbing") {
      const ready = configured.has("voice_synthesis");
      return {
        step: definition.step,
        key: definition.key,
        name: definition.name,
        required: definition.required,
        settingsSection: definition.settingsSection,
        capability: definition.capability,
        status: ready ? "ready" : "needs_configuration",
        missingItems: ready ? [] : ["对白 TTS"],
        actionLabel: ready ? null : "配置对白 TTS",
      };
    }
    if (definition.key === "shot_video") {
      const video = videoRouteReady(configured);
      return {
        step: definition.step,
        key: definition.key,
        name: definition.name,
        required: definition.required,
        settingsSection: definition.settingsSection,
        status: video.ready ? "ready" : "needs_configuration",
        missingItems: video.missing,
        actionLabel: video.ready ? null : "配置视频能力",
      };
    }
    if (definition.key === "sfx_bgm") {
      const ready = configured.has("ambient_audio") || configured.has("sfx_generation") || configured.has("bgm_generation");
      return {
        step: definition.step,
        key: definition.key,
        name: definition.name,
        required: definition.required,
        settingsSection: definition.settingsSection,
        status: ready ? "ready" : "optional",
        missingItems: ready ? [] : ["环境音 / 音效 / BGM"],
        actionLabel: ready ? null : "可选配置",
      };
    }
    return {
      step: definition.step,
      key: definition.key,
      name: definition.name,
      required: definition.required,
      settingsSection: definition.settingsSection,
      status: context.mediaWorkerReady ? "ready" : "needs_configuration",
      missingItems: context.mediaWorkerReady ? [] : ["FFmpeg 媒体处理器"],
      actionLabel: context.mediaWorkerReady ? null : "配置剪辑引擎",
    };
  });

  const requiredStages = stages.filter((stage) => stage.required);
  const readyRequired = requiredStages.filter((stage) => stage.status === "ready").length;
  return {
    ready: readyRequired === requiredStages.length,
    readyRequired,
    requiredTotal: requiredStages.length,
    stages,
  };
}

export async function loadMainlineReadiness(ownerId: string, verifiedBindings: Array<{ capability: string }>, services: Array<{ kind: string; enabled: boolean | null; configJson: string }>) {
  const llm = services.find((service) => service.kind === "llm" && service.enabled) ?? null;
  const llmTest = readServiceTestMetadata(llm?.configJson);
  const mediaWorker = await testMediaWorkerConnection();
  return computeMainlineReadiness({
    verifiedCapabilities: verifiedCapabilitySet(verifiedBindings),
    llmConfigured: Boolean(llm),
    llmTestStatus: llmTest.lastTestStatus,
    mediaWorkerReady: mediaWorker.connected,
  });
}
