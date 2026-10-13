import { useEffect } from 'react'
import { PageHeader, PageHeaderTitle } from '@/components/app/PageHeader'

export default function Page() {
  useEffect(() => { document.title = 'Check-ins · EvacuAid Command Center' }, [])
  return <PageHeader><PageHeaderTitle>Check-ins</PageHeaderTitle></PageHeader>
}
