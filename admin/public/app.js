// VUZOL admin — front end. Plain JS, no build step.

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
let me = null;

async function api(path, { method = 'GET', data } = {}) {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: data ? { 'Content-Type': 'application/json' } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login' && me) {
    me = null;
    start();
  }
  if (!res.ok) throw Object.assign(new Error(out.error || `Помилка ${res.status}`), { status: res.status });
  return out;
}

function mount(tplId) {
  app.replaceChildren($(tplId).content.cloneNode(true));
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function bindForm(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-error]', form);
    const btn = $('[type=submit]', form);
    err.textContent = '';
    btn.disabled = true;
    try {
      await handler(formData(form));
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- Start, login, navigation ----------

const PAGES = { team: showTeam, users: showUsers, log: showLog };

async function start() {
  const state = await api('/state').catch((e) => ({ error: e.message }));
  if (state.error) {
    app.innerHTML = `<p class="error"></p>`;
    $('.error', app).textContent = state.error;
    return;
  }
  me = state.user;
  $('#nav').hidden = $('#who').hidden = !me;
  if (!me) return state.needsSetup ? showSetup() : showLogin();
  $('#who-name').textContent = me.name;
  const links = [['team', 'Команда'], ['log', 'Журнал']];
  if (me.role === 'admin') links.push(['users', 'Доступи']);
  $('#nav').replaceChildren(...links.map(([id, title]) => {
    const a = Object.assign(document.createElement('a'), { href: '#' + id, textContent: title });
    a.dataset.page = id;
    return a;
  }));
  route();
  watchDeploy();
}

function route() {
  if (!me) return;
  const page = location.hash.slice(1) || 'team';
  const show = PAGES[page] && (page !== 'users' || me.role === 'admin') ? PAGES[page] : showTeam;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.page === page));
  show();
}

window.addEventListener('hashchange', () => {
  if (teamDirty() && !confirm('Є незбережені зміни в команді. Піти без збереження?')) return;
  route();
});
window.addEventListener('beforeunload', (e) => {
  if (teamDirty()) e.preventDefault();
});

function showLogin() {
  mount('#tpl-login');
  bindForm($('#form-login'), async (d) => {
    await api('/login', { method: 'POST', data: d });
    start();
  });
  $('#form-login input').focus();
}

function showSetup() {
  mount('#tpl-setup');
  bindForm($('#form-setup'), async (d) => {
    await api('/setup', { method: 'POST', data: d });
    start();
  });
}

$('#btn-logout').addEventListener('click', async () => {
  if (teamDirty() && !confirm('Є незбережені зміни. Вийти без збереження?')) return;
  team = null;
  await api('/logout', { method: 'POST', data: {} });
  location.hash = '';
  start();
});

// ---------- Password dialog ----------

const pwDialog = $('#pw');
let pwTarget = null; // null = my own password, otherwise user object (admin reset)
function openPassword(target) {
  pwTarget = target;
  const form = $('#form-pw');
  form.reset();
  $('[data-error]', form).textContent = '';
  $('#pw-title').textContent = target ? `Новий пароль: ${target.name}` : 'Змінити мій пароль';
  $('[data-current]', form).hidden = Boolean(target);
  $('[name=current]', form).required = !target;
  pwDialog.showModal();
}
$('#btn-password').addEventListener('click', () => openPassword(null));
$('[data-close]', pwDialog).addEventListener('click', () => pwDialog.close());
bindForm($('#form-pw'), async (d) => {
  if (pwTarget) await api(`/users/${pwTarget.id}/password`, { method: 'POST', data: { password: d.password } });
  else await api('/me/password', { method: 'POST', data: d });
  pwDialog.close();
  alert(pwTarget ? 'Пароль змінено. Передайте його людині особисто.' : 'Пароль змінено.');
});

// ---------- Team ----------

