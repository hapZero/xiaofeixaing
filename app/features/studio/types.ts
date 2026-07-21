export type View =
  | "login"
  | "home"
  | "drama"
  | "script"
  | "assets"
  | "videos"
  | "editor"
  | "canvas"
  | "workflows"
  | "globalAssets";

export type WorkflowInputDefinition = {
  key: string;
  label: string;
  required: boolean;
  valueType: "text" | "number" | "image" | "video" | "audio" | "json";
};

export type WorkflowOutputDefinition = {
  key: string;
  label: string;
  mediaType: "image" | "video" | "audio" | "json";
};

export type WorkflowCapabilityInfo = {
  key: string;
  name: string;
  requirement: string;
  inputs: readonly WorkflowInputDefinition[];
  outputs: readonly WorkflowOutputDefinition[];
  configured: boolean;
  bindingName: string | null;
  bindingId: string | null;
};

export type StudioUser = {
  id: string;
  email: string;
  displayName: string;
};

export type ProjectSummary = {
  id: string;
  title: string;
  sourceType: "upload" | "ai_script" | "canvas";
  status: string;
  stylePreset: string;
  aspectRatio: string;
  synopsis: string | null;
  createdAt: string | number | Date;
  updatedAt: string | number | Date;
};

export type ProjectEpisode = {
  id: string;
  projectId: string;
  episodeNumber: number;
  title: string;
  summary: string | null;
  scriptText: string | null;
  status: string;
  createdAt: string | number | Date;
  updatedAt: string | number | Date;
};

export type ProjectAsset = {
  id: string;
  projectId: string;
  episodeId: string | null;
  assetType: "character" | "scene" | "prop" | "material" | string;
  name: string;
  status: string;
  storageKey: string | null;
  thumbnailUrl: string | null;
  metadataJson: string;
};

export type ProjectCharacter = {
  id: string;
  projectId: string;
  assetId: string | null;
  canonicalName: string;
  profileJson: string;
  voiceAssetId: string | null;
  voiceDescription: string | null;
  voiceLocked: boolean;
};

export type AudioPreset = {
  id: string;
  projectId: string;
  presetType: string;
  name: string;
  description: string | null;
  assetId: string | null;
  configJson: string;
  locked: boolean;
};

export type ProjectShot = {
  id: string;
  episodeId: string;
  sequence: number;
  title: string;
  prompt: string;
  durationMs: number;
  status: string;
  firstFrameAssetId: string | null;
  videoAssetId: string | null;
  environmentPresetId: string | null;
};
