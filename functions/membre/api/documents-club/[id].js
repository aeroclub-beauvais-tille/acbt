// Fichier d'un document du club déposé depuis l'appli : les morceaux rangés dans D1 sont recollés.
// Protégé par le cookie des membres (tout /membre/ l'est, voir _middleware.js).
import { tableDocsClub } from '../../../_docs_club.js';

export async function onRequestGet({ params, env }) {
  if (!env.DB) return new Response('Base non reliée.', { status: 503 });
  await tableDocsClub(env.DB);
  const id = String(params.id || '');
  const doc = await env.DB.prepare('SELECT fichier, mime, morceaux FROM docs_club WHERE id = ?1 AND morceaux > 0').bind(id).first();
  if (!doc) return new Response('Document introuvable.', { status: 404 });
  let i = 0;
  const corps = new ReadableStream({
    async pull(ctl) {
      if (i >= doc.morceaux) { ctl.close(); return; }
      const m = await env.DB.prepare('SELECT data FROM docs_club_morceaux WHERE doc = ?1 AND n = ?2').bind(id, i++).first();
      if (!m) { ctl.close(); return; }
      ctl.enqueue(new Uint8Array(m.data));
    },
  });
  return new Response(corps, {
    headers: {
      'Content-Type': doc.mime || 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(doc.fichier || 'document')}`,
      // Le fichier d'une version ne change jamais (un remplacement crée une nouvelle version)
      'Cache-Control': 'private, max-age=604800, immutable',
    },
  });
}
