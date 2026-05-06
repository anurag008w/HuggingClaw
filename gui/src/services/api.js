import axios from 'axios';

const token = import.meta.env.VITE_DIVYA_TOKEN || 'divya-dev-token';
const client = axios.create({
  baseURL: 'http://localhost:8000',
  headers: { 'x-divya-token': token }
});

export const getToken = () => token;
export const sendChat = (message, confirm_dangerous = false) => client.post('/chat', { message, session_id: 'desktop', confirm_dangerous });
export const getTools = () => client.get('/tools');
export const getAnalytics = () => client.get('/analytics');
export const searchMemory = (query) => client.post('/memory/search', { session_id: 'desktop', query });
