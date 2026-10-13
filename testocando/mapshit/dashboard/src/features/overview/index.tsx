import { useEffect } from 'react'
import { PageHeader, PageHeaderTitle } from '@/components/app/PageHeader'

export default function Page() {
  useEffect(() => { document.title = 'Regional overview · EvacuAid Command Center' }, [])
  return <PageHeader className="sr-only"><PageHeaderTitle>Regional overview</PageHeaderTitle></PageHeader>
}
