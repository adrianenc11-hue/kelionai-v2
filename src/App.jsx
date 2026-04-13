import { useNavigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'

// App.jsx is no longer needed as the main routing hub.
// Routing is handled in main.jsx via React Router.
// This file is kept for backward compatibility but simply redirects to dashboard.
export default function App() {
  return null
}
