const STORAGE_KEY = 'xpm-attendance-v1';
const STATUS = { present: '出席', absent: '缺席', leave: '請假' };
const SEED_GROUPS = window.ATTENDANCE_SEED_GROUPS || [];

const createId = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const makeInitialState = () => ({
  meetingTitle: 'xPM Leadership Meeting | 參會人員',
  meetingDate: today,
  businessUnit: 'A事業群',
  notices: '會議不開放臨時列席，請您參會時勿召集名單外主管\n固定參會人員如無法參會，須提前請假',
  groups: SEED_GROUPS.map((group) => ({ id: createId(), name: group.name, attendees: group.people.map(([chineseName, englishName]) => ({ id: createId(), chineseName, englishName, status: 'present' })) }))
});

function loadState() {
  if (window.ATTENDANCE_SHARED_MODE && window.ATTENDANCE_INITIAL_STATE) {
    return structuredClone(window.ATTENDANCE_INITIAL_STATE);
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.groups)) {
      saved.groups = saved.groups.map((group) => ({ ...group, attendees: Array.isArray(group.attendees) ? group.attendees.map((person) => ({ ...person, status: STATUS[person.status] ? person.status : 'present' })) : [] }));
      return { ...makeInitialState(), ...saved };
    }
  } catch (error) {
    console.warn('Could not load the saved roster.', error);
  }
  return makeInitialState();
}

let state = loadState();
let editingAttendeeId = null;
let editingGroupId = null;
const app = document.getElementById('app');
const groupGrid = document.getElementById('group-grid');
const dialog = document.getElementById('attendee-dialog');
const attendeeForm = document.getElementById('attendee-form');
let searchTerm = '';

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Could not save the roster in this browser.', error);
  }
  if (window.ATTENDANCE_SHARED?.save) window.ATTENDANCE_SHARED.save(structuredClone(state));
}

function counts() {
  const all = state.groups.flatMap((group) => group.attendees);
  return { total: all.length, present: all.filter((person) => person.status === 'present').length, absent: all.filter((person) => person.status === 'absent').length, leave: all.filter((person) => person.status === 'leave').length };
}

function renderSummary() {
  const result = counts();
  document.getElementById('count-total').textContent = result.total;
  document.getElementById('count-present').textContent = result.present;
  document.getElementById('count-absent').textContent = result.absent;
  document.getElementById('count-leave').textContent = result.leave;
  document.getElementById('group-count').textContent = `${state.groups.length} 個群組 · ${result.total} 位人員`;
}

function renderSettings() {
  document.querySelectorAll('[data-config]').forEach((input) => {
    const key = input.dataset.config;
    input.value = state[key] ?? '';
  });
}

