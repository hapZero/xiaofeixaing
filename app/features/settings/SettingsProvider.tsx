"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { SettingsSection } from "../../lib/workflow-capabilities";
import { SettingsModal } from "./SettingsModal";

type SettingsContextValue = {
  openSettings: (section?: SettingsSection, capabilityKey?: string) => void;
  closeSettings: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>("readiness");
  const [capabilityKey, setCapabilityKey] = useState<string | null>(null);

  const openSettings = useCallback((nextSection: SettingsSection = "readiness", nextCapabilityKey?: string) => {
    setSection(nextSection);
    setCapabilityKey(nextCapabilityKey ?? null);
    setOpen(true);
  }, []);

  const closeSettings = useCallback(() => setOpen(false), []);

  const value = useMemo(() => ({ openSettings, closeSettings }), [openSettings, closeSettings]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
      {open ? <SettingsModal section={section} capabilityKey={capabilityKey} onClose={closeSettings} /> : null}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings must be used within SettingsProvider");
  return context;
}
