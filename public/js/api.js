async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON response
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  me: () => request('GET', '/api/auth/me'),
  login: (username, password) => request('POST', '/api/auth/login', { username, password }),
  register: (username, password) => request('POST', '/api/auth/register', { username, password }),
  logout: () => request('POST', '/api/auth/logout'),
  stats: () => request('GET', '/api/stats'),
  startSession: (size) => request('POST', '/api/sessions', { size }),
  next: (id) => request('GET', `/api/sessions/${id}/next`),
  check: (id, payload) => request('POST', `/api/sessions/${id}/check`, payload),
  answer: (id, payload) => request('POST', `/api/sessions/${id}/answer`, payload),
};
