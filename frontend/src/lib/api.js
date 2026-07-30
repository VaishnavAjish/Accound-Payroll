const BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://192.168.1.95:8000';

async function request(method, path, body) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error("Unable to connect to the server. Please check your internet connection and try again.");
  }

  if (res.status === 401 && typeof window !== 'undefined') {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    if (window.location.pathname !== '/login') window.location.href = '/login';
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  if (!res.ok) {
    let errMsg = "An unexpected error occurred while processing your request.";
    if (data && data.error) {
      errMsg = data.error;
    } else if (res.status === 404) {
      errMsg = "The requested resource was not found.";
    } else if (res.status === 403) {
      errMsg = "You do not have permission to perform this action.";
    } else if (res.status === 401) {
      errMsg = "Your session has expired. Please log in again.";
    } else if (res.status >= 500) {
      errMsg = "The server encountered an error. Please try again later.";
    } else {
      errMsg = `Request failed (Error Code: ${res.status}). Please try again.`;
    }
    
    const err = new Error(errMsg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
};
