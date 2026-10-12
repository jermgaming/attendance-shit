import { useState } from 'react';
import api, { downloadFile, errorMessage } from '../api.js';

export default function ReportsPanel() {
  const [filters, setFilters] = useState({ section: '', subject: '', from: '', to: '', below: '' });
  const [students, setStudents] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  const run = async (e) => {
    e?.preventDefault();
    setError(null);
    setDetail(null);
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (!v) continue;
      params.set(k, k === 'from' || k === 'to' ? new Date(v).toISOString() : v);
    }
    try {
      const res = await api.get(`/reports/summary?${params}`);
      setStudents(res.data.students);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const viewStudent = async (id) => {
    try {
      const res = await api.get(`/reports/students/${id}`);
      setDetail(res.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const csvParams = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (!v) continue;
    csvParams.set(k, k === 'from' || k === 'to' ? new Date(v).toISOString() : v);
  }
  csvParams.set('format', 'csv');

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <form className="toolbar" onSubmit={run}>
          <input placeholder="Section" value={filters.section}
            onChange={(e) => setFilters({ ...filters, section: e.target.value })} />
          <input placeholder="Subject" value={filters.subject}
            onChange={(e) => setFilters({ ...filters, subject: e.target.value })} />
          <input type="date" value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          <input type="date" value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          <input type="number" min={0} max={100} placeholder="Below % (optional)" value={filters.below}
            onChange={(e) => setFilters({ ...filters, below: e.target.value })} />
          <button>Run report</button>
          <button type="button" className="secondary"
            onClick={() => downloadFile(`/reports/summary?${csvParams}`, 'attendance-summary.csv')}>
            Download CSV
          </button>
        </form>
        {error && <div className="message error">{error}</div>}
      </div>

      {students && (
        <div className="card">
          <table>
            <thead><tr><th>Roll</th><th>Name</th><th>Section</th><th>Attended</th><th>Total</th><th>%</th><th></th></tr></thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td>{s.rollNumber || '—'}</td>
                  <td>{s.name}</td>
                  <td>{s.section || '—'}</td>
                  <td>{s.attended}</td>
                  <td>{s.total}</td>
                  <td>
                    <span className={`badge ${s.percentage < 75 ? 'absent' : 'present'}`}>{s.percentage}%</span>
                  </td>
                  <td><button className="small secondary" onClick={() => viewStudent(s.id)}>Details</button></td>
                </tr>
              ))}
              {!students.length && <tr><td colSpan={7} className="muted">No students match the filters.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div className="card">
          <div className="toolbar" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>
              {detail.student.name} ({detail.student.rollNumber}) — {detail.summary.percentage}% overall
            </h3>
            <button className="secondary small" onClick={() => setDetail(null)}>Close</button>
          </div>
          <table>
            <thead><tr><th>Date</th><th>Subject</th><th>Status</th><th>Marked by</th><th>Note</th></tr></thead>
            <tbody>
              {detail.records.map((r) => (
                <tr key={r.sessionId}>
                  <td>{new Date(r.startedAt).toLocaleString()}</td>
                  <td>{r.subject}</td>
                  <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                  <td>{r.markedBy}</td>
                  <td>{r.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
