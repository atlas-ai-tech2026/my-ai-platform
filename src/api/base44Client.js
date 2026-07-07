import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('voxel_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

function createEntityProxy(entityName) {
  const storageKey = `voxel_${entityName}`;

  function getAll() {
    return JSON.parse(localStorage.getItem(storageKey) || '[]');
  }
  function saveAll(items) {
    localStorage.setItem(storageKey, JSON.stringify(items));
  }

  return {
    async list(sort, limit, offset) {
      try {
        const res = await api.get(`/api/entities/${entityName}`, { params: { sort, limit, offset } });
        return res.data;
      } catch {
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
      } catch {
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

    async create(data) {
      try {
        const res = await api.post(`/api/entities/${entityName}`, data);
        return res.data;
      } catch {
        const items = getAll();
        const newItem = {
          ...data,
          id: crypto.randomUUID(),
          created_date: new Date().toISOString(),
          updated_date: new Date().toISOString(),
        };
        items.push(newItem);
        saveAll(items);
        return newItem;
      }
    },

    async update(id, data) {
      try {
        const res = await api.put(`/api/entities/${entityName}/${id}`, data);
        return res.data;
      } catch {
        const items = getAll();
        const idx = items.findIndex((i) => i.id === id);
        if (idx !== -1) {
          items[idx] = { ...items[idx], ...data, updated_date: new Date().toISOString() };
          saveAll(items);
          return items[idx];
        }
        return null;
      }
    },

    async delete(id) {
      try {
        await api.delete(`/api/entities/${entityName}/${id}`);
      } catch {
        const items = getAll().filter((i) => i.id !== id);
        saveAll(items);
      }
    },

    async get(id) {
      try {
        const res = await api.get(`/api/entities/${entityName}/${id}`);
        return res.data;
      } catch {
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
      } catch {
        const user = JSON.parse(localStorage.getItem('voxel_user') || 'null');
        return user;
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
      } catch {
        return { url: URL.createObjectURL(file) };
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
