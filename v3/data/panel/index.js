'use strict';

const isFirefox = navigator.userAgent.includes('Firefox');

function settings() {
  const since = document.querySelector('[name=since]:checked').value;

  let types = [...document.getElementById('types').querySelectorAll(':checked')].map(e => e.value);
  if (isFirefox) {
    types = types.filter(t => ['indexedDB', 'localStorage', 'appcache', 'fileSystems', 'webSQL'].indexOf(t) === -1);
  }
  const zones = [...document.getElementById('zones').querySelectorAll(':checked')].map(e => e.value);
  const originTypes = zones.reduce((p, c) => Object.assign(p, {[c]: true}), {});
  if (isFirefox) {
    delete originTypes.protectedWeb;
    delete originTypes.extension;
  }
  let time;
  if (since === 'custom') {
    time = Number(document.getElementById('time').value);
    const unit = document.getElementById('unit').value;
    if (unit === 'minutes') {
      time *= 60;
    }
    else if (unit === 'hours') {
      time *= 60 * 60;
    }
    else if (unit === 'days') {
      time *= 60 * 60 * 24;
    }
    else if (unit === 'weeks') {
      time *= 60 * 60 * 24 * 7;
    }
    else if (unit === 'months') {
      time *= 60 * 60 * 24 * 7 * 4;
    }
  }
  else {
    time = Number(since);
  }

  return {
    time,
    types,
    originTypes,
    since
  };
}

document.getElementById('submit').addEventListener('click', ({target}) => {
  target.value = 'Please wait ...';
  target.disabled = true;

  const {since, time, types, originTypes} = settings();

  // persist
  chrome.storage.local.set({
    since,
    time: document.getElementById('time').value
  }, () => {
    const obj = {
      options: {
        'since': time ? (new Date()).getTime() - time * 1000 : time,
        originTypes
      },
      dataToRemove: types.reduce((p, c) => Object.assign(p, {[c]: true}), {})
    };
    const n = Date.now();
    chrome.browsingData.remove(obj.options, obj.dataToRemove, () => {
      window.setTimeout(() => {
        target.value = 'Done!';
        window.setTimeout(() => window.close(), 500);
      }, n - Date.now() < 300 ? 500 : 0);
    });
  });
});

// --- Cookies por dominio ---
const $scan = document.getElementById('scan-domains');
const $deleteSelected = document.getElementById('delete-selected-domains');
const $list = document.getElementById('domain-list');
const $filter = document.getElementById('filter-domains');
const $selectAll = document.getElementById('select-all-domains');
const $deselectAll = document.getElementById('deselect-all-domains');

function pCookiesGetAll(filter) {
  return new Promise((resolve, reject) => {
    try {
      chrome.cookies.getAll(filter || {}, resolve);
    }
    catch (e) { reject(e); }
  });
}

function pCookiesRemove(details) {
  return new Promise((resolve, reject) => {
    try {
      chrome.cookies.remove(details, result => {
        // result is null on failure
        resolve(result);
      });
    }
    catch (e) { reject(e); }
  });
}

function normalizeDomain(d) {
  return (d || '').replace(/^\./, '');
}

function cookieUrl(c) {
  const scheme = c.secure ? 'https' : 'http';
  const host = normalizeDomain(c.domain);
  const path = c.path || '/';
  return `${scheme}://${host}${path}`;
}