let team = null; // { sha, members: [...], saved: JSON snapshot }
const snapshot = (members) => JSON.stringify(members.map(({ id, name, role, instagram, photo, newPhoto }) => ({ id, name, role, instagram, photo, newPhoto: Boolean(newPhoto) })));
const teamDirty = () => Boolean(team && snapshot(team.members) !== team.saved);

async function showTeam() {
  mount('#tpl-team');
  const list = $('#people');
  if (!team) {
    list.innerHTML = '<li class="muted">Завантажую склад команди…</li>';
    try {
      const data = await api('/blocks/team');
      team = { sha: data.sha, members: data.members, saved: snapshot(data.members) };
    } catch (e) {
      $('#team-error').textContent = e.message;
      list.innerHTML = '';
      return;
    }
  }
  renderPeople();
  $('#btn-add').addEventListener('click', () => {
    team.members.push({ id: '', name: '', role: '', instagram: '', photo: '', isNew: true });
    renderPeople();
    const last = list.lastElementChild;
    last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('.f-name', last).focus();
  });
  $('#btn-save').addEventListener('click', saveTeam);
}

function photoSrc(m) {
  if (m.newPhoto) return m.newPhoto;
  return m.photo ? `/api/photo/team/${encodeURIComponent(m.photo)}` : '';
}

function renderPeople() {
  const list = $('#people');
  if (!list) return;
  const saved = new Map(JSON.parse(team.saved).map((m) => [m.id, m]));
  list.replaceChildren(...team.members.map((m, i) => {
    const li = $('#tpl-person').content.firstElementChild.cloneNode(true);
    const old = saved.get(m.id);
    li.classList.toggle('new', !old);
    li.classList.toggle('changed', Boolean(old) && (old.name !== m.name || old.role !== m.role || old.instagram !== m.instagram || Boolean(m.newPhoto)));
    const img = $('.avatar img', li);
    img.src = photoSrc(m);
    $('.avatar', li).classList.toggle('empty', !img.getAttribute('src'));
    img.alt = m.name;
    for (const key of ['name', 'role', 'instagram']) {
      const input = $(`.f-${key}`, li);
      input.value = m[key] || '';
      input.addEventListener('input', () => {
        m[key] = input.value;
        $('#team-error').textContent = '';
        updateSaveButton();
        li.classList.toggle('changed', Boolean(old) && (old.name !== m.name || old.role !== m.role || old.instagram !== m.instagram || Boolean(m.newPhoto)));
      });
    }
    $('.avatar', li).addEventListener('click', () => pickPhoto(m));
    $('[data-up]', li).disabled = i === 0;
    $('[data-down]', li).disabled = i === team.members.length - 1;
    $('[data-up]', li).addEventListener('click', () => move(i, i - 1));
    $('[data-down]', li).addEventListener('click', () => move(i, i + 1));
    $('[data-remove]', li).addEventListener('click', () => {
      if (m.name && !confirm(`Прибрати «${m.name}» з сайту? Зміна з’явиться на сайті після збереження.`)) return;
      team.members.splice(i, 1);
      renderPeople();
    });
    // Drag and drop to reorder
    li.addEventListener('dragstart', (e) => {
      if (e.target.closest('input')) return e.preventDefault();
      li.classList.add('dragging');
      e.dataTransfer.setData('text/plain', String(i));
      e.dataTransfer.effectAllowed = 'move';
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('over'); });
    li.addEventListener('dragleave', () => li.classList.remove('over'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('over');
      const from = Number(e.dataTransfer.getData('text/plain'));
      if (!Number.isNaN(from)) move(from, i);
    });
    return li;
  }));
  updateSaveButton();
}

function move(from, to) {
  if (to < 0 || to >= team.members.length || from === to) return;
  const [m] = team.members.splice(from, 1);
  team.members.splice(to, 0, m);
  renderPeople();
}

function updateSaveButton() {
  const btn = $('#btn-save');
  if (btn) btn.disabled = !teamDirty();
}

