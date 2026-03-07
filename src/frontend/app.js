// IPC Bridge
function sendToRust(command, data) {
  var msg = JSON.stringify(Object.assign({ command: command }, data || {}));
  window.ipc.postMessage(msg);
}

// State
var currentPath = null;
var loading = false;
var bgModes = ['checker', 'black', 'white'];
var bgModeIndex = 0;
var isHdr = false;
var currentExposure = 0;

// Rust -> JS
window.__fromRust = function(event, data) {
  switch (event) {
    case 'image_ready':
      currentPath = data.path;
      isHdr = !!data.is_hdr;
      document.getElementById('hdr-sep').style.display = isHdr ? '' : 'none';
      document.getElementById('hdr-controls').style.display = isHdr ? '' : 'none';
      if (isHdr) {
        currentExposure = 0;
        document.getElementById('exposure-slider').value = 0;
        document.getElementById('exposure-value').textContent = '0.0';
      }
      fetchAndDisplay(data);
      break;
    case 'loading_done':
      loading = false;
      document.getElementById('loading-spinner').classList.remove('visible');
      break;
    case 'copied':
      showStatus('Copied to clipboard');
      break;
    case 'error':
      loading = false;
      document.getElementById('loading-spinner').classList.remove('visible');
      showError(data.message);
      break;
  }
};

function fetchAndDisplay(data) {
  loading = true;
  document.getElementById('loading-spinner').classList.add('visible');
  var url = 'http://peekimage.localhost/image?t=' + Date.now();
  if (data.is_hdr) {
    fetch(url).then(function(r) { return r.arrayBuffer(); }).then(function(buf) {
      Renderer.uploadHDR(buf, data.width, data.height);
      finishDisplay(data);
    }).catch(function(e) {
      loading = false;
      document.getElementById('loading-spinner').classList.remove('visible');
      showError('Failed to fetch image: ' + e.message);
    });
  } else {
    fetch(url).then(function(r) { return r.blob(); }).then(function(blob) {
      var objUrl = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function() {
        Renderer.uploadLDR(img);
        URL.revokeObjectURL(objUrl);
        finishDisplay(data);
      };
      img.onerror = function() {
        URL.revokeObjectURL(objUrl);
        loading = false;
        document.getElementById('loading-spinner').classList.remove('visible');
        showError('Failed to display image');
      };
      img.src = objUrl;
    }).catch(function(e) {
      loading = false;
      document.getElementById('loading-spinner').classList.remove('visible');
      showError('Failed to fetch image: ' + e.message);
    });
  }
}

function finishDisplay(data) {
  loading = false;
  document.getElementById('loading-spinner').classList.remove('visible');
  document.getElementById('welcome-panel').style.display = 'none';
  Viewer.setImage(data.width, data.height);
  updateStatusBar(data);
  setTitle(data.filename);
  sendToRust('set_title', { title: 'PeekImage - ' + data.filename });
}

function setTitle(title) {
  document.getElementById('titlebar-title').textContent = title;
}

function updateStatusBar(data) {
  clearError();
  document.getElementById('status-filename').textContent = data.filename;
  var w = data.width, h = data.height;
  document.getElementById('status-dimensions').textContent =
    (w && h) ? w + ' \u00d7 ' + h : '';
  document.getElementById('status-filesize').textContent = formatFileSize(data.file_size);
  document.getElementById('status-format').textContent = data.format;
  lastNavText = data.total > 1 ? data.index + ' / ' + data.total : '';
  document.getElementById('status-nav').textContent = lastNavText;
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

var errorTimer = null;
function showError(message) {
  var el = document.getElementById('status-filename');
  el.textContent = 'Error: ' + message;
  el.style.color = 'var(--danger)';
  clearTimeout(errorTimer);
  errorTimer = setTimeout(function() { el.style.color = ''; }, 5000);
}

function clearError() {
  var el = document.getElementById('status-filename');
  el.style.color = '';
  clearTimeout(errorTimer);
}

var statusTimer = null;
var lastNavText = '';
function showStatus(message) {
  var el = document.getElementById('status-nav');
  el.textContent = message;
  el.style.color = 'var(--accent)';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(function() { el.textContent = lastNavText; el.style.color = ''; }, 1500);
}

function requestImage(command, data) {
  if (loading) return;
  loading = true;
  document.getElementById('loading-spinner').classList.add('visible');
  sendToRust(command, data);
}

function cycleBgMode() {
  bgModeIndex = (bgModeIndex + 1) % bgModes.length;
  if (Renderer) {
    Renderer.setBgMode(bgModeIndex);
    Renderer.render();
  }
}

// Theme
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('icon-sun').style.display = theme === 'light' ? '' : 'none';
  document.getElementById('icon-moon').style.display = theme === 'light' ? 'none' : '';
  if (Renderer) {
    Renderer.updateThemeColors();
    Renderer.render();
  }
  try { localStorage.setItem('peekimage-theme', theme); } catch(e) {}
}

