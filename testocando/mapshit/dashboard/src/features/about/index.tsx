import { useEffect } from 'react'
import { PageHeader, PageHeaderTitle } from '@/components/app/PageHeader'

export default function Page() {
  useEffect(() => { document.title = 'About this data · EvacuAid Command Center' }, [])
  return <PageHeader><PageHeaderTitle>About this data</PageHeaderTitle></PageHeader>
}
