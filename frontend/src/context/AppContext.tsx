"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface AppContextValue {
  isSubscribed: boolean;
  setIsSubscribed: (value: boolean) => void;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [isSubscribed, setIsSubscribed] = useState(false);

  return (
    <AppContext.Provider value={{ isSubscribed, setIsSubscribed }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within AppProvider");
  }
  return context;
}
