import React, { useEffect, useRef, useState } from 'react';
import { sendChat, getToken } from '../services/api';

const wsUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://localhost:8000/ws/chat?token=${encodeURIComponent(getToken())}`;
};

export default function ChatPanel() {
  const [msg, setMsg] = useState('organize my downloads');
  const [out, setOut] = useState(null);
  const [events, setEvents] = useState([]);
  const [confirmDangerous, setConfirmDangerous] = useState(false);
  const [loading, setLoading] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;
    ws.onmessage = (e) => setEvents((prev) => [...prev.slice(-20), JSON.parse(e.data)]);
    return () => ws.close();
  }, []);

  const run = async () => {
    setLoading(true);
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ message: msg, session_id: 'desktop', confirm_dangerous: confirmDangerous }));
    }
    try {
      setOut((await sendChat(msg, confirmDangerous)).data);
    } finally {
      setLoading(false);
    }
  };

  return <section><h2>AI Chat Interface</h2>
    <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={4} style={{width:'100%'}} />
    <label><input type="checkbox" checked={confirmDangerous} onChange={(e) => setConfirmDangerous(e.target.checked)} /> Confirm dangerous actions</label>
    <button onClick={run} disabled={loading}>{loading ? 'Running...' : 'Execute'}</button>
    <pre>{JSON.stringify(out, null, 2)}</pre>
    <h4>Live Action Trace</h4>
    <pre>{JSON.stringify(events, null, 2)}</pre>
  </section>;
}
