(() => {
  if (globalThis.mouseNudgeInstalled) return;
  globalThis.mouseNudgeInstalled = true;

  let area;
  let cancelSelection;
  let trace;
  let traceShadow;

  function viewport() {
    return { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
  }

  function selectArea() {
    cancelSelection?.();
    const host = document.createElement('div');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important';
    const shadow = host.attachShadow({ mode: 'closed' });
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;cursor:crosshair;background:#00214435;touch-action:none;user-select:none';
    const hint = document.createElement('div');
    hint.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);background:#16345a;color:white;padding:8px 14px;border-radius:6px;font:14px system-ui;pointer-events:none;white-space:nowrap';
    hint.textContent = '拖出移动范围，松开即启动。按 Esc 取消。';
    const outline = document.createElement('div');
    outline.style.cssText = 'position:absolute;display:none;box-sizing:border-box;border:2px solid #55bcff;background:#61a9ff33;pointer-events:none';
    overlay.append(outline, hint);
    shadow.append(overlay);
    document.documentElement.append(host);

    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    const captureOptions = { ...options, capture: true };
    let start;
    let bounds;

    cancelSelection = () => {
      listeners.abort();
      host.remove();
      cancelSelection = undefined;
    };

    function finish(type) {
      cancelSelection();
      void chrome.runtime.sendMessage({ type }).catch(() => {});
    }

    function draw(event) {
      const { width, height } = viewport();
      const x = Math.max(0, Math.min(width, event.clientX));
      const y = Math.max(0, Math.min(height, event.clientY));
      const left = Math.min(start.x, x);
      const top = Math.min(start.y, y);
      const right = Math.max(start.x, x);
      const bottom = Math.max(start.y, y);
      bounds = { left, top, right, bottom };
      Object.assign(outline.style, {
        display: 'block',
        left: left + 'px',
        top: top + 'px',
        width: right - left + 'px',
        height: bottom - top + 'px'
      });
    }

    overlay.addEventListener('pointerdown', event => {
      if (!event.isTrusted || event.button !== 0 || start) return;
      event.preventDefault();
      event.stopPropagation();
      start = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      overlay.setPointerCapture(event.pointerId);
      draw(event);
    }, options);
    overlay.addEventListener('pointermove', event => {
      if (start?.pointerId === event.pointerId) draw(event);
    }, options);
    overlay.addEventListener('pointerup', event => {
      if (!event.isTrusted || start?.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      draw(event);
      start = undefined;
      const { left, top, right, bottom } = bounds;
      if (right - left < 12 || bottom - top < 12) {
        hint.textContent = '范围太小，请重新拖出一个区域。';
        outline.style.display = 'none';
        return;
      }
      const { width, height } = viewport();
      area = { left: left / width, top: top / height, right: right / width, bottom: bottom / height };
      finish('area-selected');
    }, options);
    overlay.addEventListener('pointercancel', () => finish('selection-cancelled'), options);
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && event.isTrusted) {
        event.preventDefault();
        event.stopPropagation();
        finish('selection-cancelled');
      }
    }, captureOptions);
  }

  function dispatchMove(x, y) {
    let targetDocument = document;
    let target = targetDocument.elementFromPoint(x, y);
    while (target instanceof (targetDocument.defaultView.HTMLIFrameElement) && target.contentDocument) {
      const rect = target.getBoundingClientRect();
      x -= rect.left + target.clientLeft;
      y -= rect.top + target.clientTop;
      targetDocument = target.contentDocument;
      target = targetDocument.elementFromPoint(x, y);
    }
    if (!target) return false;

    const view = targetDocument.defaultView;
    const options = { view, clientX: x, clientY: y, bubbles: true, composed: true };
    target.dispatchEvent(new view.PointerEvent('pointermove', {
      ...options, pointerId: 1, pointerType: 'mouse', isPrimary: true
    }));
    target.dispatchEvent(new view.MouseEvent('mousemove', options));
    return true;
  }

  function showTrace(startX, startY, endX, endY, movedAt) {
    if (!trace?.isConnected) {
      trace = document.createElement('div');
      trace.setAttribute('data-mouse-nudge-trace', '');
      trace.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483646!important;display:block!important;pointer-events:none!important';
      traceShadow = trace.attachShadow({ mode: 'closed' });
      document.documentElement.append(trace);
    }

    const style = document.createElement('style');
    style.textContent = `
      .line, .point, .time { position: absolute; pointer-events: none; }
      .line {
        height: 2px; background: #55d6ff; transform-origin: left center;
        box-shadow: 0 0 0 1px #133250;
      }
      .point {
        width: 8px; height: 8px; box-sizing: border-box; border-radius: 50%;
        background: #55d6ff; border: 1px solid #133250;
        transform: translate(-50%, -50%);
      }
      .time {
        box-sizing: border-box; color: #fff; background: #133250;
        padding: 3px 6px; border-radius: 4px; white-space: nowrap;
        font: 12px/1.4 system-ui, sans-serif;
      }
    `;

    const line = document.createElement('span');
    line.className = 'line';
    const dx = endX - startX;
    const dy = endY - startY;
    Object.assign(line.style, {
      left: startX + 'px',
      top: startY - 1 + 'px',
      width: Math.hypot(dx, dy) + 'px',
      transform: `rotate(${Math.atan2(dy, dx)}rad)`
    });

    const time = document.createElement('time');
    time.className = 'time';
    time.dateTime = new Date(movedAt).toISOString();
    time.textContent = '上次移动 ' + new Date(movedAt).toLocaleTimeString('zh-CN', { hour12: false });
    const { width, height } = viewport();
    time.style.left = `clamp(0px, ${endX + 8}px, ${Math.max(0, width - 112)}px)`;
    time.style.top = (endY + 30 < height ? endY + 6 : Math.max(0, endY - 28)) + 'px';

    const points = [[startX, startY], [endX, endY]].map(([x, y]) => {
      const point = document.createElement('span');
      point.className = 'point';
      point.style.left = x + 'px';
      point.style.top = y + 'px';
      return point;
    });
    traceShadow.replaceChildren(style, line, ...points, time);
  }

  function move() {
    if (!area) return false;
    const { width, height } = viewport();
    const centerX = (area.left + area.right) * width / 2;
    const centerY = (area.top + area.bottom) * height / 2;
    const dx = Math.min(32, (area.right - area.left) * width / 3);
    const dy = Math.min(10, (area.bottom - area.top) * height / 3);

    // Keep the whole sequence in one task so hidden-tab timer throttling cannot split it.
    let start;
    let farthest;
    for (let step = 0; step <= 10; step += 1) {
      const progress = Math.sin(Math.PI * step / 10) ** 2;
      const x = centerX + dx * progress;
      const y = centerY + dy * progress;
      if (dispatchMove(x, y)) {
        start ??= { x, y };
        if (!farthest || progress > farthest.progress) farthest = { x, y, progress };
      }
    }
    if (!start) return false;
    const movedAt = Date.now();
    showTrace(start.x, start.y, farthest.x, farthest.y, movedAt);
    return movedAt;
  }

  chrome.runtime.onMessage.addListener(({ type }, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (type === 'select-area') {
      selectArea();
      respond(true);
    } else if (type === 'default-area') {
      area = { left: 0.35, top: 0.35, right: 0.65, bottom: 0.65 };
      respond(true);
    } else if (type === 'cancel-selection') {
      cancelSelection?.();
      area = undefined;
      trace?.remove();
      trace = undefined;
      traceShadow = undefined;
      respond(true);
    } else if (type === 'move') {
      respond(move());
    }
  });
})();
