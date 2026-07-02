import { Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider } from './context/AppContext'
import { AuthProvider, AuthGate } from './context/AuthContext'
import RunnerPage from './pages/RunnerPage'
import EditorPage from './pages/EditorPage'
import AnalysisPage from './pages/AnalysisPage'

export default function App() {
  return (
    <AuthProvider>
      <AuthGate>
        <AppProvider>
          <Routes>
            {/* Root → Test Editor (step 1 of the workflow) */}
            <Route path="/" element={<EditorPage />} />
            <Route path="/editor" element={<Navigate to="/" replace />} />
            <Route path="/runner" element={<RunnerPage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
          </Routes>
        </AppProvider>
      </AuthGate>
    </AuthProvider>
  )
}
