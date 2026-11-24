const form = document.querySelector('form');
const minutesInput = document.querySelector('#minutes');
const startButton = document.querySelector('#start');
const stopButton = document.querySelector('#stop');
const statusText = document.querySelector('#status');
let tabId;
let busy = false;

function localTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });
}

function render(state) {
  const { running, nextAt, lastMovedAt, reason } = state;
  startButton.hidden = running;
  startButton.disabled = running || !Number.isInteger(tabId);
  minutesInput.disabled = running;
  stopButton.hidden = !running;
  if (!running) {
    statusText.textContent = reason || '尚未启动。';
    return;
  }
  const location = state.tabId === tabId ? '当前标签页' : '另一个标签页';
  const last = lastMovedAt ? ` 上次 ${localTime(lastMovedAt)}。` : '';
  statusText.textContent = `${location}运行中。下次 ${localTime(nextAt)}。${last}`;
}

async function request(type) {
  const reply = await chrome.runtime.sendMessage({
    type, tabId, minutes: minutesInput.valueAsNumber
  });
  if (reply.error) throw new Error(reply.error);
  return reply;
}

async function change(type) {
  if (busy) return;
  busy = true;
  startButton.disabled = true;
  stopButton.disabled = true;
  try {
    render(await request(type));
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
