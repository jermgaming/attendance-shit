import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { downloadFile, errorMessage } from '../api.js';
import { getSocket } from '../socket.js';

export default function LiveSession({ session, onClosed, onBack }) {
  const [detail, setDetail] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [flags, setFlags] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [d, a, f] = await Promise.all([
        api.get(`/sessions/${session.id}`),
        api.get(`/sessions/${session.id}/attendance?status=${statusFilter}&search=${encodeURIComponent(search)}`),
        api.get(`/sessions/${session.id}/flags`),
      ]);
      setDetail(d.data);
      setAttendance(a.data);
      setFlags(f.data.flags);
      if (d.data.status === 'closed') onClosed?.(d.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [session.id, statusFilter, search]);

  const throttledLoad = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      load();
    }, 800);
  }, [load]);

  useEffect(() => {
    load();
    const socket = getSocket();
    socket.emit('session:join', { sessionId: session.id });
    const onMarked = (p) => {
      if (p.sessionId !== session.id) return;
      setNotice(`${p.student.name} marked present`);
      throttledLoad();
    };
    const onUpdated = (p) => { if (p.sessionId === session.id) throttledLoad(); };
    const onFlag = (p) => { if (p.sessionId === session.id) throttledLoad(); };
    const onClosedEvent = (p) => {
      if (p.sessionId !== session.id) return;
      setNotice('Session closed');
      throttledLoad();
    };
    socket.on('attendance:marked', onMarked);
    socket.on('attendance:updated', onUpdated);
    socket.on('flag:raised', onFlag);
    socket.on('session:closed', onClosedEvent);
    const poll = setInterval(load, 15000);
    return () => {
      socket.emit('session:leave', { sessionId: session.id });
      socket.off('attendance:marked', onMarked);
      socket.off('attendance:updated', onUpdated);
      socket.off('flag:raised', onFlag);
      socket.off('session:closed', onClosedEvent);
      clearInterval(poll);
    };
  }, [session.id, load, throttledLoad]);

  const closeSession = async () => {
    if (!window.confirm('Close the session? Everyone not marked will be recorded as absent.')) return;
    setBusy(true);
    try {
      await api.patch(`/sessions/${session.id}/close`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const setRotation = async (payload) => {
    try {
      await api.patch(`/sessions/${session.id}/rotation`, payload);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const override = async (studentId, status) => {
    const note = status === 'present' ? window.prompt('Reason (optional):') ?? '' : '';
    try {
      await api.patch(`/sessions/${session.id}/attendance/${studentId}`, { status, note });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const open = detail?.status === 'open';

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <div className="toolbar">
          <button className="secondary small" onClick={onBack}>← All sessions</button>
          <strong>{detail?.subject || session.subject}</strong>
          <span className={`badge ${detail?.status || session.status}`}>{detail?.status || session.status}</span>
          {detail && (
            <span className="muted">
              {new Date(detail.startedAt).toLocaleString()}
              {detail.section ? ` · ${detail.section}` : ''}
            </span>
          )}
        </div>
        <div className="toolbar">
          <Link to={`/projector/${session.id}`} target="_blank">
            <button className="secondary small">Open projector screen</button>
          </Link>
          <button className="secondary small"
            onClick={() => downloadFile(`/sessions/${session.id}/export?format=csv`, 'attendance.csv')}>
            CSV
          </button>
          <button className="secondary small"
            onClick={() => downloadFile(`/sessions/${session.id}/export?format=xlsx`, 'attendance.xlsx')}>
            XLSX
          </button>
          {open && <button className="danger small" onClick={closeSession} disabled={busy}>Close session</button>}
        </div>
      </div>

      {error && <div className="message error">{error}</div>}
      {notice && <div className="message success" onClick={() => setNotice(null)}>{notice}</div>}

      {attendance && (
        <div className="count-cards">
          <div className="card"><div className="num">{attendance.counts.present}</div><div className="muted">Present</div></div>
          <div className="card"><div className="num">{attendance.counts.absent}</div><div className="muted">Absent</div></div>
          <div className="card"><div className="num">{attendance.counts.total}</div><div className="muted">On roster</div></div>
        </div>
      )}

      {open && detail && (
        <div className="card toolbar">
          <span className="muted">Rotation:</span>
          {detail.rotationPaused ? (
            <button className="small" onClick={() => setRotation({ paused: false })}>Resume</button>
          ) : (
            <button className="secondary small" onClick={() => setRotation({ paused: true })}>Pause</button>
          )}
          <button className="secondary small" onClick={() => setRotation({ rotateNow: true })}>Rotate now</button>
          <select value={detail.rotationIntervalSeconds}
            onChange={(e) => setRotation({ intervalSeconds: Number(e.target.value) })}>
            {[15, 20, 25, 30].map((n) => <option key={n} value={n}>Every {n}s</option>)}
          </select>
        </div>
      )}

      <div className="grid cols-3">
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <div className="toolbar">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
            </select>
            <input placeholder="Search name / roll / email" value={search}
              onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div style={{ maxHeight: 520, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Roll</th><th>Name</th><th>Status</th><th>Marked at</th><th></th></tr></thead>
              <tbody>
                {attendance?.students.map((s) => (
                  <tr key={s.studentId} className={s.flagged ? 'flagged' : ''}>
                    <td>{s.rollNumber || '—'}</td>
                    <td>
                      {s.name}
                      {s.flagged && <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>(flagged)</span>}
                      {s.note && <div className="muted" style={{ fontSize: 12 }}>{s.note}</div>}
                    </td>
                    <td><span className={`badge ${s.status}`}>{s.status}</span></td>
                    <td>{s.markedAt ? new Date(s.markedAt).toLocaleTimeString() : '—'}</td>
                    <td>
                      <button className="small secondary" disabled={!open && s.status !== 'absent'}
                        onClick={() => override(s.studentId, s.status === 'present' ? 'absent' : 'present')}>
                        {s.status === 'present' ? 'Unmark' : 'Mark present'}
                      </button>
                    </td>
                  </tr>
                ))}
                {!attendance?.students.length && <tr><td colSpan={5} className="muted">No students match.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h3>Flags</h3>
          {flags.length ? (
            <ul className="flag-list">
              {flags.map((f, i) => (
                <li key={i}><strong>{f.type}</strong><br />{f.detail}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">No suspicious activity detected.</p>
          )}
        </div>
      </div>
    </div>
  );
}