function renderGroups() {
  const term = searchTerm.trim().toLocaleLowerCase();
  const filteredGroups = state.groups.filter((group) => !term || group.name.toLocaleLowerCase().includes(term) || group.attendees.some((person) => `${person.chineseName} ${person.englishName}`.toLocaleLowerCase().includes(term)));
  if (!filteredGroups.length) {
    groupGrid.innerHTML = '<div class="empty-state">找不到符合條件的參會人員。</div>';
    return;
  }
  groupGrid.innerHTML = filteredGroups.map((group) => {
    const presentCount = group.attendees.filter((person) => person.status === 'present').length;
    const groupMatches = term && group.name.toLocaleLowerCase().includes(term);
    const people = groupMatches ? group.attendees : group.attendees.filter((person) => !term || `${person.chineseName} ${person.englishName}`.toLocaleLowerCase().includes(term));
    const rows = people.length ? people.map((person) => {
      const isLeader = group.attendees[0]?.id === person.id;
      return `
      <div class="attendee-row${isLeader ? ' center-leader' : ''}" data-group="${group.id}" data-person="${person.id}">
        <button class="reorder-handle" data-group="${group.id}" data-person="${person.id}" type="button" aria-label="調整 ${escapeHTML(person.chineseName)} 順序；可拖曳，或按上下鍵移動" title="拖曳排序；聚焦後使用 ↑/↓ 調整" aria-keyshortcuts="ArrowUp ArrowDown">⠿</button>
        <div class="person-names" title="${escapeHTML(`${person.chineseName} ${person.englishName}`)}"><span class="chinese-name">${escapeHTML(person.chineseName)}</span><span class="english-name">${escapeHTML(person.englishName)}</span></div>
        <button class="edit-person" data-action="edit-attendee" data-group="${group.id}" data-person="${person.id}" type="button" aria-label="編輯 ${escapeHTML(person.chineseName)}">✎</button>
        <div class="status-control" role="group" aria-label="${escapeHTML(person.chineseName)} 的出席狀態">
          ${Object.entries(STATUS).map(([status, label]) => `<button type="button" data-action="set-status" data-status="${status}" data-group="${group.id}" data-person="${person.id}" aria-label="${label}" title="${label}" aria-pressed="${person.status === status}">${label}</button>`).join('')}
        </div>
      </div>`;
    }).join('') : '<div class="empty-list">此群組沒有符合的姓名</div>';
    return `<article class="group-card" data-group-card="${group.id}">
      <header class="group-header"><h3>${escapeHTML(group.name)}</h3><span class="group-size">${group.attendees.length} 人</span><div class="group-tools"><button type="button" data-action="rename-group" data-group="${group.id}" title="重新命名群組" aria-label="重新命名 ${escapeHTML(group.name)}">✎</button><button type="button" data-action="remove-group" data-group="${group.id}" title="刪除群組" aria-label="刪除 ${escapeHTML(group.name)}">×</button></div></header>
      <div class="attendee-list">${rows}</div>
      <button class="add-attendee" data-action="add-attendee" data-group="${group.id}" type="button">＋ 新增成員</button>
      <span class="group-present-count" hidden>${presentCount}</span>
    </article>`;
  }).join('');
}

function render() {
  renderSummary();
  renderSettings();
  renderGroups();
}

function moveAttendee(groupId, personId, targetPersonId, placeAfter = false) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group || personId === targetPersonId) return false;
  const sourceIndex = group.attendees.findIndex((item) => item.id === personId);
  const targetIndex = group.attendees.findIndex((item) => item.id === targetPersonId);
  if (sourceIndex < 0 || targetIndex < 0) return false;
  const [person] = group.attendees.splice(sourceIndex, 1);
  let insertionIndex = targetIndex + (placeAfter ? 1 : 0);
  if (sourceIndex < insertionIndex) insertionIndex -= 1;
  group.attendees.splice(insertionIndex, 0, person);
  saveState();
  renderGroups();
  const handle = [...groupGrid.querySelectorAll('.reorder-handle')].find((item) => item.dataset.group === groupId && item.dataset.person === personId);
  handle?.focus();
  return true;
}

function moveAttendeeBy(groupId, personId, offset) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) return;
  const sourceIndex = group.attendees.findIndex((item) => item.id === personId);
  const targetIndex = Math.max(0, Math.min(group.attendees.length - 1, sourceIndex + offset));
  if (sourceIndex < 0 || sourceIndex === targetIndex) return;
  const [person] = group.attendees.splice(sourceIndex, 1);
  group.attendees.splice(targetIndex, 0, person);
  saveState();
  renderGroups();
  const handle = [...groupGrid.querySelectorAll('.reorder-handle')].find((item) => item.dataset.group === groupId && item.dataset.person === personId);
  handle?.focus();
}

let reorderSession = null;

function clearReorderStyles() {
  groupGrid.querySelectorAll('.is-dragging, .drop-before, .drop-after').forEach((row) => {
    row.classList.remove('is-dragging', 'drop-before', 'drop-after');
  });
}

