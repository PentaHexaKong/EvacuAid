import { RiMap2Line, RiFileWarningLine, RiHandHeartLine, RiUserLocationLine, RiRouteLine } from '@remixicon/react'

export const navigation = [
  { label: 'Overview', path: '/overview', icon: RiMap2Line },
  { label: 'Field reports', path: '/operations/reports', icon: RiFileWarningLine },
  { label: 'Assistance', path: '/operations/assistance', icon: RiHandHeartLine },
  { label: 'Check-ins', path: '/operations/check-ins', icon: RiUserLocationLine },
  { label: 'Route setter', path: '/operations/routes', icon: RiRouteLine },
] as const
