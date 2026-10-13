import { MapProvider } from '@/map/MapProvider'
import { Outlet } from 'react-router'
import { AppShell } from '@/components/app/app-shell'
import { DataModeProvider } from './data-mode'

export function Shell() {
  return <DataModeProvider><AppShell><div id="map-host-boundary"><MapProvider><Outlet /></MapProvider></div></AppShell></DataModeProvider>
}