groupGrid.addEventListener('pointerdown', (event) => {
  const handle = event.target.closest('.reorder-handle');
  if (!handle || event.button !== 0) return;
  const row = handle.closest('.attendee-row');
  if (!row) return;
  reorderSession = {
    groupId: row.dataset.group,
    personId: row.dataset.person,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    sourceRow: row,
    targetPersonId: null,
    placeAfter: false,
    dragging: false
  };
  handle.setPointerCapture(event.pointerId);
});

groupGrid.addEventListener('pointermove', (event) => {
  if (!reorderSession || event.pointerId !== reorderSession.pointerId) return;
  const distance = Math.hypot(event.clientX - reorderSession.startX, event.clientY - reorderSession.startY);
  if (!reorderSession.dragging && distance < 7) return;
  reorderSession.dragging = true;
  event.preventDefault();
  reorderSession.sourceRow.classList.add('is-dragging');
  groupGrid.querySelectorAll('.drop-before, .drop-after').forEach((row) => row.classList.remove('drop-before', 'drop-after'));
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.attendee-row');
  if (!target || target.dataset.group !== reorderSession.groupId) {
    reorderSession.targetPersonId = null;
    return;
  }
  const bounds = target.getBoundingClientRect();
  reorderSession.targetPersonId = target.dataset.person;
  reorderSession.placeAfter = event.clientY >= bounds.top + bounds.height / 2;
  target.classList.add(reorderSession.placeAfter ? 'drop-after' : 'drop-before');
});

groupGrid.addEventListener('pointerup', (event) => {
  if (!reorderSession || event.pointerId !== reorderSession.pointerId) return;
  const session = reorderSession;
  reorderSession = null;
  clearReorderStyles();
  if (session.dragging && session.targetPersonId) {
    moveAttendee(session.groupId, session.personId, session.targetPersonId, session.placeAfter);
  }
});

groupGrid.addEventListener('pointercancel', (event) => {
  if (!reorderSession || event.pointerId !== reorderSession.pointerId) return;
  reorderSession = null;
  clearReorderStyles();
});

groupGrid.addEventListener('keydown', (event) => {
  const handle = event.target.closest('.reorder-handle');
  if (!handle) return;
  const offset = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
  if (!offset) return;
  event.preventDefault();
  moveAttendeeBy(handle.dataset.group, handle.dataset.person, offset);
});

function setStatus(groupId, personId, status) {
  const group = state.groups.find((item) => item.id === groupId);
  const person = group?.attendees.find((item) => item.id === personId);
  if (!person || !STATUS[status]) return;
  person.status = status;
  saveState();
  render();
}

function openAttendeeDialog(groupId, personId = null) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) return;
  editingGroupId = groupId;
  editingAttendeeId = personId;
  const person = personId ? group.attendees.find((item) => item.id === personId) : null;
  document.getElementById('dialog-title').textContent = person ? '編輯參會人員' : '新增參會人員';
  document.getElementById('attendee-chinese').value = person?.chineseName || '';
  document.getElementById('attendee-english').value = person?.englishName || '';
  document.getElementById('attendee-group').innerHTML = state.groups.map((item) => `<option value="${item.id}" ${item.id === groupId ? 'selected' : ''}>${escapeHTML(item.name)}</option>`).join('');
  document.getElementById('delete-attendee').hidden = !person;
  dialog.showModal();
  document.getElementById('attendee-chinese').focus();
}