async function scanDomains() {
  $scan.disabled = true;
  $scan.value = 'Escaneando...';
  $deleteSelected.disabled = true;
  if ($selectAll) $selectAll.disabled = true;
  if ($deselectAll) $deselectAll.disabled = true;
  $list.innerHTML = '';

  try {
    const cookies = await pCookiesGetAll({});
    const map = new Map(); // domain -> count
    for (const c of cookies) {
      const dom = normalizeDomain(c.domain);
      if (!dom) continue;
      map.set(dom, (map.get(dom) || 0) + 1);
    }
    // Render
    const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
    for (const [domain, count] of entries) {
      const li = document.createElement('li');
      const id = `d-${domain.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      li.innerHTML = `<label><input type="checkbox" value="${domain}" id="${id}"> ${domain} <small>(${count})</small></label>`;
      $list.appendChild(li);
    }
    if (entries.length) {
      $deleteSelected.disabled = false;
      if ($selectAll) $selectAll.disabled = false;
      if ($deselectAll) $deselectAll.disabled = false;
    }
    $scan.value = 'Re-escanear dominios';
  }
  catch (e) {
    console.error(e);
  }
  finally {
    $scan.disabled = false;
  }
}

async function deleteSelectedDomains() {
  const boxes = [...$list.querySelectorAll('input[type=checkbox]:checked')];
  if (!boxes.length) return;
  $deleteSelected.disabled = true;
  const original = $deleteSelected.value;
  $deleteSelected.value = 'Borrando...';

  try {
    for (const box of boxes) {
      const domain = box.value;
      const cs = await pCookiesGetAll({domain});
      for (const c of cs) {
        const details = {
          url: cookieUrl(c),
          name: c.name
        };
        if (c.storeId) details.storeId = c.storeId;
        if (c.partitionKey) details.partitionKey = c.partitionKey;
        await pCookiesRemove(details);
      }
    }
  }
  catch (e) {
    console.error(e);
  }
  finally {
    $deleteSelected.value = original;
    await scanDomains(); // refresh list and counts
  }
}

function updateDeleteButtonState() {
  const anyChecked = $list.querySelector('input[type=checkbox]:checked');
  $deleteSelected.disabled = !anyChecked;
}

function applyFilter() {
  const q = ($filter.value || '').trim().toLowerCase();
  const items = [...$list.querySelectorAll('li')];
  for (const li of items) {
    const txt = li.textContent.toLowerCase();
    li.style.display = q && !txt.includes(q) ? 'none' : '';
  }
}

function selectVisible(state) {
  const visibleBoxes = [...$list.querySelectorAll('li')]
    .filter(li => li.style.display !== 'none')
    .flatMap(li => [...li.querySelectorAll('input[type=checkbox]')]);
  for (const b of visibleBoxes) b.checked = state;
  updateDeleteButtonState();
}

if ($scan && $deleteSelected && $list) {
  $scan.addEventListener('click', scanDomains);
  $deleteSelected.addEventListener('click', deleteSelectedDomains);
  $list.addEventListener('change', updateDeleteButtonState);
  if ($filter) $filter.addEventListener('input', applyFilter);
  if ($selectAll) $selectAll.addEventListener('click', () => selectVisible(true));
  if ($deselectAll) $deselectAll.addEventListener('click', () => selectVisible(false));
}

document.getElementById('exit').addEventListener('click', e => {
  const {time, types, originTypes} = settings();
  const obj = {
    options: {
      'since': time ? (new Date()).getTime() - time * 1000 : time,
      originTypes
    },
    dataToRemove: types.reduce((p, c) => Object.assign(p, {[c]: true}), {})
  };

  chrome.storage.local.set({
    'clean-object': obj,
    'clean-on-exit': e.target.dataset.checked === 'false'
  }, () => {
    let message = `Cleaning preferences are stored and will be applied on every browser exit.

This feature might not work on some operating systems`;
    if (e.target.dataset.checked === 'true') {
      message = 'Cleaning on the browser exit is disabled';
      e.target.dataset.checked = false;
    }
    else {
      e.target.dataset.checked = true;
    }
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '/data/icons/48.png',
      title: 'eCleaner (Forget Button)',
      message
    }, id => setTimeout(chrome.notifications.clear, 3000, id));
  });
});
chrome.storage.local.get({
  'clean-on-exit': false
}, prefs => document.getElementById('exit').dataset.checked = prefs['clean-on-exit']);

let last;

document.body.addEventListener('change', e => {
  const target = e.target;
  // persist
  if (target.type === 'checkbox') {
    chrome.storage.local.set({
      [target.value]: target.checked
    });
  }
  //
  const confirm = target.dataset.confirm;
  if (confirm && target.checked) {
    last = target;
    document.getElementById('confirm').style.display = 'flex';
  }
  //
  if (target.id === 'unit') {
    document.getElementById('since-3').checked = true;
    chrome.storage.local.set({
      unit: target.value
    });
  }
});
document.body.addEventListener('click', e => {
  const target = e.target;
  const cmd = target.dataset.cmd;
  const confirm = document.getElementById('confirm');
  if (cmd === 'uncheck' && last) {
    last.checked = false;
    if (last.type === 'radio') {
      document.getElementById('since').querySelector('input:nth-of-type(4)').checked = true;
    }
    confirm.style.display = 'none';
  }
  else if (cmd === 'hide') {
    confirm.style.display = 'none';
  }
});

// persist
{
  const checkboxes = [...document.querySelectorAll('[type=checkbox]')];
  chrome.storage.local.get(checkboxes.reduce((p, c) => Object.assign(p, {
    [c.value]: c.checked
  }), {}), prefs => {
    Object.entries(prefs).forEach(([key, value]) => {
      document.querySelector(`[value="${key}"]`).checked = value;
    });
  });
  chrome.storage.local.get({
    since: 604800,
    time: 24,
    unit: 'hours'
  }, prefs => {
    document.getElementById('time').value = prefs.time;
    document.getElementById('unit').value = prefs.unit;
    try {
      document.getElementById('since').querySelector(`[value="${prefs.since}"]`).checked = true;
    }
    catch (e) {}
  });
}

// links
for (const a of [...document.querySelectorAll('[data-href]')]) {
  if (a.hasAttribute('href') === false) {
    a.href = chrome.runtime.getManifest().homepage_url + '#' + a.dataset.href;
  }
}
