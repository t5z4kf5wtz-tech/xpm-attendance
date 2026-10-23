import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const appRoot = document.getElementById('app');
const config = window.ATTENDANCE_CLOUD_CONFIG || {};
const accessKey = new URLSearchParams(location.hash.slice(1)).get('access');

function showMessage(title, body) {
  appRoot.innerHTML = `<main class="cloud-message"><p class="eyebrow">XPM ATTENDANCE</p><h1>${title}</h1><p>${body}</p></main>`;
}

if (!accessKey) {
  showMessage('需要點名分享連結', '請使用管理者提供的完整連結開啟。分享連結持有人可查看及修改整份名單。');
} else if (!config.supabaseUrl || !config.publishableKey || config.supabaseUrl.startsWith('REPLACE_')) {
  showMessage('雲端尚未完成設定', '目前的網頁尚未連接雲端資料庫，請管理者完成部署設定後再試。');
} else {
  const supabase = createClient(config.supabaseUrl, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const toUiState = (data) => ({
    ...data.config,
    groups: Object.values(data.groups || {}).sort((a, b) => a.position - b.position).map((group) => ({
      id: group.id,
      name: group.name,
      attendees: Object.values(group.attendees || {}).sort((a, b) => a.position - b.position)
    }))
  });
  const toDatabaseState = (state) => ({
    config: { meetingTitle: state.meetingTitle, meetingDate: state.meetingDate, businessUnit: state.businessUnit, notices: state.notices },
    groups: Object.fromEntries(state.groups.map((group, position) => [group.id, {
      id: group.id,
      name: group.name,
      position,
      attendees: Object.fromEntries(group.attendees.map((person, personPosition) => [person.id, { ...person, position: personPosition }]))
    }]))
  });
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const diff = (before, after) => {
    const patches = [];
    for (const key of ['meetingTitle', 'meetingDate', 'businessUnit', 'notices']) {
      if (before.config?.[key] !== after.config[key]) patches.push({ op: 'set', path: ['config', key], value: after.config[key] });
    }
    const previousGroups = before.groups || {};
    for (const [id, group] of Object.entries(after.groups)) {
      const oldGroup = previousGroups[id];
      if (!oldGroup) {
        patches.push({ op: 'set', path: ['groups', id], value: group });
        continue;
      }
      if (oldGroup.name !== group.name) patches.push({ op: 'set', path: ['groups', id, 'name'], value: group.name });
      if (oldGroup.position !== group.position) patches.push({ op: 'set', path: ['groups', id, 'position'], value: group.position });
      const previousPeople = oldGroup.attendees || {};
      for (const [personId, person] of Object.entries(group.attendees)) {
        const oldPerson = previousPeople[personId];
        if (!oldPerson) {
          patches.push({ op: 'set', path: ['groups', id, 'attendees', personId], value: person });
          continue;
        }
        for (const field of ['chineseName', 'englishName', 'status', 'position']) {
          if (oldPerson[field] !== person[field]) patches.push({ op: 'set', path: ['groups', id, 'attendees', personId, field], value: person[field] });
        }
      }
      for (const personId of Object.keys(previousPeople)) {
        if (!(personId in group.attendees)) patches.push({ op: 'delete', path: ['groups', id, 'attendees', personId] });
      }
    }
    for (const id of Object.keys(previousGroups)) {
      if (!(id in after.groups)) patches.push({ op: 'delete', path: ['groups', id] });
    }
    return patches;
  };
  const readRemote = async () => {
    const { data, error } = await supabase.rpc('attendance_read_state', { p_access_key: accessKey });
    if (error) throw error;
    return data;
  };

  try {
    let baseline = await readRemote();
    window.ATTENDANCE_SHARED_MODE = true;
    window.ATTENDANCE_INITIAL_STATE = toUiState(baseline);
    let latestState = clone(window.ATTENDANCE_INITIAL_STATE);
    let timer = null;
    let inFlight = false;
    let changes = 0;
    const indicator = (text) => {
      const item = document.getElementById('save-status');
      if (item) item.innerHTML = `<i></i> ${text}`;
    };
    const flush = async () => {
      if (inFlight) return;
      clearTimeout(timer);
      timer = null;
      const snapshot = clone(latestState);
      const revision = changes;
      const patches = diff(baseline, toDatabaseState(snapshot));
      if (!patches.length) return;
      inFlight = true;
      indicator('同步中…');
      const { error } = await supabase.rpc('attendance_apply_patches', { p_access_key: accessKey, p_patches: patches });
      inFlight = false;
      if (error) {
        indicator('同步失敗，稍後重試');
        console.error('Attendance sync failed.', error.message);
        timer = setTimeout(flush, 5000);
        return;
      }
      baseline = toDatabaseState(snapshot);
      if (changes !== revision) {
        timer = setTimeout(flush, 300);
      } else {
        indicator('已同步至雲端');
      }
    };
    window.ATTENDANCE_SHARED = {
      save(state) {
        latestState = clone(state);
        changes += 1;
        clearTimeout(timer);
        timer = setTimeout(flush, 350);
        indicator('等待同步…');
      }
    };
    const script = document.createElement('script');
    script.src = new URL('app.js', location.href).href;
    script.onload = () => {
      indicator('已同步至雲端');
      window.setInterval(async () => {
        if (inFlight || timer || document.activeElement?.matches('input, textarea, select') || document.querySelector('dialog[open]')) return;
        try {
          const remote = await readRemote();
          if (!equal(remote, baseline)) {
            baseline = remote;
            latestState = toUiState(remote);
            window.ATTENDANCE_APPLY_REMOTE(latestState);
          }
        } catch (error) {
          indicator('雲端連線中斷');
          console.error('Attendance refresh failed.', error.message);
        }
      }, 5000);
    };
    script.onerror = () => showMessage('無法載入點名系統', '請重新整理頁面；若問題持續，請聯絡管理者。');
    document.body.append(script);
  } catch (error) {
    console.error('Attendance access failed.', error.message);
    showMessage('連結無效或雲端暫不可用', '請確認您使用的是最新分享連結，或稍後再試。');
  }
}
