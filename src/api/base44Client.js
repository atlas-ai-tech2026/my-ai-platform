import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  // Never let a request hang forever. Image generation is synchronous and can
  // take ~30-60s at FAL, so give it generous headroom — but after this the
  // request errors with a real message instead of leaving the Generate button
  // stuck on "GENERATING" indefinitely.
  timeout: 180000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('voxel_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ─── H7 (security audit 2026-07-28): honest failures ────────────────────────
// Every call below used to `catch {}` and quietly return localStorage data,
// so a 500 (or a 401, or a rejected save) was indistinguishable from success:
// `create` fabricated a row the server never saw and handed it back as if it
// had been persisted. Users lost work and the UI showed no error.
//
// The rule now:
//   • the SERVER answered with an error  → always throw. Never fake success.
//   • the NETWORK is genuinely unreachable → reads may serve the cache
//     (clearly a read-only convenience); writes still throw, because a write
//     that didn't reach the server did not happen.

export class ApiError extends Error {
  constructor(message, { status = null, offline = false, cause } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.offline = offline;
    this.cause = cause;
  }
}

/** True only when no response came back at all (DNS failure, dropped
 * connection, timeout) — NOT when the server replied with an error code. */
export function isOffline(error) {
  return !error?.response;
}

function toApiError(error, action) {
  const status = error?.response?.status ?? null;
  const serverMessage =
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    null;
  if (status) {
    return new ApiError(serverMessage || `${action} failed (${status})`, { status, cause: error });
  }
  return new ApiError(
    `${action} failed — you appear to be offline. Check your connection and try again.`,
    { offline: true, cause: error }
  );
}

function createEntityProxy(entityName) {
  const storageKey = `voxel_${entityName}`;

  function getAll() {
    return JSON.parse(localStorage.getItem(storageKey) || '[]');
  }
  function saveAll(items) {
    localStorage.setItem(storageKey, JSON.stringify(items));
  }

  return {
    // READS — a server error propagates. Only a genuine network failure
    // falls back to the cache, so "we're offline" never masquerades as
    // "the server said no".
    async list(sort, limit, offset) {
      try {
        const res = await api.get(`/api/entities/${entityName}`, { params: { sort, limit, offset } });
        return res.data;
      } catch (error) {
        if (!isOffline(error)) throw toApiError(error, `Loading ${entityName}`);
        const items = getAll();
        if (sort && sort.startsWith('-')) {
          const field = sort.slice(1);
          items.sort((a, b) => (b[field] || '').localeCompare(a[field] || ''));
        }
        return limit ? items.slice(0, limit) : items;
      }
    },

    async filter(query, sort, limit, offset) {
      try {
        const res = await api.post(`/api/entities/${entityName}/filter`, { query, sort, limit, offset });
        return res.data;
      } catch (error) {
        if (!isOffline(error)) throw toApiError(error, `Loading ${entityName}`);
        let items = getAll();
        if (query) {
          items = items.filter((item) =>
            Object.entries(query).every(([k, v]) => item[k] === v)
          );
        }
        if (sort && sort.startsWith('-')) {
          const field = sort.slice(1);
          items.sort((a, b) => (b[field] || 0) - (a[field] || 0));
        } else if (sort) {
          items.sort((a, b) => (a[sort] || 0) - (b[sort] || 0));
        }
        return limit ? items.slice(0, limit) : items;
      }
    },

    // WRITES — never faked. A write that did not reach the server did not
    // happen, so the caller (and the user) must see the failure.
    async create(data) {
      try {
        const res = await api.post(`/api/entities/${entityName}`, data);
        return res.data;
      } catch (error) {
        throw toApiError(error, `Saving ${entityName}`);
      }
    },

    async update(id, data) {
      try {
        const res = await api.put(`/api/entities/${entityName}/${id}`, data);
        return res.data;
      } catch (error) {
        throw toApiError(error, `Updating ${entityName}`);
      }
    },

    async delete(id) {
      try {
        await api.delete(`/api/entities/${entityName}/${id}`);
      } catch (error) {
        throw toApiError(error, `Deleting ${entityName}`);
      }
    },

    async get(id) {
      try {
        const res = await api.get(`/api/entities/${entityName}/${id}`);
        return res.data;
      } catch (error) {
        if (!isOffline(error)) throw toApiError(error, `Loading ${entityName}`);
        return getAll().find((i) => i.id === id) || null;
      }
    },
  };
}

export const base44 = {
  auth: {
    async me() {
      try {
        const res = await api.get('/api/auth/me');
        return res.data;
      } catch (error) {
        // A 401/403 means the session is GONE — returning the cached user
        // here used to defeat server-side session invalidation entirely
        // (a banned or logged-out user still looked signed in).
        if (!isOffline(error)) throw toApiError(error, 'Loading your account');
        return JSON.parse(localStorage.getItem('voxel_user') || 'null');
      }
    },
    redirectToLogin(returnUrl, opts) {
      window.__voxelLoginModal?.('login');
    },
    logout(redirectUrl) {
      localStorage.removeItem('voxel_token');
      localStorage.removeItem('voxel_user');
      if (redirectUrl) window.location.href = redirectUrl;
    },
  },

  functions: {
    async invoke(funcName, params) {
      const res = await api.post(`/api/${funcName}`, params);
      return { data: res.data };
    },
  },

  entities: new Proxy({}, {
    get(_, entityName) {
      return createEntityProxy(entityName);
    },
  }),

  storage: {
    async upload(file) {
      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await api.post('/api/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        return res.data;
      } catch (error) {
        // Used to return a blob: URL the server has never seen — the caller
        // then "saved" a reference no backend could ever resolve.
        throw toApiError(error, 'Uploading the file');
      }
    },
  },

  integrations: {
    Core: {
      async GenerateImage({ prompt, existing_image_urls }) {
        const imageUrls = existing_image_urls || [];
        const res = await api.post('/api/generate', {
          type: 'image',
          model: 'Nano Banana Pro',
          prompt,
          ratio: '1:1',
          quality: '1K',
          imageUrls,
        });
        const url = res.data?.result_url;
        return { uri: url, url };
      },
      async InvokeLLM({ prompt, response_json_schema }) {
        const res = await api.post('/api/llm', { prompt, response_json_schema });
        return res.data;
      },
    },
  },
};
