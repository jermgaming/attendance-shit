import axios from 'axios';

function makeDeviceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getDeviceId() {
  let id = localStorage.getItem('deviceId');
  if (!id) {
    id = makeDeviceId();
    localStorage.setItem('deviceId', id);
  }
  return id;
}

const api = axios.create({ baseURL: '/api/v1' });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  cfg.headers['X-Device-Id'] = getDeviceId();
  return cfg;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !location.pathname.startsWith('/login')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      location.assign('/login');
    }
    return Promise.reject(err);
  },
);

export function errorMessage(err) {
  const e = err.response?.data?.error;
  return e ? `${e.message}${e.details?.retryAfterSeconds ? ` Retry in ${e.details.retryAfterSeconds}s.` : ''}` : err.message || 'Something went wrong.';
}

export async function downloadFile(url, filename) {
  const res = await api.get(url, { responseType: 'blob' });
  const blobUrl = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(blobUrl);
}

export default api;
