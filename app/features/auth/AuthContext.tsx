"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { StudioUser } from "../studio/types";

type StudioAuthContextValue = {
  user: StudioUser;
  signOut: () => void;
};

const StudioAuthContext = createContext<StudioAuthContextValue | null>(null);

export function StudioAuthProvider({ user, signOut, children }: StudioAuthContextValue & { children: ReactNode }) {
  return <StudioAuthContext.Provider value={{ user, signOut }}>{children}</StudioAuthContext.Provider>;
}

export function useStudioAuth() {
  const value = useContext(StudioAuthContext);
  if (!value) throw new Error("STUDIO_AUTH_CONTEXT_REQUIRED");
  return value;
}
