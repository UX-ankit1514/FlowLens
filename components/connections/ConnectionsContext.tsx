"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppConfigView } from "@/types";
import { ConnectionsDrawer } from "./ConnectionsDrawer";

type ConnectionsContextValue = {
  /** Undefined until the first status check finishes. */
  config?: AppConfigView;
  setConfig: (config: AppConfigView) => void;
  refresh: () => Promise<void>;
  openConnections: () => void;
};

const ConnectionsContext = createContext<ConnectionsContextValue | null>(null);

export function ConnectionsProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfigView>();
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/connections", { cache: "no-store" });
      if (res.ok) setConfig((await res.json()) as AppConfigView);
    } catch {
      /* keep the last known state */
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/connections", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<AppConfigView>) : undefined))
      .then((next) => {
        if (active && next) setConfig(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(
    () => ({ config, setConfig, refresh, openConnections: () => setOpen(true) }),
    [config, refresh],
  );

  return (
    <ConnectionsContext.Provider value={value}>
      {children}
      <ConnectionsDrawer isOpen={open} onClose={() => setOpen(false)} config={config} onChange={setConfig} />
    </ConnectionsContext.Provider>
  );
}

export function useConnections(): ConnectionsContextValue {
  const value = useContext(ConnectionsContext);
  if (!value) throw new Error("useConnections must be used inside ConnectionsProvider");
  return value;
}
