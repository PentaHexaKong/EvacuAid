import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '@/components/base/buttons/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/app/primitives/card'
import './app/styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing root element')

createRoot(root).render(
  <StrictMode>
    <main id="main-content" tabIndex={-1} className="p-6">
      <Card>
        <CardHeader><CardTitle>Command center</CardTitle></CardHeader>
        <CardContent><Button>Refresh</Button></CardContent>
      </Card>
    </main>
  </StrictMode>,
)
