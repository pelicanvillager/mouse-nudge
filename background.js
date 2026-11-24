let activeRun = null;
let lastStopReason = '';
let controlQueue = Promise.resolve();

function control(action) {
  const operation = controlQueue.then(action);
  controlQueue = operation.catch(() => {});
  return operation;
}

async function stop(run, reason, detached = false) {
  if (!run || activeRun !== run) return;
  activeRun = null;
  lastStopReason = reason;
  clearTimeout(run.timer);
  const tasks = [chrome.action.setBadgeText({ text: '' })];
  if (!detached) tasks.push(chrome.debugger.detach(run.target));
  await Promise.allSettled(tasks);
}

async function requirePage(run) {
  const tab = await chrome.tabs.get(run.target.tabId);
  if (tab.url !== run.url || (tab.pendingUrl && tab.pendingUrl !== run.url)) {
    throw new Error('网页已更换，请重新启动。');
  }
}

async function movePointer(run) {
  await requirePage(run);
  if (activeRun !== run) return;

  const { cssVisualViewport: viewport } = await chrome.debugger.sendCommand(
    run.target, 'Page.getLayoutMetrics'
  );
  const { clientWidth: width, clientHeight: height } = viewport;
  if (width < 32 || height < 32) return;

  const x = width * (0.35 + Math.random() * 0.3);
  const y = height * (0.35 + Math.random() * 0.3);
  const dx = Math.min(36, width * 0.15) * (Math.random() < 0.5 ? -1 : 1);
  const dy = Math.min(12, height * 0.08) * (Math.random() < 0.5 ? -1 : 1);

  for (let step = 0; step <= 12; step += 1) {
    if (activeRun !== run) return;
    const offset = Math.sin(Math.PI * step / 12) ** 2;
    await chrome.debugger.sendCommand(run.target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: x + dx * offset,
      y: y + dy * offset,
      button: 'none',
      buttons: 0
    });
    if (step < 12) await new Promise(resolve => setTimeout(resolve, 24));
  }
  if (activeRun === run) run.lastMovedAt = Date.now();
}

function schedule(run) {
  run.nextAt = Date.now() + run.minutes * 60_000;
  run.timer = setTimeout(async () => {
    if (activeRun !== run) return;
    try {
      await movePointer(run);
      if (activeRun === run) schedule(run);
    } catch (error) {
      await control(() => stop(run, error.message));
    }
  }, run.minutes * 60_000);
}

async function start(tabId, minutes) {
  if (activeRun) throw new Error('已有标签页在运行，请先停止。');
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
    throw new Error('请输入 1 至 60 之间的整数。');
  }

  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:\/\//i.test(tab.url ?? '') || tab.status !== 'complete') {
    throw new Error('请打开普通网页，等页面加载完成后再启动。');
  }

  const run = { target: { tabId }, url: tab.url, minutes };
  await chrome.debugger.attach(run.target, '1.3');
  activeRun = run;
  lastStopReason = '';
  try {
    await requirePage(run);
    await chrome.storage.local.set({ minutes });
    await chrome.action.setBadgeText({ text: '开' });
    schedule(run);
  } catch (error) {
    await stop(run, error.message);
    throw error;
  }
}

function status() {
  if (!activeRun) return { running: false, reason: lastStopReason };
  const { target, nextAt, lastMovedAt } = activeRun;
  return { running: true, tabId: target.tabId, nextAt, lastMovedAt };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.url !== chrome.runtime.getURL('popup.html')) return;
  control(async () => {
    if (message.type === 'start') await start(message.tabId, message.minutes);
    if (message.type === 'stop') await stop(activeRun, '');
    return status();
  }).then(respond, error => respond({ error: error.message }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  const run = activeRun;
  if (run?.target.tabId !== tabId) return;
  if (change.status === 'loading' || (change.url && change.url !== run.url)) {
    void control(() => stop(run, '网页已更换或重新加载，请重新启动。'));
  }
});

chrome.debugger.onDetach.addListener(({ tabId }) => {
  const run = activeRun;
  if (run?.target.tabId === tabId) {
    void control(() => stop(run, '目标标签页已关闭或 Chrome 已结束调试。', true));
  }
});
