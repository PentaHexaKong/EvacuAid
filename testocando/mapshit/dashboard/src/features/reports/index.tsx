import { useEffect } from 'react'
import { PageHeader, PageHeaderTitle } from '@/components/app/PageHeader'

export default function Page() {
  useEffect(() => { document.title = 'Field reports · EvacuAid Command Center' }, [])
  return <PageHeader><PageHeaderTitle>Field reports</PageHeaderTitle></PageHeader>
}
