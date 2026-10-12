import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import SessionsList from '../components/SessionsList.jsx';
import LiveSession from '../components/LiveSession.jsx';
import RosterManager from '../components/RosterManager.jsx';
import ReportsPanel from '../components/ReportsPanel.jsx';

export default function TeacherDashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('sessions');
  const [selected, setSelected] = useState(null);

  const openLive = (session) => {
    setSelected(session);
    setTab('sessions');
  };

  return (
    <>
      <header className="topbar">
        <strong>Attendance — Teacher</strong>
        <nav>
          <span className="muted">{user.name}{user.role === 'admin' ? ' (admin)' : ''}</span>
          <button className="secondary small" onClick={logout}>Log out</button>
        </nav>
      </header>
      <main className="page wide">
        {selected ? (
          <LiveSession session={selected} onBack={() => setSelected(null)}
            onClosed={(s) => setSelected(s)} />
        ) : (
          <>
            <div className="tabs">
              <button className={tab === 'sessions' ? 'active' : ''} onClick={() => setTab('sessions')}>Sessions</button>
              <button className={tab === 'roster' ? 'active' : ''} onClick={() => setTab('roster')}>Roster</button>
              <button className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}>Reports</button>
            </div>
            {tab === 'sessions' && <SessionsList onSelect={openLive} />}
            {tab === 'roster' && <RosterManager />}
            {tab === 'reports' && <ReportsPanel />}
          </>
        )}
      </main>
    </>
  );
}
