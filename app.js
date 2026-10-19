'use strict';

// ---------- 유틸 ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const won = n => n.toLocaleString('ko-KR') + '원';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parseAmt = s => parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0;
const fmtDate = s => (s ? s.replace(/-/g, '.') : '');
const today = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};
const daysUntil = s => Math.round((Date.parse(s) - Date.parse(today())) / 864e5);
const TYPE_LABEL = { lend: '빌려줌', borrow: '빌림' };

const paid = e => e.payments.reduce((a, p) => a + p.amount, 0);
const remaining = e => Math.max(0, e.amount - paid(e));
const isDone = e => remaining(e) === 0;
const isOverdue = e => !isDone(e) && e.due && daysUntil(e.due) < 0;

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* 무시 */ } }

// 금액 입력칸: 입력하는 동안 천단위 콤마
function bindAmountInput(input) {
  input.addEventListener('input', () => {
    const n = parseAmt(input.value);
    input.value = n ? n.toLocaleString('ko-KR') : '';
  });
}

// ---------- 저장소 (IndexedDB) ----------
const DB = {
  ready: null,  // 열기 완료 전에 호출돼도 기다렸다가 실행
  open() {
    this.ready = this.ready || new Promise((res, rej) => {
      const r = indexedDB.open('ittajulge', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('entries', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this.ready;
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('entries', mode);
      const req = fn(t.objectStore('entries'));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = () => rej(t.error);
    });
  },
  all() { return this.tx('readonly', s => s.getAll()); },
  put(e) { return this.tx('readwrite', s => { s.put(e); }); },
  putMany(list) { return this.tx('readwrite', s => { list.forEach(e => s.put(e)); }); },
  del(id) { return this.tx('readwrite', s => { s.delete(id); }); },
  replaceAll(list) {
    return this.tx('readwrite', s => { s.clear(); list.forEach(e => s.put(e)); });
  },
};

// ---------- 상태 ----------
let entries = [];
let filter = 'open';
let currentId = null;   // 상세 화면에 열린 기록
let editingId = null;   // 수정 중인 기록 (null이면 신규)

// ---------- 렌더링 ----------
function render() {
  renderSummary();
  renderList();
  renderPeople();
  $('#names').innerHTML = [...new Set(entries.map(e => e.name))].sort()
    .map(n => `<option value="${esc(n)}">`).join('');
}

function renderSummary() {
  let lend = 0, borrow = 0, overdue = 0, soon = 0;
  for (const e of entries) {
    if (isDone(e)) continue;
    if (e.type === 'lend') lend += remaining(e); else borrow += remaining(e);
    if (e.due) {
      const d = daysUntil(e.due);
      if (d < 0) overdue++; else if (d <= 3) soon++;
    }
  }
  $('#sumLend').textContent = won(lend);
  $('#sumBorrow').textContent = won(borrow);
  const msg = [];
  if (overdue) msg.push(`기한 지난 기록 ${overdue}건`);
  if (soon) msg.push(`3일 안에 기한인 기록 ${soon}건`);
  $('#alert').hidden = !msg.length;
  $('#alert').textContent = msg.join(' · ');
}

function dueText(e) {
  if (isDone(e)) {
    const last = e.payments[e.payments.length - 1];
    return last ? `완료 ${fmtDate(last.date)}` : '완료';
  }
  if (!e.due) return '';
  const d = daysUntil(e.due);
  if (d < 0) return `<span class="late">${-d}일 지남</span>`;
  if (d === 0) return '<span class="late">오늘까지</span>';
  return `D-${d}`;
}

function sortEntries(list) {
  return list.slice().sort((a, b) => {
    const da = isDone(a), db = isDone(b);
    if (da !== db) return da ? 1 : -1;
    if (!da) {
      if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
      if (!!a.due !== !!b.due) return a.due ? -1 : 1;
    }
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });
}

function renderList() {
  const q = $('#search').value.trim().toLowerCase();
  const list = sortEntries(entries.filter(e => {
    if (filter === 'open' && isDone(e)) return false;
    if (filter === 'done' && !isDone(e)) return false;
    return !q || e.name.toLowerCase().includes(q) || (e.memo || '').toLowerCase().includes(q);
  }));
  $('#list').innerHTML = list.map(e => {
    const p = paid(e);
    const progress = p && !isDone(e) ? `${won(e.amount)} 중 ${won(p)} 상환` : '';
    return `<li class="item${isDone(e) ? ' done' : ''}${isOverdue(e) ? ' overdue' : ''}" data-id="${e.id}">
      <div class="name"><span class="badge ${e.type}">${TYPE_LABEL[e.type]}</span>${esc(e.name)}</div>
      <div class="amt ${e.type}-c">${won(isDone(e) ? e.amount : remaining(e))}</div>
      <div class="sub">${fmtDate(e.date)}${progress ? ' · ' + progress : ''}</div>
      <div class="sub right">${dueText(e)}</div>
      ${e.memo ? `<div class="memo">${esc(e.memo)}</div>` : ''}
    </li>`;
  }).join('');
  $('#empty').hidden = list.length > 0;
  $('#empty').innerHTML = entries.length
    ? '조건에 맞는 기록이 없습니다.'
    : '기록이 없습니다.<br>아래 + 버튼으로 추가하세요.';
}

function renderPeople() {
  const map = new Map();
  for (const e of entries) {
    if (isDone(e)) continue;
    const p = map.get(e.name) || { name: e.name, lend: 0, borrow: 0, count: 0 };
    p[e.type] += remaining(e);
    p.count++;
    map.set(e.name, p);
  }
  const people = [...map.values()]
    .map(p => ({ ...p, net: p.lend - p.borrow }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  $('#people').innerHTML = people.map(p => {
    const label = p.net > 0 ? `<div class="amt lend-c">받을 돈 ${won(p.net)}</div>`
      : p.net < 0 ? `<div class="amt borrow-c">갚을 돈 ${won(-p.net)}</div>`
      : '<div class="amt">상계 0원</div>';
    const detail = [p.lend && `빌려줌 ${won(p.lend)}`, p.borrow && `빌림 ${won(p.borrow)}`]
      .filter(Boolean).join(' · ');
    return `<li class="item" data-name="${esc(p.name)}">
      <div class="name">${esc(p.name)}</div>${label}
      <div class="sub">${detail}</div><div class="sub right">${p.count}건</div>
      <button type="button" class="settle" data-settle="${esc(p.name)}">전체 상환</button>
    </li>`;
  }).join('');
  $('#peopleEmpty').hidden = people.length > 0;
}

// ---------- 화면 전환 ----------
function showView(v) {
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $$('.view').forEach(s => { s.hidden = s.id !== 'view-' + v; });
  $('#fab').hidden = v === 'settings';
  if (v === 'settings') renderSettings();
  window.scrollTo(0, 0);
}
$$('.tabs button').forEach(b => b.addEventListener('click', () => showView(b.dataset.v)));

$$('#filter button').forEach(b => b.addEventListener('click', () => {
  filter = b.dataset.f;
  $$('#filter button').forEach(x => x.classList.toggle('on', x === b));
  renderList();
}));
$('#search').addEventListener('input', renderList);

$('#people').addEventListener('click', ev => {
  const btn = ev.target.closest('button[data-settle]');
  if (btn) return settlePerson(btn.dataset.settle);
  const li = ev.target.closest('li[data-name]');
  if (!li) return;
  $('#search').value = li.dataset.name;
  showView('list');
  renderList();
});

// 한 사람의 진행 중 기록을 모두 오늘 날짜로 상환 처리
async function settlePerson(name) {
  const open = entries.filter(e => e.name === name && !isDone(e));
  if (!open.length) return;
  const sum = type => open.filter(e => e.type === type).reduce((a, e) => a + remaining(e), 0);
  const parts = [sum('lend') && `받을 돈 ${won(sum('lend'))}`, sum('borrow') && `갚을 돈 ${won(sum('borrow'))}`]
    .filter(Boolean).join(' · ');
  if (!confirm(`${name}: 진행 중 ${open.length}건 (${parts})을 오늘 날짜로 모두 상환 처리할까요?`)) return;
  const now = new Date().toISOString();
  const updated = open.map(e => ({
    ...e,
    payments: [...e.payments, { id: uid(), amount: remaining(e), date: today(), memo: '전체 상환' }],
    updatedAt: now,
  }));
  await DB.putMany(updated);
  for (const u of updated) entries[entries.findIndex(x => x.id === u.id)] = u;
  render();
}

$$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

// ---------- 등록/수정 ----------
const formEntry = $('#formEntry');
bindAmountInput(formEntry.amount);

function openEntryForm(e) {
  editingId = e ? e.id : null;
  $('#entryTitle').textContent = e ? '기록 수정' : '새 기록';
  formEntry.reset();
  formEntry.type.value = e ? e.type : 'lend';
  formEntry.elements.namedItem('name').value = e ? e.name : '';
  formEntry.amount.value = e ? e.amount.toLocaleString('ko-KR') : '';
  formEntry.date.value = e ? e.date : today();
  formEntry.due.value = e ? e.due || '' : '';
  formEntry.memo.value = e ? e.memo || '' : '';
  $('#dlgEntry').showModal();
}
$('#fab').addEventListener('click', () => openEntryForm(null));

formEntry.addEventListener('submit', async ev => {
  ev.preventDefault();
  const name = formEntry.elements.namedItem('name').value.trim();
  const amount = parseAmt(formEntry.amount.value);
  if (!name) return alert('상대 이름을 입력하세요.');
  if (!amount) return alert('금액을 입력하세요.');
  const due = formEntry.due.value;
  if (due && due < formEntry.date.value) return alert('갚기로 한 날이 날짜보다 빠릅니다.');

  const old = editingId && entries.find(x => x.id === editingId);
  if (old && amount < paid(old)) {
    return alert(`이미 상환된 금액(${won(paid(old))})보다 작게 바꿀 수 없습니다.`);
  }
  const now = new Date().toISOString();
  const e = old
    ? { ...old, updatedAt: now }
    : { id: uid(), payments: [], createdAt: now, updatedAt: now };
  Object.assign(e, {
    type: formEntry.type.value, name, amount,
    date: formEntry.date.value, due, memo: formEntry.memo.value.trim(),
  });
  await DB.put(e);
  if (old) entries[entries.indexOf(old)] = e; else entries.push(e);
  $('#dlgEntry').close();
  render();
  if (old && $('#dlgDetail').open) renderDetail();
});

// ---------- 상세 / 상환 ----------
const formPay = $('#formPay');
bindAmountInput(formPay.amount);
const current = () => entries.find(x => x.id === currentId);

$('#list').addEventListener('click', ev => {
  const li = ev.target.closest('li[data-id]');
  if (!li) return;
  currentId = li.dataset.id;
  renderDetail();
  $('#dlgDetail').showModal();
});

function renderDetail() {
  const e = current();
  if (!e) return $('#dlgDetail').close();
  const done = isDone(e);
  const who = e.type === 'lend' ? `${esc(e.name)}에게 받을 돈` : `${esc(e.name)}에게 갚을 돈`;
  $('#detailBody').innerHTML = `
    <h2><span class="badge ${e.type}">${TYPE_LABEL[e.type]}</span>${who}</h2>
    <div class="detail-amt ${e.type}-c">${done ? '완료' : won(remaining(e))}</div>
    <dl class="kv">
      <dt>원금</dt><dd>${won(e.amount)}</dd>
      <dt>상환됨</dt><dd>${won(paid(e))}</dd>
      <dt>날짜</dt><dd>${fmtDate(e.date)}</dd>
      ${e.due ? `<dt>갚기로 한 날</dt><dd>${fmtDate(e.due)} ${done ? '' : '(' + dueText(e) + ')'}</dd>` : ''}
      ${e.memo ? `<dt>메모</dt><dd>${esc(e.memo)}</dd>` : ''}
    </dl>
    ${e.payments.length ? `<h3>상환 내역</h3><ul class="pays">${e.payments.map(p => `
      <li><span>${fmtDate(p.date)}</span><span class="grow">${esc(p.memo)}</span>
      <b>${won(p.amount)}</b><button type="button" data-pay="${p.id}" aria-label="상환 삭제">×</button></li>`).join('')}</ul>` : ''}`;
  formPay.hidden = done;
  formPay.reset();
  formPay.amount.value = remaining(e).toLocaleString('ko-KR');
  formPay.date.value = today();
}

async function addPayment(amount, date, memo) {
  const e = current();
  const rest = remaining(e);
  if (!amount) return alert('상환 금액을 입력하세요.');
  if (amount > rest) return alert(`남은 금액(${won(rest)})보다 많이 입력할 수 없습니다.`);
  e.payments.push({ id: uid(), amount, date, memo });
  e.payments.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  e.updatedAt = new Date().toISOString();
  await DB.put(e);
  render();
  renderDetail();
}

formPay.addEventListener('submit', ev => {
  ev.preventDefault();
  addPayment(parseAmt(formPay.amount.value), formPay.date.value || today(), formPay.memo.value.trim());
});
$('#btnPayAll').addEventListener('click', () => {
  const e = current();
  if (confirm(`남은 ${won(remaining(e))}을 오늘 날짜로 전액 상환 처리할까요?`)) {
    addPayment(remaining(e), today(), '전액 상환');
  }
});

$('#detailBody').addEventListener('click', async ev => {
  const btn = ev.target.closest('button[data-pay]');
  if (!btn || !confirm('이 상환 기록을 삭제할까요?')) return;
  const e = current();
  e.payments = e.payments.filter(p => p.id !== btn.dataset.pay);
  e.updatedAt = new Date().toISOString();
  await DB.put(e);
  render();
  renderDetail();
});

$('#btnEdit').addEventListener('click', () => openEntryForm(current()));
$('#btnDelete').addEventListener('click', async () => {
  const e = current();
  if (!confirm(`${e.name} (${won(e.amount)}) 기록을 삭제할까요?`)) return;
  await DB.del(e.id);
  entries = entries.filter(x => x.id !== e.id);
  $('#dlgDetail').close();
  render();
});

// ---------- 설정: 백업 / 복원 / 초기화 ----------
async function renderSettings() {
  const last = lsGet('lastBackup');
  $('#lastBackup').textContent = last ? `마지막 백업: ${fmtDate(last)}` : '아직 백업한 적이 없습니다.';
  let info = `기록 ${entries.length}건 저장됨.`;
  if (navigator.storage && navigator.storage.persisted) {
    const p = await navigator.storage.persisted();
    info += p ? ' 브라우저가 데이터를 자동 삭제하지 않도록 보호 중입니다.'
      : ' 저장 공간 보호가 아직 허용되지 않았습니다. 홈 화면에 설치해 쓰면 대부분 자동으로 허용됩니다.';
  }
  $('#storageInfo').textContent = info;
}

$('#btnExport').addEventListener('click', () => {
  const data = { app: 'ittajulge', version: 1, exportedAt: new Date().toISOString(), entries };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ittajulge-backup-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  lsSet('lastBackup', today());
  renderSettings();
});

$('#btnImport').addEventListener('click', () => $('#fileImport').click());
$('#fileImport').addEventListener('change', async ev => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { return alert('백업 파일을 읽을 수 없습니다.'); }
  const list = data && data.app === 'ittajulge' && Array.isArray(data.entries) ? data.entries : null;
  const valid = list && list.every(e => e && e.id && e.name && (e.type === 'lend' || e.type === 'borrow')
    && Number.isFinite(e.amount) && Array.isArray(e.payments));
  if (!valid) return alert('이따줄게 백업 파일 형식이 아닙니다.');
  if (!confirm(`백업의 기록 ${list.length}건으로 현재 기록 ${entries.length}건을 교체합니다. 계속할까요?`)) return;
  await DB.replaceAll(list);
  entries = list;
  render();
  renderSettings();
  alert('불러오기 완료');
});

$('#btnWipe').addEventListener('click', async () => {
  if (!entries.length) return;
  if (!confirm(`기록 ${entries.length}건을 모두 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`)) return;
  if (!confirm('정말 삭제할까요? 백업 파일이 없으면 복구할 수 없습니다.')) return;
  await DB.replaceAll([]);
  entries = [];
  render();
  renderSettings();
});

// ---------- 시작 ----------
(async function init() {
  try {
    await DB.open();
    entries = await DB.all();
  } catch (err) {
    alert('저장소를 열 수 없습니다: ' + err);
  }
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();

// 앱을 다시 열었을 때 날짜가 바뀌었으면 D-day 갱신
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
