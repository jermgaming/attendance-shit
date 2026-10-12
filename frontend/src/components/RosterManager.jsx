import { useEffect, useRef, useState } from 'react';
import api, { errorMessage } from '../api.js';

export default function RosterManager() {
  const [students, setStudents] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [section, setSection] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const fileRef = useRef(null);
  const pageSize = 50;

  const load = () => {
    const params = new URLSearchParams({ page, pageSize });
    if (section) params.set('section', section);
    if (search) params.set('search', search);
    api.get(`/students?${params}`).then((r) => {
      setStudents(r.data.students);
      setTotal(r.data.total);
    }).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [page, section, search]);

  const importCsv = async (file) => {
    setError(null);
    setImportResult(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await api.post('/students/import', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(res.data);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const addStudent = async (e) => {
    e.preventDefault();
    setError(null);
    const data = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api.post('/students', {
        name: data.name.trim(),
        email: data.email.trim().toLowerCase(),
        rollNumber: data.rollNumber.trim(),
        section: data.section.trim() || null,
      });
      e.target.reset();
      setNotice('Student added.');
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const toggleActive = async (s) => {
    try {
      await api.patch(`/students/${s.id}`, { isActive: !s.isActive });
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const resetDevice = async (s) => {
    if (!window.confirm(`Reset the device binding for ${s.name}? They will be logged out.`)) return;
    try {
      await api.post(`/students/${s.id}/reset-device`);
      setNotice(`Device reset for ${s.name}.`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid cols-2">
        <div className="card">
          <h3>Import CSV roster</h3>
          <p className="muted">Columns: name, email, roll_number, section (optional). Duplicates update name and section.</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv"
            onChange={(e) => e.target.files[0] && importCsv(e.target.files[0])} />
          {importResult && (
            <div className="message success" style={{ marginTop: 10 }}>
              Imported {importResult.imported}, updated {importResult.updated}, skipped {importResult.skipped}.
              {importResult.errors.length > 0 && (
                <ul style={{ marginBottom: 0 }}>
                  {importResult.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>Row {e.row}: {e.reason}</li>
                  ))}
                  {importResult.errors.length > 10 && <li>…and {importResult.errors.length - 10} more</li>}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="card">
          <h3>Add one student</h3>
          <form className="stack" onSubmit={addStudent}>
            <input name="name" placeholder="Full name" required />
            <input name="email" type="email" placeholder="student@college.edu" required />
            <input name="rollNumber" placeholder="Roll number" required />
            <input name="section" placeholder="Section (optional)" />
            <button>Add student</button>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <input placeholder="Filter by section" value={section}
            onChange={(e) => { setPage(1); setSection(e.target.value); }} />
          <input placeholder="Search name / roll / email" value={search}
            onChange={(e) => { setPage(1); setSearch(e.target.value); }} />
          <span className="muted">{total} students</span>
        </div>
        {error && <div className="message error">{error}</div>}
        {notice && <div className="message success">{notice}</div>}
        <div style={{ maxHeight: 520, overflow: 'auto' }}>
          <table>
            <thead><tr><th>Roll</th><th>Name</th><th>Email</th><th>Section</th><th>Device</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td>{s.rollNumber}</td>
                  <td>{s.name}</td>
                  <td>{s.email}</td>
                  <td>{s.section || '—'}</td>
                  <td>{s.deviceBound ? 'bound' : '—'}</td>
                  <td>
                    <button className="small secondary" onClick={() => toggleActive(s)}>
                      {s.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td><button className="small secondary" onClick={() => resetDevice(s)}>Reset device</button></td>
                </tr>
              ))}
              {!students.length && <tr><td colSpan={7} className="muted">No students found.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="muted">Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
          <button className="secondary small" disabled={page * pageSize >= total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}
