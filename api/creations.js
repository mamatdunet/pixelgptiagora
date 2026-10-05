// La galerie collective IAgora : liste, publication et suppression des cartes.
// Images and their metadata live in Vercel Blob under creations/<id>.png and creations/<id>.json.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { del, list, put } from '@vercel/blob';

const ID = /^[0-9]{13}-[0-9a-f]{8}$/;
const MAX_BYTES = 3 * 1024 * 1024; // Vercel functions accept request bodies up to 4.5 MB (base64 adds a third)
// Deleting a card needs the workshop password. Only its SHA-256 is kept; DELETE_PASSWORD overrides it.
const DELETE_PASSWORD_SHA256 = '1b604517a7e8619e288238c02dcc1a949987c900bafa2036b2bc9a8607ea1add';

const sha256 = value => createHash('sha256').update(value).digest();
const sameSecret = (given, expectedHash) => timingSafeEqual(sha256(given), expectedHash);
const clean = (value, max) => String(value ?? '').split(/\s+/).filter(Boolean).join(' ').slice(0, max);

async function listCreations() {
  const metas = [];
  let cursor;
  do {
    const page = await list({ prefix: 'creations/', limit: 1000, cursor });
    metas.push(...page.blobs.filter(blob => blob.pathname.endsWith('.json')));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const creations = await Promise.all(metas.map(async blob => {
    try {
      const response = await fetch(blob.url);
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }));
  return creations.filter(Boolean).sort((a, b) => b.id.localeCompare(a.id));
}

// Cards are published by the editor served from this same site (checked with the Origin header),
// or by a workshop server holding PUBLISH_TOKEN.
function mayPublish(req) {
  const token = process.env.PUBLISH_TOKEN;
  if (token && sameSecret(String(req.headers['x-publish-token'] ?? ''), sha256(token))) return true;
  try {
    return new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function publish(req, res) {
  if (!mayPublish(req)) return res.status(403).json({ detail: 'Publication réservée à l’atelier.' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
  const prefix = 'data:image/png;base64,';
  if (typeof body.image !== 'string' || !body.image.startsWith(prefix)) {
    return res.status(400).json({ detail: 'L’image doit être un PNG.' });
  }
  const png = Buffer.from(body.image.slice(prefix.length), 'base64');
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!png.subarray(0, 8).equals(signature) || png.length > MAX_BYTES) {
    return res.status(400).json({ detail: 'Image invalide ou trop lourde.' });
  }
  const id = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const image = await put(`creations/${id}.png`, png, {
    access: 'public', contentType: 'image/png', addRandomSuffix: false
  });
  const meta = {
    id,
    title: clean(body.title, 80) || 'Sans titre',
    author: clean(body.author, 40),
    orientation: body.orientation === 'portrait' ? 'portrait' : 'landscape',
    created_at: new Date().toISOString(),
    image: image.url
  };
  await put(`creations/${id}.json`, JSON.stringify(meta), {
    access: 'public', contentType: 'application/json', addRandomSuffix: false
  });
  return res.status(200).json(meta);
}

async function remove(req, res) {
  const password = String(req.headers['x-gallery-password'] ?? '');
  const expected = process.env.DELETE_PASSWORD ? sha256(process.env.DELETE_PASSWORD) : Buffer.from(DELETE_PASSWORD_SHA256, 'hex');
  if (!sameSecret(password, expected)) {
    await new Promise(resolve => setTimeout(resolve, 1000)); // slows down guessing
    return res.status(403).json({ detail: 'Mot de passe incorrect.' });
  }
  const id = String(req.query.id ?? '');
  if (!ID.test(id)) return res.status(404).json({ detail: 'Création introuvable.' });
  const { blobs } = await list({ prefix: `creations/${id}.` });
  if (!blobs.length) return res.status(404).json({ detail: 'Création introuvable.' });
  await del(blobs.map(blob => blob.url));
  return res.status(200).json({ deleted: id });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ storage: 'online', creations: await listCreations() });
    }
    if (req.method === 'POST') return await publish(req, res);
    if (req.method === 'DELETE') return await remove(req, res);
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ detail: 'Méthode non autorisée.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'La galerie en ligne a rencontré une erreur.' });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '4.5mb' } } };
