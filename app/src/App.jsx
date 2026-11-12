import { useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import Layout from './components/Layout'
import Login, { SetPinOverlay } from './pages/Login'
import Overblik from './pages/Overblik'
import Ordrer from './pages/Ordrer'
import OrdreEditor, { NewOrder } from './pages/OrdreEditor'
import Kundevisning from './pages/Kundevisning'
import Skraedder from './pages/Skraedder'
import Kunder, { Kundekort } from './pages/Kunder'
import Afhentning from './pages/Afhentning'
import Admin from './pages/Admin'
import Bestillinger from './pages/Bestillinger'
import Etiket from './pages/Etiket'
import Fakturaer from './pages/Fakturaer'

function Gate() {
  const { ready, employee, locked, isStaff, refreshEmployee } = useAuth()
  const [skipPin, setSkipPin] = useState(false)
  if (!ready) return <div className="splash"><img src="./sb-monogram.png" alt="" /></div>
  if (!employee || locked) return <Login />
  const staffOnly = (el) => (isStaff ? el : <Navigate to="/skraedder" replace />)
  return (
    <>
      <Routes>
        <Route path="/kunde/:id/:version" element={staffOnly(<Kundevisning />)} />
        <Route path="/etiket/:id" element={staffOnly(<Etiket />)} />
        <Route element={<Layout />}>
          <Route index element={staffOnly(<Overblik />)} />
          <Route path="ordrer" element={staffOnly(<Ordrer />)} />
          <Route path="ordrer/ny" element={staffOnly(<NewOrder />)} />
          <Route path="ordrer/:id" element={staffOnly(<OrdreEditor />)} />
          <Route path="skraedder" element={<Skraedder />} />
          <Route path="kunder" element={staffOnly(<Kunder />)} />
          <Route path="kunder/:id" element={staffOnly(<Kundekort />)} />
          <Route path="afhentning" element={staffOnly(<Afhentning />)} />
          <Route path="bestillinger" element={staffOnly(<Bestillinger />)} />
          <Route path="fakturaer" element={staffOnly(<Fakturaer />)} />
          <Route path="admin" element={<Admin />} />
          <Route path="*" element={<Navigate to={isStaff ? '/' : '/skraedder'} replace />} />
        </Route>
      </Routes>
      {!employee.has_pin && !skipPin && <SetPinOverlay onDone={async () => { setSkipPin(true); await refreshEmployee() }} />}
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter><Gate /></HashRouter>
    </AuthProvider>
  )
}
