import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ActionFeedbackProvider } from './components/ActionFeedback'
import StudentApp from './student/StudentApp'
import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/dm-sans'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {location.pathname.replace(/\/$/, '') === '/student' ? <StudentApp /> : <ActionFeedbackProvider><App /></ActionFeedbackProvider>}
  </React.StrictMode>,
)