async function saveTeam() {
  const err = $('#team-error');
  err.textContent = '';
  const problems = [];
  team.members.forEach((m, i) => {
    const who = m.name?.trim() || `Рядок ${i + 1}`;
    if (!m.name?.trim()) problems.push(`${who}: немає імені`);
    if (!m.photo && !m.newPhoto) problems.push(`${who}: немає фото`);
    if (m.instagram?.trim() && !/^https:\/\/(www\.)?instagram\.com\/\S+$/i.test(m.instagram.trim())) problems.push(`${who}: посилання на Instagram має починатися з https://www.instagram.com/`);
  });
  if (problems.length) {
    err.textContent = problems.join('\n');
    return;
  }
  const btn = $('#btn-save');
  btn.disabled = true;
  btn.textContent = 'Зберігаю…';
  try {
    const out = await api('/blocks/team', {
      method: 'PUT',
      data: { sha: team.sha, members: team.members.map(({ id, name, role, instagram, photo, newPhoto }) => ({ id, name, role, instagram, photo, newPhoto })) },
    });
    team = { sha: out.sha, members: out.members, saved: snapshot(out.members) };
    renderPeople();
    watchDeploy(out.commit);
  } catch (e) {
    err.textContent = e.message;
    if (e.status === 409) err.textContent += '\nВаші зміни ще тут: скопіюйте потрібне, потім оновіть сторінку.';
  } finally {
    btn.textContent = 'Зберегти на сайті';
    updateSaveButton();
  }
}

// ---------- Photo crop ----------

const fileInput = $('#file');
const cropDialog = $('#crop');
const canvas = $('#crop-canvas');
const ctx = canvas.getContext('2d');
const zoomInput = $('#crop-zoom');
const OUT = 640;
let crop = null; // { img, zoom, ox, oy, member }

function pickPhoto(member) {
  fileInput.value = '';
  fileInput.onchange = () => {
    const file = fileInput.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      crop = { img, zoom: 1, ox: 0, oy: 0, member };
      zoomInput.value = 1;
      drawCrop();
      cropDialog.showModal();
    };
    img.onerror = () => alert('Не вдалося відкрити цей файл як фото. Спробуйте JPG або PNG.');
    img.src = url;
  };
  fileInput.click();
}

function geometry(size) {
  const { img, zoom } = crop;
  const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight) * zoom;
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  const k = size / canvas.width;
  const maxX = (w - size) / 2;
  const maxY = (h - size) / 2;
  crop.ox = Math.max(-maxX / k, Math.min(maxX / k, crop.ox));
  crop.oy = Math.max(-maxY / k, Math.min(maxY / k, crop.oy));
  return { x: (size - w) / 2 + crop.ox * k, y: (size - h) / 2 + crop.oy * k, w, h };
}

function drawCrop() {
  const g = geometry(canvas.width);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(crop.img, g.x, g.y, g.w, g.h);
}

zoomInput.addEventListener('input', () => { crop.zoom = Number(zoomInput.value); drawCrop(); });
{
  const stage = $('#crop-stage');
  let drag = null;
  stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, ox: crop.ox, oy: crop.oy }; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const ratio = canvas.width / stage.clientWidth;
    crop.ox = drag.ox + (e.clientX - drag.x) * ratio;
    crop.oy = drag.oy + (e.clientY - drag.y) * ratio;
    drawCrop();
  });
  stage.addEventListener('pointerup', () => { drag = null; });
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    crop.zoom = Math.max(1, Math.min(4, crop.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06)));
    zoomInput.value = crop.zoom;
    drawCrop();
  }, { passive: false });
}

cropDialog.addEventListener('close', () => {
  if (cropDialog.returnValue !== 'ok' || !crop) return;
  const out = document.createElement('canvas');
  out.width = out.height = OUT;
  const g = geometry(OUT);
  const octx = out.getContext('2d');
  octx.fillStyle = '#fff';
  octx.fillRect(0, 0, OUT, OUT);
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(crop.img, g.x, g.y, g.w, g.h);
  crop.member.newPhoto = out.toDataURL('image/jpeg', 0.86);
  URL.revokeObjectURL(crop.img.src);
  crop = null;
  renderPeople();
});

