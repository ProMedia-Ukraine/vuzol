// «Команда» block: content/team.json + photos in content/team/.
// New blocks follow the same shape: load(cfg) and save(cfg, body, user).

import { readText, commit, GitHubError } from '../github.js';

const DATA = 'content/team.json';
const PHOTOS = 'content/team/';
const MAX_PEOPLE = 60;
const MAX_PHOTO_BYTES = 600 * 1024;

export const title = 'Команда';

export async function load(cfg) {
  const file = await readText(cfg, DATA);
  const data = file ? JSON.parse(file.text) : { members: [] };
  return { members: data.members || [], sha: file?.sha || null };
}

function slugify(text) {
  const map = { а:'a',б:'b',в:'v',г:'h',ґ:'g',д:'d',е:'e',є:'ie',ж:'zh',з:'z',и:'y',і:'i',ї:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ь:'',ю:'iu',я:'ia',"'":'','’':'' };
  const s = String(text).toLowerCase().split('').map((c) => map[c] ?? c).join('');
  return s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'person';
}

function clean(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function bad(message) {
  return new GitHubError(message, 400);
}

export async function save(cfg, body, user) {
  if (!Array.isArray(body.members)) throw bad('Немає списку людей.');
  if (body.members.length > MAX_PEOPLE) throw bad(`Забагато людей (більше ${MAX_PEOPLE}).`);

  const current = await load(cfg);
  const oldPhotos = new Set(current.members.map((m) => m.photo).filter(Boolean));
  const usedIds = new Set();
  const changes = [];
  const members = [];
  const stamp = Date.now().toString(36);

  for (const [i, raw] of body.members.entries()) {
    const name = clean(raw.name, 80);
    const role = clean(raw.role, 140);
    const instagram = clean(raw.instagram, 300);
    if (!name) throw bad(`У рядку ${i + 1} немає імені.`);
    if (instagram && !/^https:\/\/(www\.)?instagram\.com\/[^\s]+$/i.test(instagram)) {
      throw bad(`${name}: посилання на Instagram має починатися з https://www.instagram.com/`);
    }
    let id = clean(raw.id, 60).replace(/[^a-z0-9-]/g, '') || slugify(name);
    while (usedIds.has(id)) id += '-2';
    usedIds.add(id);

    let photo = oldPhotos.has(raw.photo) ? raw.photo : '';
    if (raw.newPhoto) {
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(raw.newPhoto);
      if (!m) throw bad(`${name}: фото має бути у форматі JPEG.`);
      if (m[1].length * 0.75 > MAX_PHOTO_BYTES) throw bad(`${name}: фото завелике.`);
      photo = `${id}-${stamp}.jpg`; // new name each time, so browsers don't show the old cached photo
      changes.push({ path: PHOTOS + photo, base64: m[1] });
    }
    if (!photo) throw bad(`${name}: додайте фото.`);
    members.push({ id, name, role, instagram, photo });
  }

  // Photos nobody uses any more are deleted from the repository.
  const kept = new Set(members.map((m) => m.photo));
  for (const p of oldPhotos) if (!kept.has(p)) changes.push({ path: PHOTOS + p, delete: true });

  changes.push({ path: DATA, text: JSON.stringify({ members }, null, 2) + '\n' });

  const summary = describe(current.members, members);
  const sha = await commit(cfg, {
    message: `Адмінка: команда — ${summary || 'оновлення'} (${user.name})`,
    changes,
    expect: { path: DATA, sha: body.sha ?? null },
    author: `${user.name} (адмінка VUZOL)`,
  });
  return { commit: sha, summary, ...(await load(cfg)) };
}

// Short human description of the change, for the commit and the log.
function describe(before, after) {
  const byId = new Map(before.map((m) => [m.id, m]));
  const afterIds = new Set(after.map((m) => m.id));
  const parts = [];
  const added = after.filter((m) => !byId.has(m.id)).map((m) => m.name);
  const removed = before.filter((m) => !afterIds.has(m.id)).map((m) => m.name);
  const edited = after
    .filter((m) => byId.has(m.id))
    .filter((m) => ['name', 'role', 'instagram', 'photo'].some((k) => byId.get(m.id)[k] !== m[k]))
    .map((m) => m.name);
  const sameOrder = before.filter((m) => afterIds.has(m.id)).map((m) => m.id).join() ===
    after.filter((m) => byId.has(m.id)).map((m) => m.id).join();
  if (added.length) parts.push('додано: ' + added.join(', '));
  if (removed.length) parts.push('прибрано: ' + removed.join(', '));
  if (edited.length) parts.push('змінено: ' + edited.join(', '));
  if (!sameOrder) parts.push('новий порядок');
  return parts.join('; ');
}
