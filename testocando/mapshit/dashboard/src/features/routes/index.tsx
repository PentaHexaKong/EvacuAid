import { useEffect } from 'react'
import { PageHeader, PageHeaderTitle } from '@/components/app/PageHeader'

export default function Page() {
  useEffect(() => { document.title = 'Route setter · EvacuAid Command Center' }, [])
  return <PageHeader><PageHeaderTitle>Route setter</PageHeaderTitle></PageHeader>
}
