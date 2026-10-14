import { createContext, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'

import { clearEvaluated } from '@/features/routes/evaluated'

type DataMode = 'REFERENCE' | 'SIMULATION'
const DataModeContext = createContext<{ dataMode: DataMode; setDataMode: Dispatch<SetStateAction<DataMode>> } | null>(null)

export function DataModeProvider({ children }: { children: ReactNode }) {
  const [dataMode, setDataMode] = useState<DataMode>('REFERENCE')
  useEffect(() => { if (dataMode === 'SIMULATION') clearEvaluated() }, [dataMode])
  const value = useMemo(() => ({ dataMode, setDataMode }), [dataMode])
  return <DataModeContext.Provider value={value}>{children}</DataModeContext.Provider>
}

export function useDataMode() {
  const context = useContext(DataModeContext)
  if (!context) throw new Error('DataModeProvider is required')
  return context
}
