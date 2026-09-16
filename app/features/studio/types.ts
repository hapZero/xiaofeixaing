export type View =
  | "login"
  | "home"
  | "drama"
  | "script"
  | "assets"
  | "videos"
  | "editor"
  | "canvas"
  | "globalAssets";

export type MainlineStage = {
  step: number;
  key: string;
  name: string;
  required: boolean;
  status: "ready" | "needs_configuration" | "needs_test" | "optional";
  settingsSection: string | null;
  capability?: string;
  missingItems: string[];
  actionLabel: string | null;
};

export type ProductionMainlineReadiness = {
  ready: boolean;
  readyRequired: number;
  requiredTotal: number;
  stages: MainlineStage[];
};

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

export type WorkflowCapabilityInfo = {
  key: string;
  name: string;
  requirement: string;
  inputs: readonly WorkflowInputDefinition[];
  outputs: readonly WorkflowOutputDefinition[];
  configured: boolean;
  verified: boolean;
  latestTestStatus: string | null;
  bindingName: string | null;
  bindingId: string | null;
};

export type ProductionRouteInfo = {
  key: "visual_assets" | "segment_video" | "sound_enhancement";
  name: string;
  description: string;
  required: boolean;
  capabilities: readonly string[];
  strategies: readonly {
    key: string;
    name: string;
    description: string;
    requiredCapabilities: readonly string[];
  }[];
  optionalCapabilities: readonly string[];
  ready: boolean;
  status: "ready" | "partial" | "unconfigured";
  configuredCapabilities: readonly string[];
  completedStrategies: readonly string[];
};

export type ProductionMainlineStage = MainlineStage;

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
  sourceText: string | null;
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
  videoAssetId: string | null;
  subtitleAssetId: string | null;
  currentVersionNumber: number;
  createdAt: string | number | Date;
  updatedAt: string | number | Date;
};

export type ProjectGenerationJob = {
  id: string;
  projectId: string;
  entityType: string;
  entityId: string;
  capability: string;
  status: string;
  resultJson: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string | number | Date;
  updatedAt: string | number | Date;
};

export type EpisodeVersion = {
  id: string;
  episodeId: string;
  versionNumber: number;
  resultAssetId: string | null;
  subtitleAssetId: string | null;
  durationMs: number;
  inputsJson: string;
  status: string;
};

export type ProjectAsset = {
  id: string;
  projectId: string;
  episodeId: string | null;
  assetType: "character" | "scene" | "prop" | "material" | string;
  sourceRevision: number | null;
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

export type CharacterForm = {
  id: string;
  characterId: string;
  name: string;
  description: string;
  assetId: string | null;
  episodeScopeJson: string;
  inheritVoice: boolean;
};

export type CharacterFormReference = {
  id: string;
  characterFormId: string;
  assetId: string;
  referenceType: "primary" | "front" | "side" | "back" | "expression" | "pose" | "detail" | "reference" | string;
  referenceOrder: number;
  isPrimary: boolean;
};

export type StoryBible = {
  id: string;
  projectId: string;
  sourceRevision: number;
  logline: string | null;
  worldJson: string;
  timelineJson: string;
  relationshipsJson: string;
  styleGuideJson: string;
  narrationMode: string;
  status: string;
};

export type StoryScene = {
  id: string;
  projectId: string;
  assetId: string | null;
  name: string;
  episodeScopeJson: string;
  timeOfDay: string | null;
  interiorExterior: string | null;
  visualContinuityJson: string;
  audioPresetId: string | null;
  status: string;
};

export type ProjectSegment = {
  id: string;
  episodeId: string;
  storySceneId: string | null;
  sequence: number;
  sourceRevision: number;
  title: string;
  synopsis: string;
  directorPrompt: string | null;
  referenceMode: "automatic" | "manual" | string;
  durationMs: number;
  status: string;
  videoAssetId: string | null;
  audioAssetId: string | null;
  currentVersionNumber: number;
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
  segmentId: string | null;
  sequence: number;
  sourceRevision: number;
  title: string;
  prompt: string;
  durationMs: number;
  shotType: string;
  cameraJson: string;
  soundPlanJson: string;
  generationPlanJson: string;
  status: string;
  firstFrameAssetId: string | null;
  videoAssetId: string | null;
  environmentPresetId: string | null;
};

export type ShotAssetReference = {
  id: string;
  shotId: string;
  assetId: string | null;
  characterId: string | null;
  characterFormId: string | null;
  referenceRole: string;
  referenceOrder: number;
  required: boolean;
};

export type DialogueLine = {
  id: string;
  shotId: string;
  sequence: number;
  speakerCharacterId: string | null;
  lineType: "dialogue" | "voiceover" | "narration" | string;
  text: string;
  emotion: string | null;
  deliveryJson: string;
  voiceAssetId: string | null;
  voiceReferenceAssetId: string | null;
  audioAssetId: string | null;
};

export type AudioTrack = {
  id: string;
  episodeId: string;
  segmentId: string | null;
  shotId: string | null;
  trackType: "dialogue" | "ambience" | "sfx" | "bgm" | string;
  assetId: string | null;
  presetId: string | null;
  startMs: number;
  durationMs: number;
  gainCentiDb: number;
  configJson: string;
  status: string;
};

export type ShotVersion = {
  id: string;
  shotId: string;
  versionNumber: number;
  prompt: string;
  inputsJson: string;
  resultAssetId: string | null;
  qualityJson: string;
  status: string;
};

export type SegmentVersion = {
  id: string;
  segmentId: string;
  versionNumber: number;
  prompt: string;
  inputsJson: string;
  resultAssetId: string | null;
  productionMode: string;
  qualityJson: string;
  status: string;
  createdAt: string | number | Date;
};

export type ProjectProductionDetail = {
  project: ProjectSummary;
  storyBible: StoryBible | null;
  episodes: ProjectEpisode[];
  storyScenes: StoryScene[];
  segments: ProjectSegment[];
  assets: ProjectAsset[];
  characters: ProjectCharacter[];
  characterForms: CharacterForm[];
  characterFormReferences: CharacterFormReference[];
  audioPresets: AudioPreset[];
  shots: ProjectShot[];
  shotAssetReferences: ShotAssetReference[];
  dialogueLines: DialogueLine[];
  audioTracks: AudioTrack[];
  shotVersions: ShotVersion[];
  segmentVersions: SegmentVersion[];
  episodeVersions: EpisodeVersion[];
};
