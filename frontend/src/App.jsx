import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import StudentHome from './pages/StudentHome.jsx';
import History from './pages/History.jsx';
import TeacherDashboard from './pages/TeacherDashboard.jsx';
import ProjectorScreen from './pages/ProjectorScreen.jsx';
import ScanPage from './pages/ScanPage.jsx';

function RequireAuth({ roles, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={user.role === 'student' ? '/student' : '/teacher'} replace />;
  }
  return children;
}

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'student' ? '/student' : '/teacher'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/scan" element={<ScanPage />} />
      <Route path="/student" element={<RequireAuth roles={['student']}><StudentHome /></RequireAuth>} />
      <Route path="/history" element={<RequireAuth roles={['student']}><History /></RequireAuth>} />
      <Route path="/teacher" element={<RequireAuth roles={['teacher', 'admin']}><TeacherDashboard /></RequireAuth>} />
      <Route path="/projector/:sessionId" element={<RequireAuth roles={['teacher', 'admin']}><ProjectorScreen /></RequireAuth>} />
      <Route path="/" element={<HomeRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
