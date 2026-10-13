import { useEffect } from 'react'
import { PageHeader, PageHeaderTitle } from '@/components/app/PageHeader'

export default function Page() {
  useEffect(() => { document.title = 'Assistance · EvacuAid Command Center' }, [])
  return <PageHeader><PageHeaderTitle>Assistance</PageHeaderTitle></PageHeader>
}
