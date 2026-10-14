import { RiMap2Line, RiTruckLine, RiInformationLine } from '@remixicon/react'

export const navigation = [{ label: 'Overview', path: '/overview', icon: RiMap2Line }]
export const navigationGroups = [{
  label: 'Operations', icon: RiTruckLine, items: [
    { label: 'Field reports', path: '/operations/reports', icon: RiTruckLine },
    { label: 'Assistance', path: '/operations/assistance', icon: RiTruckLine },
    { label: 'Check-ins', path: '/operations/check-ins', icon: RiTruckLine },
    { label: 'Route setter', path: '/operations/routes', icon: RiTruckLine },
  ],
}]
export const navigationEnd = [{ label: 'About this data', path: '/about', icon: RiInformationLine }]
