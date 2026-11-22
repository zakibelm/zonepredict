// Proxy Vercel en lecture seule vers le backend ZonePredict (VPS).
// La clé partagée reste côté serveur (variable d'environnement) : jamais dans le navigateur.
const ALLOWED = new Set(['dashboard', 'forecasts/latest', 'evaluations/latest', 'health']);
const PERIODS = new Set(['7d', '30d', 'all']);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'method_not_allowed', message: 'Lecture seule : GET uniquement' }));
  }
  const raw = req.query.path;
  const path = (Array.isArray(raw) ? raw : [raw || '']).join('/');
  if (!ALLOWED.has(path)) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ error: 'not_found', message: 'Route inconnue' }));
  }
  const base = (process.env.ZONEPREDICT_BACKEND_URL || '').replace(/\/+$/, '');
  const key = process.env.ZONEPREDICT_PROXY_KEY || '';
  if (!base.startsWith('https://') || !key) {
    res.statusCode = 503;
    return res.end(JSON.stringify({
      error: 'backend_not_configured',
      message: 'Backend ZonePredict non configuré (ZONEPREDICT_BACKEND_URL / ZONEPREDICT_PROXY_KEY). Aucune donnée affichée.',
    }));
  }
  let url = `${base}/api/${path}`;
  if (path === 'dashboard') {
    const period = String(req.query.period || '7d');
    if (!PERIODS.has(period)) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'bad_period', message: 'period doit valoir 7d, 30d ou all' }));
    }
    url += `?period=${period}`;
  }
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json', 'X-ZonePredict-Key': key },
      signal: AbortSignal.timeout(15000),
    });
    res.statusCode = r.status;
    return res.end(await r.text());
  } catch (err) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: 'backend_unreachable', message: 'Backend injoignable ou trop lent' }));
  }
};
