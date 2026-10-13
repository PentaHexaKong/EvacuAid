import { useSyncExternalStore } from "react"

let keyboard = false

function subscribe(listener: () => void) {
  function onKeyDown() { keyboard = true; listener() }
  function onPointerDown() { keyboard = false; listener() }
  document.addEventListener("keydown", onKeyDown, true)
  document.addEventListener("pointerdown", onPointerDown, true)
  return () => {
    document.removeEventListener("keydown", onKeyDown, true)
    document.removeEventListener("pointerdown", onPointerDown, true)
  }
}

export function useDialogMotion() {
  return useSyncExternalStore(subscribe, () => keyboard, () => false)
}
