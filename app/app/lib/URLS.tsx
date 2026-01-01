export const BASE_URL = process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : 'https://memories.brozy.org';
export const SOCIAL_URL = `${BASE_URL}/api/socials/`;
export const IMAGE_BASE_URL = process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : 'https://memories-load.vercel.app';