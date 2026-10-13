import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'

type DataMode = 'REFERENCE' | 'SIMULATION'
const DataModeContext = createContext<{ dataMode: DataMode; setDataMode: Dispatch<SetStateAction<DataMode>> } | null>(null)

export function DataModeProvider({ children }: { children: ReactNode }) {
  const [dataMode, setDataMode] = useState<DataMode>('REFERENCE')
  return <DataModeContext.Provider value={{ dataMode, setDataMode }}>{children}</DataModeContext.Provider>
}

export function useDataMode() {
  const context = useContext(DataModeContext)
  if (!context) throw new Error('DataModeProvider is required')
  return context
}
