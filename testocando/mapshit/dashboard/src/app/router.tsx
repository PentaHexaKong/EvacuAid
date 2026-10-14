import { Navigate, type RouteObject } from 'react-router'
import { Shell } from './Shell'
import Overview from '@/features/overview'
import Reports from '@/features/reports'
import Assistance from '@/features/assistance'
import CheckIns from '@/features/check-ins'
import Routes from '@/features/routes'
import About from '@/features/about'

export const routes: RouteObject[] = [{
  element: <Shell />,
  children: [
    { path: '/overview', element: <Overview /> },
    { path: '/operations', element: <Navigate to="/operations/reports" replace /> },
    { path: '/operations/reports', element: <Reports /> },
    { path: '/operations/assistance', element: <Assistance /> },
    { path: '/operations/check-ins', element: <CheckIns /> },
    { path: '/operations/routes', element: <Routes /> },
    { path: '/about', element: <About /> },
    { path: '*', element: <Navigate to="/overview" replace /> },
  ],
}]