app.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, group, person, status } = button.dataset;
  if (action === 'set-status') setStatus(group, person, status);
  if (action === 'add-attendee') openAttendeeDialog(group);
  if (action === 'edit-attendee') openAttendeeDialog(group, person);
  if (action === 'close-dialog') dialog.close();
  if (action === 'delete-attendee') {
    const sourceGroup = state.groups.find((item) => item.id === editingGroupId);
    if (sourceGroup && editingAttendeeId && confirm('確定刪除此參會人員？')) {
      sourceGroup.attendees = sourceGroup.attendees.filter((item) => item.id !== editingAttendeeId);
      saveState(); dialog.close(); render();
    }
  }
  if (action === 'add-group') {
    const name = prompt('請輸入群組名稱');
    if (name?.trim()) { const newGroup = { id: createId(), name: name.trim(), attendees: [] }; state.groups.push(newGroup); saveState(); render(); openAttendeeDialog(newGroup.id); }
  }
  if (action === 'rename-group') {
    const selectedGroup = state.groups.find((item) => item.id === group);
    const name = selectedGroup && prompt('請輸入新的群組名稱', selectedGroup.name);
    if (name?.trim()) { selectedGroup.name = name.trim(); saveState(); render(); }
  }
  if (action === 'remove-group') {
    const selectedGroup = state.groups.find((item) => item.id === group);
    if (selectedGroup && confirm(`確定刪除「${selectedGroup.name}」及其中 ${selectedGroup.attendees.length} 位人員？`)) { state.groups = state.groups.filter((item) => item.id !== group); saveState(); render(); }
  }
  if (action === 'export-pptx') exportPowerPoint();
});

attendeeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const chineseName = document.getElementById('attendee-chinese').value.trim();
  const englishName = document.getElementById('attendee-english').value.trim();
  const nextGroupId = document.getElementById('attendee-group').value;
  const nextGroup = state.groups.find((item) => item.id === nextGroupId);
  const oldGroup = state.groups.find((item) => item.id === editingGroupId);
  if (!chineseName || !nextGroup) return;
  const existing = oldGroup?.attendees.find((item) => item.id === editingAttendeeId);
  if (existing) {
    existing.chineseName = chineseName;
    existing.englishName = englishName;
    if (oldGroup.id !== nextGroup.id) {
      oldGroup.attendees = oldGroup.attendees.filter((item) => item.id !== editingAttendeeId);
      nextGroup.attendees.push(existing);
    }
  } else {
    nextGroup.attendees.push({ id: createId(), chineseName, englishName, status: 'present' });
  }
  saveState(); dialog.close(); render();
});

app.addEventListener('input', (event) => {
  if (event.target.matches('[data-config]')) {
    state[event.target.dataset.config] = event.target.value;
    saveState();
  }
  if (event.target.id === 'search-input') {
    searchTerm = event.target.value;
    renderGroups();
  }
});

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.getElementById('search-input').focus(); }
});

render();
window.ATTENDANCE_APPLY_REMOTE = (incoming) => {
  state = structuredClone(incoming);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  render();
};

