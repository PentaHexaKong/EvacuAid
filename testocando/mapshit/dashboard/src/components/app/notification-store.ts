import type { ReactNode } from "react"

import type { NotificationProps, NotificationStatus } from "@/components/base/notification/notification"

export type NotificationItem = NotificationProps & { notificationId: number }

export type NotificationHistoryItem = Pick<NotificationItem, "notificationId" | "title" | "description" | "status"> & { createdAt: string; unread: boolean }

let history: NotificationHistoryItem[] = []
let nextId = 0
let notifications: NotificationItem[] = []
const listeners = new Set<() => void>()
const defaultDescriptions: Record<NotificationStatus, ReactNode> = {
  neutral: "Review this notification for more details.",
  information: "Review this update for more details.",
  success: "The action was completed successfully.",
  error: "Review the details and try again.",
}

export function subscribeToNotifications(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function publish() { listeners.forEach((listener) => { listener() }) }

function show(status: NotificationStatus, title: ReactNode, description?: ReactNode) {
  const notificationId = ++nextId
  const content = (typeof description === "string" ? description.trim() : description) || defaultDescriptions[status]
  notifications = [...notifications, { notificationId, status, title, description: content }]
  history = [...history, { notificationId, status, title, description: content, createdAt: new Date().toISOString(), unread: true }]
  publish()
  return notificationId
}

export function dismissNotification(notificationId: number) {
  notifications = notifications.filter((item) => item.notificationId !== notificationId)
  publish()
}

export function getNotifications() { return notifications }

export function getNotificationHistory() { return history }

export function markSystemNotificationRead(notificationId: number) {
  history = history.map((item) => item.notificationId === notificationId ? { ...item, unread: false } : item)
  publish()
}

export function resetNotificationHistory() {
  history = []
  publish()
}

export const notification = {
  error: (title: ReactNode, description?: ReactNode) => show("error", title, description),
  information: (title: ReactNode, description?: ReactNode) => show("information", title, description),
  success: (title: ReactNode, description?: ReactNode) => show("success", title, description),
}

export function notifyValidationError(errors: Record<string, string>) {
  const detail = Object.values(errors).find((value) => value.includes("already exists")) ?? Object.values(errors)[0]
  if (detail) return notification.error(detail.includes("already exists") ? "Duplicate data" : "Please correct the form.", detail)
}

export function notifySaveError(error: unknown, fallback: ReactNode) {
  if (error && typeof error === "object" && "status" in error && error.status === 409) {
    const data = "data" in error ? error.data : undefined
    const detail = data && typeof data === "object" && "detail" in data && typeof data.detail === "string" ? data.detail : "This record already exists."
    return notification.error("Duplicate data", detail)
  }
  return notification.error(fallback)
}