// ---------- Users ----------

async function showUsers() {
  mount('#tpl-users');
  const tbody = $('#users');
  const load = async () => {
    const { users } = await api('/users');
    tbody.replaceChildren(...users.map((u) => {
      const tr = document.createElement('tr');
      const cells = [u.name, u.login, u.role === 'admin' ? 'Адміністратор' : 'Редактор', u.last_login_at ? u.last_login_at.slice(0, 16) : '—'];
      cells.forEach((c) => tr.appendChild(Object.assign(document.createElement('td'), { textContent: c })));
      const td = document.createElement('td');
      const reset = Object.assign(document.createElement('button'), { className: 'icon', title: 'Задати новий пароль', textContent: '🔑', type: 'button' });
      reset.onclick = () => openPassword(u);
      td.append(reset);
      if (u.id !== me.id) {
        const del = Object.assign(document.createElement('button'), { className: 'icon danger', title: 'Забрати доступ', textContent: '✕', type: 'button' });
        del.onclick = async () => {
          if (!confirm(`Забрати доступ до адмінки в ${u.name}?`)) return;
          try { await api(`/users/${u.id}`, { method: 'DELETE' }); load(); } catch (e) { alert(e.message); }
        };
        td.append(' ', del);
      }
      tr.append(td);
      return tr;
    }));
  };
  bindForm($('#form-user'), async (d) => {
    await api('/users', { method: 'POST', data: d });
    $('#form-user').reset();
    load();
  });
  load().catch((e) => { $('#form-user [data-error]').textContent = e.message; });
}

// ---------- Log ----------

const ACTIONS = { 'save:team': 'Команда', setup: 'Перший вхід', password: 'Зміна пароля', 'user:add': 'Новий доступ', 'user:delete': 'Доступ забрано', 'user:password': 'Новий пароль для' };

async function showLog() {
  mount('#tpl-log');
  const { log } = await api('/log');
  $('#log').replaceChildren(...log.map((r) => {
    const tr = document.createElement('tr');
    [r.at.slice(0, 16), r.user_login || '—', `${ACTIONS[r.action] || r.action}${r.details ? ': ' + r.details : ''}`]
      .forEach((c) => tr.appendChild(Object.assign(document.createElement('td'), { textContent: c })));
    return tr;
  }));
}

// ---------- Site deploy status ----------

let deployTimer = null;
async function watchDeploy(expectSha) {
  clearTimeout(deployTimer);
  const bar = $('#deploy');
  const started = Date.now();
  const tick = async () => {
    let run = null;
    try { ({ run } = await api('/deploy-status')); } catch { /* ignore */ }
    const waitingForNew = expectSha && (!run || run.sha !== expectSha);
    if (waitingForNew && Date.now() - started < 3 * 60 * 1000) {
      bar.hidden = false;
      bar.className = 'deploy';
      bar.textContent = 'Збережено. Сайт починає оновлюватися…';
    } else if (run && run.status !== 'completed') {
      bar.hidden = false;
      bar.className = 'deploy';
      bar.textContent = 'Збережено. Сайт оновлюється, зазвичай це 1–3 хвилини…';
    } else if (run && expectSha && run.sha === expectSha) {
      bar.hidden = false;
      const ok = run.conclusion === 'success';
      bar.className = 'deploy ' + (ok ? 'ok' : 'bad');
      bar.innerHTML = ok
        ? 'Готово: зміни вже на сайті. <a href="https://vuzol.org.ua/#team" target="_blank" rel="noreferrer">Подивитися</a>'
        : 'Зміни збережені, але сайт не вдалося оновити. Напишіть Андрію.';
      return;
    } else {
      if (!expectSha) bar.hidden = true;
      return;
    }
    deployTimer = setTimeout(tick, 8000);
  };
  tick();
}

start();
