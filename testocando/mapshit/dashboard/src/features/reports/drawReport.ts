import type { FieldReport } from '@/lib/types'
import type { MapAPI } from '@/map/glMap'
import { label } from '@/features/operations/OperationsPage'

export function drawReport(map: MapAPI, report: FieldReport) {
  map.setLayer('report', { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [report.longitude, report.latitude] }, properties: { tooltip: label(report.kind) + ' · ' + label(report.status) } }] }, { radius: 8, weight: 3, color: report.status === 'CONFIRMED' ? '#B42318' : '#1F6FC8' })
  map.setVisible('report', true)
  requestAnimationFrame(() => { map.fit([[report.longitude - 0.002, report.latitude - 0.002], [report.longitude + 0.002, report.latitude + 0.002]]) })
}
