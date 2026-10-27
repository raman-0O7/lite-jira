"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * Shell-wide UI state: the command palette, the shortcuts help, the create
 * project dialog, the mobile sidebar drawer, and the current page's "new
 * issue" action (a project page registers one so `C` and the palette can use it).
 */
type AppUI = {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  createProjectOpen: boolean;
  setCreateProjectOpen: (open: boolean) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  newIssue: (() => void) | null;
  setNewIssue: (handler: (() => void) | null) => void;
};

const AppUIContext = createContext<AppUI | null>(null);

export function AppUIProvider({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [newIssue, setNewIssueState] = useState<(() => void) | null>(null);
  // Wrap: passing a function to a state setter would call it.
  const setNewIssue = useCallback(
    (handler: (() => void) | null) => setNewIssueState(() => handler),
    [],
  );

  return (
    <AppUIContext.Provider
      value={{
        paletteOpen,
        setPaletteOpen,
        shortcutsOpen,
        setShortcutsOpen,
        createProjectOpen,
        setCreateProjectOpen,
        sidebarOpen,
        setSidebarOpen,
        newIssue,
        setNewIssue,
      }}
    >
      {children}
    </AppUIContext.Provider>
  );
}

export function useAppUI(): AppUI {
  const ui = useContext(AppUIContext);
  if (!ui) throw new Error("useAppUI must be used inside the workspace shell");
  return ui;
}

/** Register the current page's "new issue" action for as long as it's mounted. */
export function useRegisterNewIssue(handler: (() => void) | null) {
  const { setNewIssue } = useAppUI();
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const active = handler !== null;
  useEffect(() => {
    if (!active) return;
    setNewIssue(() => latest.current?.());
    return () => setNewIssue(null);
  }, [active, setNewIssue]);
}
