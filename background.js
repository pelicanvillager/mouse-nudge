const alarmName = 'move-pointer';
let queue = Promise.resolve();

function control(action) {
  const operation = queue.then(action);
  queue = operation.catch(() => {});
  return operation;
}

async function readRun() {
  const { run } = await chrome.storage.session.get('run');
  return run;
}

async function send(run, type) {
  let timeout;
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(run.tabId, { type }, { documentId: run.documentId }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('目标页面未响应。')), 3000);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function stop(run) {
  await chrome.storage.session.remove('run');
  void send(run, 'cancel-selection').catch(() => {});
  await Promise.allSettled([
    chrome.alarms.clear(alarmName),
    chrome.action.setBadgeText({ tabId: run.tabId, text: '' })
  ]);
}

async function activate(run) {
  try {
    await chrome.storage.local.set({ minutes: run.minutes });
    await chrome.alarms.create(alarmName, {
      delayInMinutes: run.minutes,
      periodInMinutes: run.minutes
    });
    await chrome.storage.session.set({ run: { ...run, selecting: false } });
    await chrome.action.setBadgeText({ tabId: run.tabId, text: '开' });
  } catch (error) {
    await stop(run);
    throw error;
  }
}

async function start(tabId, minutes, useDefaultArea) {
  const previous = await readRun();
  if (previous) {
    if (previous.tabId !== tabId || !previous.selecting) {
      throw new Error('请先在原标签页停止。');
    }
    await stop(previous);
  }
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
    throw new Error('请输入 1 至 60 之间的整数。');
  }

  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:\/\//i.test(tab.url ?? '') || tab.status !== 'complete') {
    throw new Error('请打开普通网页，等页面加载完成后再启动。');
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    files: ['page.js']
  });
  const run = { tabId, documentId: result.documentId, minutes, url: tab.url, selecting: true };
  await chrome.storage.session.set({ run });

  try {
    const ready = await send(run, useDefaultArea ? 'default-area' : 'select-area');
    if (!ready) throw new Error('网页未能设置移动范围。');
    if (useDefaultArea) await activate(run);
  } catch (error) {
    await stop(run);
    throw error;
  }
}

async function status(tabId) {
  const run = await readRun();
  if (run?.tabId !== tabId || !run) return { running: false };
  if (run.selecting) return { running: false, selecting: true };
  const alarm = await chrome.alarms.get(alarmName);
  if (!alarm) {
    await activate(run);
    return status(tabId);
  }
  return { running: true, nextAt: alarm.scheduledTime, lastMovedAt: run.lastMovedAt };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const fromPopup = sender.url === chrome.runtime.getURL('popup.html');
  const fromPage = ['area-selected', 'selection-cancelled'].includes(message.type);
  if (!fromPopup && !fromPage) return;

  control(async () => {
    if (fromPopup) {
      if (message.type === 'start') {
        await start(message.tabId, message.minutes, message.useDefaultArea);
      }
      if (message.type === 'stop') {
        const run = await readRun();
        if (run?.tabId === message.tabId) await stop(run);
      }
      return status(message.tabId);
    }

    const run = await readRun();
    if (run?.selecting && run.tabId === sender.tab?.id && run.documentId === sender.documentId) {
      if (message.type === 'area-selected') await activate(run);
      else await stop(run);
    }
    return {};
  }).then(respond, error => respond({ error: error.message }));
  return true;
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== alarmName) return;
  void control(async () => {
    const run = await readRun();
    if (!run) {
      await chrome.alarms.clear(alarmName);
    } else if (!run.selecting) {
      try {
        const lastMovedAt = await send(run, 'move');
        if (Number.isFinite(lastMovedAt)) {
          await chrome.storage.session.set({ run: { ...run, lastMovedAt } });
        }
      } catch {
        await stop(run);
      }
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== 'loading' && !change.url) return;
  void control(async () => {
    const run = await readRun();
    if (run?.tabId === tabId && (change.status === 'loading' || change.url !== run.url)) {
      await stop(run);
    }
  });
});

chrome.tabs.onRemoved.addListener(tabId => {
  void control(async () => {
    const run = await readRun();
    if (run?.tabId === tabId) await stop(run);
  });
});
