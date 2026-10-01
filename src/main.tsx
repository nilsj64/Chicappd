import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { HistoryProvider } from './HistoryProvider'
import { LanguageProvider, LanguageSwitch } from './LanguageProvider'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider><LanguageSwitch /><HistoryProvider><App /></HistoryProvider></LanguageProvider>
  </React.StrictMode>,
)
