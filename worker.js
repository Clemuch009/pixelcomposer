const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function err(msg, status = 400) {
  return json({ ok: false, error: msg }, status);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // POST /feedback — submit feedback
    if (request.method === 'POST' && url.pathname === '/feedback') {
      let body;
      try {
        body = await request.json();
      } catch {
        return err('invalid JSON');
      }

      const rating  = parseInt(body.rating)  || null;
      const message = (body.message || '').trim().slice(0, 2000);

      // Basic spam protection — need at least one of rating or message
      if (!rating && !message) {
        return err('empty submission');
      }

      // Rate limit: max 5 submissions per IP per hour (simple check via D1)
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const recent = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM feedback
         WHERE ip = ? AND created_at > datetime('now', '-1 hour')`
      ).bind(ip).first();

      if (recent && recent.cnt >= 5) {
        return err('too many submissions — try again later', 429);
      }

      await env.DB.prepare(
        `INSERT INTO feedback (rating, message, ip) VALUES (?, ?, ?)`
      ).bind(rating, message || null, ip).run();

      return json({ ok: true });
    }

    // GET /feedback — read all feedback (add a secret key for your eyes only)
    if (request.method === 'GET' && url.pathname === '/feedback') {
      const key = url.searchParams.get('key');
      if (key !== env.ADMIN_KEY) {
        return err('unauthorized', 401);
      }
      const rows = await env.DB.prepare(
        `SELECT id, rating, message, created_at FROM feedback ORDER BY created_at DESC LIMIT 200`
      ).all();
      return json({ ok: true, total: rows.results.length, feedback: rows.results });
    }

    return err('not found', 404);
  },
};
