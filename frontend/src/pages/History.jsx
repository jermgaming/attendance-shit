import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errorMessage } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function History() {
  const { user, logout } = useAuth();
  const [summary, setSummary] = useState(null);
  const [records, setRecords] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ subject: '', from: '', to: '' });
  const [error, setError] = useState(null);
  const pageSize = 20;

  useEffect(() => {
    api.get('/me/attendance/summary').then((r) => setSummary(r.data)).catch((e) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ page, pageSize });
    if (filters.subject) params.set('subject', filters.subject);
    if (filters.from) params.set('from', new Date(filters.from).toISOString());
    if (filters.to) params.set('to', new Date(filters.to).toISOString());
    api.get(`/me/attendance?${params}`).then((r) => {
      setRecords(r.data.records);
      setTotal(r.data.total);
    }).catch((e) => setError(errorMessage(e)));
  }, [page, filters]);

  return (
    <>
      <header className="topbar">
        <strong>Attendance</strong>
        <nav>
          <span className="muted">{user.name}</span>
          <Link to="/student">Back to marking</Link>
          <button className="secondary small" onClick={logout}>Log out</button>
        </nav>
      </header>
      <main className="page">
        {error && <div className="message error">{error}</div>}
        {summary && (
          <div className="grid cols-3" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="muted">Overall</div>
              <div className="num" style={{ fontSize: 30, fontWeight: 800 }}>
                {summary.overall.percentage}%
              </div>
              <div className="muted">{summary.overall.attended} of {summary.overall.total} classes</div>
            </div>
            {summary.bySubject.map((s) => (
              <div className="card" key={s.subject}>
                <div className="muted">{s.subject}</div>
                <div style={{ fontSize: 30, fontWeight: 800 }}>{s.percentage}%</div>
                <div className="muted">{s.attended} of {s.total} classes</div>
              </div>
            ))}
          </div>
        )}

        <div className="card">
          <div className="toolbar">
            <input placeholder="Search subject" value={filters.subject}
              onChange={(e) => { setPage(1); setFilters({ ...filters, subject: e.target.value }); }} />
            <input type="date" value={filters.from}
              onChange={(e) => { setPage(1); setFilters({ ...filters, from: e.target.value }); }} />
            <input type="date" value={filters.to}
              onChange={(e) => { setPage(1); setFilters({ ...filters, to: e.target.value }); }} />
          </div>
          <table>
            <thead>
              <tr><th>Date</th><th>Subject</th><th>Status</th><th>Marked at</th><th>By</th></tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.sessionId}>
                  <td>{new Date(r.startedAt).toLocaleString()}</td>
                  <td>{r.subject}</td>
                  <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                  <td>{r.markedAt ? new Date(r.markedAt).toLocaleTimeString() : '—'}</td>
                  <td>{r.markedBy || '—'}</td>
                </tr>
              ))}
              {!records.length && <tr><td colSpan={5} className="muted">No records found.</td></tr>}
            </tbody>
          </table>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="muted">Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
            <button className="secondary small" disabled={page * pageSize >= total} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </div>
      </main>
    </>
  );
}
