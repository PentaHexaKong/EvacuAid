import { useSyncExternalStore } from "react"

import { dismissNotification, getNotifications, subscribeToNotifications } from "@/components/app/notification-store"
import { Notification, NotificationViewport } from "@/components/base/notification/notification"

const DEFAULT_DURATION = 4000

export function Notifications() {
  const items = useSyncExternalStore(subscribeToNotifications, getNotifications, getNotifications)
  return <NotificationViewport>{items.map(({ notificationId, ...item }) => <Notification {...item} autoDismissDuration={DEFAULT_DURATION} introDelay={0} key={notificationId} onDismiss={() => { dismissNotification(notificationId) }} />)}</NotificationViewport>
}
