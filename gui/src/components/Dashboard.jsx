import React, { useEffect, useState } from 'react';
import { getTools } from '../services/api';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const load = () => getTools().then(r => setData(r.data));
  useEffect(() => { load(); }, []);
  return <section>
    <h3>Dashboard</h3>
    <button onClick={load}>Refresh Analytics</button>
    <pre>{JSON.stringify(data?.analytics ?? {}, null, 2)}</pre>
  </section>;
}
