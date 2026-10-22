import { useEffect, useState } from 'react';
import api, { errorMessage } from '../api.js';

export default function SessionsList({ onSelect }) {
  const [sessions, setSessions] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    subject: '',
    section: '',
    durationMinutes: 60,
    rotationIntervalSeconds: 20,
    markMode: 'code',
  });
  const [busy, setBusy] = useState(false);
  const pageSize = 20;

  const load = () => {
    api.get(`/sessions?page=${page}&pageSize=${pageSize}`)
      .then((r) => { setSessions(r.data.sessions); setTotal(r.data.total); })
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [page]);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/sessions', {
        subject: form.subject.trim(),
        section: form.section.trim() || null,
        durationMinutes: Number(form.durationMinutes),
        rotationIntervalSeconds: Number(form.rotationIntervalSeconds),
        markMode: form.markMode,
      });
      onSelect(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid cols-2">
      <div className="card">
        <h2>Open a session</h2>
        <form className="stack" onSubmit={create}>
          <input placeholder="Subject, e.g. Data Structures" value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
          <input placeholder="Section (optional), e.g. CSE-A" value={form.section}
            onChange={(e) => setForm({ ...form, section: e.target.value })} />
          <label className="muted">
            Duration (minutes)
            <input type="number" min={1} max={720} value={form.durationMinutes}
              onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} />
          </label>
          <label className="muted">
            Code rotation (15–30 s)
            <input type="number" min={15} max={30} value={form.rotationIntervalSeconds}
              onChange={(e) => setForm({ ...form, rotationIntervalSeconds: e.target.value })} />
          </label>
          <label className="muted">Marking method</label>
          <div className="toolbar">
            <button type="button"
              className={form.markMode === 'code' ? 'active small' : 'secondary small'}
              onClick={() => setForm({ ...form, markMode: 'code' })}>Type code</button>
            <button type="button"
              className={form.markMode === 'qr' ? 'active small' : 'secondary small'}
              onClick={() => setForm({ ...form, markMode: 'qr' })}>Scan QR</button>
          </div>
          <button disabled={busy || sessions.some((s) => s.status === 'open')}>
            Start session
          </button>
          {sessions.some((s) => s.status === 'open') && (
            <p className="muted">You already have an open session. Close it before starting a new one.</p>
          )}
        </form>
        {error && <div className="message error" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      <div className="card">
        <h2>Past sessions</h2>
        <table>
          <thead><tr><th>Subject</th><th>Section</th><th>Started</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.subject}</td>
                <td>{s.section || '—'}</td>
                <td>{new Date(s.startedAt).toLocaleString()}</td>
                <td><span className={`badge ${s.status}`}>{s.status}</span></td>
                <td><button className="small secondary" onClick={() => onSelect(s)}>View</button></td>
              </tr>
            ))}
            {!sessions.length && <tr><td colSpan={5} className="muted">No sessions yet.</td></tr>}
          </tbody>
        </table>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="muted">Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
          <button className="secondary small" disabled={page * pageSize >= total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}
