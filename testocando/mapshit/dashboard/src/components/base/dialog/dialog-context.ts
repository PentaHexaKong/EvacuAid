import { createContext, useContext } from "react"

export const DialogContext = createContext<{ open: boolean; change: (open: boolean) => void; closed: () => void } | null>(null)

export function useDialog() {
  const context = useContext(DialogContext)
  if (!context) throw new Error("Dialog content requires a Dialog")
  return context
}
