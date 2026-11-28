// Version publiée de l'espace membre (le commit), lue par l'appli pour savoir si elle doit se recharger.
import type { APIRoute } from 'astro';
export const GET: APIRoute = () => new Response(process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || '', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
