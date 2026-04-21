export const appParams = {
  appId: 'voxel-ai',
  token: localStorage.getItem('voxel_token') || '',
  appBaseUrl: import.meta.env.VITE_API_BASE_URL || '',
};
