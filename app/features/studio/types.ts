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