document.getElementById('btn-theme').addEventListener('click', function() {
  var current = document.documentElement.getAttribute('data-theme') || 'dark';
  setTheme(current === 'dark' ? 'light' : 'dark');
});

// Window Controls
document.getElementById('btn-minimize').addEventListener('click', function() { sendToRust('window_minimize'); });
document.getElementById('btn-maximize').addEventListener('click', function() { sendToRust('window_maximize'); });
document.getElementById('btn-close').addEventListener('click', function() { sendToRust('window_close'); });

// Toolbar Buttons
document.getElementById('btn-open').addEventListener('click', function() { requestImage('open_image'); });
document.getElementById('btn-prev').addEventListener('click', function() {
  if (currentPath) requestImage('prev_image', { path: currentPath });
});
document.getElementById('btn-next').addEventListener('click', function() {
  if (currentPath) requestImage('next_image', { path: currentPath });
});
document.getElementById('btn-fit').addEventListener('click', function() { Viewer.fitToWindow(); });
document.getElementById('btn-actual').addEventListener('click', function() { Viewer.actualSize(); });

// Exposure Slider - instant, no IPC
document.getElementById('exposure-slider').addEventListener('dblclick', function() {
  this.value = 0;
  currentExposure = 0;
  document.getElementById('exposure-value').textContent = '0.0';
  if (Renderer) { Renderer.setExposure(0); Renderer.render(); }
});
document.getElementById('exposure-slider').addEventListener('input', function() {
  var val = parseFloat(this.value);
  currentExposure = val;
  document.getElementById('exposure-value').textContent = val.toFixed(1);
  if (Renderer) {
    Renderer.setExposure(val);
    Renderer.render();
  }
});

// Keyboard Shortcuts
document.addEventListener('keydown', function(e) {
  if (e.ctrlKey && e.key === 'c') {
    e.preventDefault();
    if (currentPath) {
      var copyData = { path: currentPath };
      if (isHdr) copyData.exposure = currentExposure;
      sendToRust('copy_image', copyData);
    }
  } else if (e.ctrlKey && e.key === 'v') {
    e.preventDefault();
    requestImage('paste_image');
  } else if (e.ctrlKey && e.key === 'o') {
    e.preventDefault();
    requestImage('open_image');
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (currentPath) requestImage('prev_image', { path: currentPath });
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (currentPath) requestImage('next_image', { path: currentPath });
  } else if (e.key === 'f' || e.key === 'F') {
    if (e.ctrlKey) return;
    e.preventDefault();
    Viewer.fitToWindow();
  } else if (e.ctrlKey && e.key === '1') {
    e.preventDefault();
    Viewer.actualSize();
  } else if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    Viewer.zoomIn();
  } else if (e.ctrlKey && e.key === '-') {
    e.preventDefault();
    Viewer.zoomOut();
  } else if (e.key === 'a' || e.key === 'A') {
    if (e.ctrlKey) return;
    e.preventDefault();
    cycleBgMode();
  } else if (e.key === 'e' || e.key === 'E') {
    if (e.ctrlKey) return;
    e.preventDefault();
    if (isHdr) {
      currentExposure = 0;
      document.getElementById('exposure-slider').value = 0;
      document.getElementById('exposure-value').textContent = '0.0';
      if (Renderer) {
        Renderer.setExposure(0);
        Renderer.render();
      }
    }
  }
});

// Init
document.addEventListener('DOMContentLoaded', function() {
  var saved = null;
  try { saved = localStorage.getItem('peekimage-theme'); } catch(e) {}
  if (saved) setTheme(saved);
  sendToRust('ready');
});
