const form = document.querySelector('form');
const minutesInput = document.querySelector('#minutes');
const startButton = document.querySelector('#start');
const defaultButton = document.querySelector('#default-area');
const stopButton = document.querySelector('#stop');
const statusText = document.querySelector('#status');
let tabId;
let busy = false;

function localTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });
}

function render(state) {
  const { running, selecting, nextAt, lastMovedAt } = state;
  startButton.hidden = running;
  defaultButton.hidden = running;
  startButton.disabled = running || !Number.isInteger(tabId);
  defaultButton.disabled = startButton.disabled;
  minutesInput.disabled = running;
  stopButton.hidden = !running && !selecting;
  if (!running) {
    statusText.textContent = selecting ? '正在等待框选范围。' : '在当前标签页启动后生效。';
    return;
  }
  const last = lastMovedAt ? ` 上次 ${localTime(lastMovedAt)}。` : '';
  statusText.textContent = `运行中。下次 ${localTime(nextAt)}。${last}`;
}

async function request(type, useDefaultArea = false) {
  const reply = await chrome.runtime.sendMessage({
    type, tabId, useDefaultArea, minutes: minutesInput.valueAsNumber
  });
  if (reply.error) throw new Error(reply.error);
  return reply;
}

async function change(type, useDefaultArea = false) {
  if (busy) return;
  busy = true;
  startButton.disabled = true;
  defaultButton.disabled = true;
  stopButton.disabled = true;
  try {
    const state = await request(type, useDefaultArea);
    render(state);
    if (type === 'start' && state.selecting) window.close();
  } catch (error) {
    render(await request('status').catch(() => ({ running: false })));
    statusText.textContent = error.message;
  } finally {
    stopButton.disabled = false;
    busy = false;
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  void change('start');
});

defaultButton.addEventListener('click', () => {
  if (form.reportValidity()) void change('start', true);
});

stopButton.addEventListener('click', () => void change('stop'));

async function initialize() {
  try {
    const [[tab], settings] = await Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      chrome.storage.local.get({ minutes: 3 })
    ]);
    tabId = tab?.id;
    minutesInput.value = settings.minutes;
    render(await request('status'));
  } catch (error) {
    statusText.textContent = error.message;
  }
}

void initialize();