function xmlEscape(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

const EMU = 914400;
const inch = (value) => Math.round(value * EMU);
let shapeId = 1;

function pptShape({ x, y, w, h, text = null, fill = null, line = null, geometry = 'rect', fontSize = 11, color = '172636', bold = false, align = 'l', anchor = 'ctr', margin = 0.03 }) {
  const id = shapeId++;
  const fillXml = fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : '<a:noFill/>';
  const lineXml = line ? `<a:ln w="${line.width || 9000}"><a:solidFill><a:srgbClr val="${line.color}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>';
  const textXml = text === null ? '' : `<p:txBody><a:bodyPr wrap="square" lIns="${inch(margin)}" rIns="${inch(margin)}" tIns="0" bIns="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="${align}"><a:buNone/></a:pPr><a:r><a:rPr lang="zh-TW" sz="${Math.round(fontSize * 100)}" b="${bold ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Aptos"/><a:ea typeface="Microsoft JhengHei"/></a:rPr><a:t xml:space="preserve">${xmlEscape(text)}</a:t></a:r><a:endParaRPr lang="zh-TW" sz="${Math.round(fontSize * 100)}"/></a:p></p:txBody>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${inch(x)}" y="${inch(y)}"/><a:ext cx="${inch(w)}" cy="${inch(h)}"/></a:xfrm><a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom>${fillXml}${lineXml}</p:spPr>${textXml}</p:sp>`;
}

function groupShapeTree(groupShapes) {
  const start = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  return `${start}${groupShapes.join('')}</p:spTree>`;
}

function buildSlideXml(groupSubset = state.groups, pageIndex = 0, pageCount = 1) {
  shapeId = 2;
  const shapes = [];
  const total = counts();
  const W = 13.333;
  shapes.push(pptShape({ x: 0, y: 0, w: W, h: 7.5, fill: 'FFFFFF' }));
  shapes.push(pptShape({ x: 0.29, y: 0.28, w: 0.31, h: 0.31, geometry: 'ellipse', fill: 'F2BE47' }));
  shapes.push(pptShape({ x: 0.40, y: 0.28, w: 0.31, h: 0.31, geometry: 'ellipse', fill: '54B8D1' }));
  shapes.push(pptShape({ x: 0.77, y: 0.20, w: 8.8, h: 0.48, text: state.meetingTitle || 'xPM Leadership Meeting | 參會人員', fontSize: 22, color: '121A20', bold: true, margin: 0 }));
  shapes.push(pptShape({ x: 11.26, y: 0.22, w: 1.74, h: 0.44, text: state.businessUnit || '事業群', fontSize: 18, color: '165A83', bold: true, align: 'r', margin: 0 }));
  shapes.push(pptShape({ x: 0.42, y: 0.88, w: 1.16, h: 0.30, text: '參會須知：', fontSize: 14, color: '42687C', bold: true, margin: 0 }));
  const noticeLines = (state.notices || '').split('\n').filter(Boolean).slice(0, 2);
  noticeLines.forEach((line, index) => {
    shapes.push(pptShape({ x: 1.55, y: 0.89 + index * 0.34, w: 11.3, h: 0.29, text: `${index + 1}.  ${line}`, fontSize: 12.4, color: '273944', margin: 0 }));
  });
  const summaryY = noticeLines.length > 1 ? 1.58 : 1.28;
  shapes.push(pptShape({ x: 0.42, y: summaryY, w: 9.9, h: 0.24, text: `${state.meetingDate || ''}     應到 ${total.total} 人     出席 ${total.present}     缺席 ${total.absent}     請假 ${total.leave}`, fontSize: 10.3, color: '55707F', margin: 0 }));

  const left = 0.39, gap = 0.12, cardW = (W - left * 2 - gap * 6) / 7, cardY = 1.91, cardH = 4.99;
  const maxRows = 13;
  groupSubset.forEach((group, index) => {
    const x = left + index * (cardW + gap);
    shapes.push(pptShape({ x, y: cardY, w: cardW, h: cardH, geometry: 'roundRect', fill: 'FBFCFD', line: { color: 'A6BAC6', width: 12000 } }));
    shapes.push(pptShape({ x: x + 0.01, y: cardY + 0.01, w: cardW - 0.02, h: 0.47, geometry: 'roundRect', fill: index === 0 || index === 6 ? '337998' : '075B96' }));
    shapes.push(pptShape({ x: x + 0.07, y: cardY + 0.06, w: cardW - 0.14, h: 0.35, text: group.name, fontSize: group.name.length > 11 ? 11.5 : 14.5, color: 'FFFFFF', bold: true, align: 'ctr', margin: 0.01 }));
    const people = group.attendees;
    const rowTop = cardY + 0.56;
    const rowH = Math.min(0.292, (cardH - 1.03) / Math.max(maxRows, people.length));
    const rowFont = Math.max(6.4, Math.min(9.6, rowH * 32));
    people.forEach((person, personIndex) => {
      const rowY = rowTop + personIndex * rowH;
      const muted = person.status === 'absent' ? '89949A' : person.status === 'leave' ? 'A57830' : '17242C';
      const markColor = person.status === 'present' ? '33A078' : person.status === 'absent' ? 'D16E6E' : 'DEA03F';
      shapes.push(pptShape({ x: x + 0.07, y: rowY, w: 0.66, h: rowH, text: person.chineseName, fontSize: rowFont, color: muted, bold: personIndex === 0, margin: 0 }));
      shapes.push(pptShape({ x: x + 0.73, y: rowY, w: 0.78, h: rowH, text: person.englishName, fontSize: rowFont, color: muted, bold: personIndex === 0, margin: 0 }));
      shapes.push(pptShape({ x: x + cardW - 0.14, y: rowY + 0.075, w: 0.055, h: 0.055, geometry: 'ellipse', fill: markColor }));
    });
    const groupPresent = group.attendees.filter((person) => person.status === 'present').length;
    shapes.push(pptShape({ x: x + 0.09, y: cardY + cardH - 0.42, w: cardW - 0.18, h: 0.30, text: `${groupPresent} / ${group.attendees.length} 出席`, fontSize: 12, color: '1D2A32', bold: true, margin: 0 }));
  });
  shapes.push(pptShape({ x: 0.42, y: 7.11, w: 8.8, h: 0.18, text: '* 職敬稱略，排名不分先後', fontSize: 9.4, color: '53606A', margin: 0 }));
  shapes.push(pptShape({ x: 10.8, y: 7.08, w: 1.8, h: 0.20, text: pageCount > 1 ? `xPM  ·  ${pageIndex + 1} / ${pageCount}` : 'xPM', fontSize: 9.5, color: '87949C', align: 'r', margin: 0 }));
  const tree = groupShapeTree(shapes);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="參會人員"><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>${tree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(entries) {
  const encoder = new TextEncoder();
  const localParts = [], centralParts = [];
  let offset = 0;
  for (const [path, content] of Object.entries(entries)) {
    const name = encoder.encode(path), data = encoder.encode(content), crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034B50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true); lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true); local.set(name, 30); local.set(data, 30 + name.length);
    localParts.push(local);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014B50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true); central.set(name, 46);
    centralParts.push(central);
    offset += local.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054B50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true); ev.setUint16(8, centralParts.length, true); ev.setUint16(10, centralParts.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}

function makePptx() {
  const pageCount = Math.max(1, Math.ceil(state.groups.length / 7));
  const slideOverrides = Array.from({ length: pageCount }, (_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
  const slideIds = Array.from({ length: pageCount }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join('');
  const slideRelationships = Array.from({ length: pageCount }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join('');
  const masterRelationshipId = `rId${pageCount + 1}`;
  const blankTree = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${slideOverrides}<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`,
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
    'ppt/presentation.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="${masterRelationshipId}"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slideRelationships}<Relationship Id="${masterRelationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/></Relationships>`,
    'ppt/slideLayouts/slideLayout1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank">${blankTree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>',
    'ppt/slideMasters/slideMaster1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Master">${blankTree}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>',
    'ppt/theme/theme1.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="xPM"><a:themeElements><a:clrScheme name="xPM"><a:dk1><a:srgbClr val="172636"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="0B3F66"/></a:dk2><a:lt2><a:srgbClr val="F4F7FA"/></a:lt2><a:accent1><a:srgbClr val="075B91"/></a:accent1><a:accent2><a:srgbClr val="54B8D1"/></a:accent2><a:accent3><a:srgbClr val="F2BE47"/></a:accent3><a:accent4><a:srgbClr val="16825D"/></a:accent4><a:accent5><a:srgbClr val="C05B5B"/></a:accent5><a:accent6><a:srgbClr val="B87919"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="xPM"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface="Microsoft JhengHei"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface="Microsoft JhengHei"/></a:minorFont></a:fontScheme><a:fmtScheme name="xPM"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>'
  };
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const start = pageIndex * 7;
    files[`ppt/slides/slide${pageIndex + 1}.xml`] = buildSlideXml(state.groups.slice(start, start + 7), pageIndex, pageCount);
    files[`ppt/slides/_rels/slide${pageIndex + 1}.xml.rels`] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>';
  }
  return zipStore(files);
}

function exportPowerPoint() {
  const blob = makePptx();
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  const safeTitle = (state.meetingTitle || '參會點名').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 50) || '參會點名';
  link.href = url;
  link.download = `${safeTitle}_${state.meetingDate || 'attendance'}.pptx`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
