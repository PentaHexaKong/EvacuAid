export const dialogSizes = {
  sm: "max-w-sm",
  md: "max-w-xl",
  lg: "max-w-2xl",
  xl: "max-w-6xl",
} as const

export type DialogSize = keyof typeof dialogSizes
