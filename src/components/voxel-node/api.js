// Voxel Node — thin client for the /api/node/* routes. Reuses the same
// bearer-token scheme the rest of the app uses (localStorage voxel_token).

const TOKEN_KEY = 'voxel_token';

function headers() {
  const token = localStorage.getItem(TOKEN_KEY);
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function jsonOrThrow(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const nodeApi = {
  listSpaces: () =>
    fetch('/api/node/spaces', { headers: headers() }).then(jsonOrThrow),

  createSpace: (name) =>
    fetch('/api/node/spaces', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name }),
    }).then(jsonOrThrow),

  getSpace: (id) =>
    fetch(`/api/node/spaces/${id}`, { headers: headers() }).then(jsonOrThrow),

  saveSpace: (id, { graph, name }) =>
    fetch(`/api/node/spaces/${id}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ graph, name }),
    }).then(jsonOrThrow),

  runNode: (type, settings) =>
    fetch('/api/node/run-node', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ type, settings }),
    }).then(jsonOrThrow),

  // Submit an async (video) node → returns { job_id, model_id }.
  runNodeAsync: (type, settings) =>
    fetch('/api/node/run-node-async', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ type, settings }),
    }).then(jsonOrThrow),

  // Poll FAL job status via the existing video-status route.
  videoStatus: (job_id, model_id) =>
    fetch('/api/video-status', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ job_id, model_id }),
    }).then(jsonOrThrow),
};
