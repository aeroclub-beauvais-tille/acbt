// Fichier d'un document déposé depuis l'appli : les morceaux rangés dans D1 sont recollés et envoyés au navigateur.
// Protégé par le cookie des membres (tout /membre/ l'est, voir _middleware.js).
import { tableDocs } from '../../../_docs.js';

export async function onRequestGet({ params, env }) {
  if (!env.DB) return new Response('Base non reliée.', { status: 503 });
  await tableDocs(env.DB);
  const id = String(params.id || '');
  const doc = await env.DB.prepare('SELECT fichier, mime, morceaux FROM docs WHERE id = ?1').bind(id).first();
  if (!doc) return new Response('Document introuvable.', { status: 404 });
  let i = 0;
  const corps = new ReadableStream({
    async pull(ctl) {
      // Un morceau à la fois : jamais tout le fichier en mémoire
      if (i >= doc.morceaux) { ctl.close(); return; }
      const m = await env.DB.prepare('SELECT data FROM docs_morceaux WHERE doc = ?1 AND n = ?2').bind(id, i++).first();
      if (!m) { ctl.close(); return; }
      ctl.enqueue(new Uint8Array(m.data));
    },
  });
  const nom = encodeURIComponent(doc.fichier);
  return new Response(corps, {
    headers: {
      'Content-Type': doc.mime || 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${nom}`,
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
