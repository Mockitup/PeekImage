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

// Rust -> JS
window.__fromRust = function(event, data) {
  switch (event) {
    case 'image_loaded':
      currentPath = data.path;
      var imgEl = document.getElementById('image');
      imgEl.onload = function() {
        loading = false;
        document.getElementById('loading-spinner').classList.remove('visible');
        document.getElementById('welcome-panel').style.display = 'none';
        Viewer.setImage(data.width || imgEl.naturalWidth, data.height || imgEl.naturalHeight);
        updateStatusBar(data);
        setTitle(data.filename);
        sendToRust('set_title', { title: 'PeekImage - ' + data.filename });
      };
      imgEl.src = data.data_uri;
      break;
    case 'error':
      loading = false;
      document.getElementById('loading-spinner').classList.remove('visible');
      showError(data.message);
      break;
  }
};

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
  document.getElementById('status-nav').textContent =
    data.total > 1 ? data.index + ' / ' + data.total : '';
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

function requestImage(command, data) {
  if (loading) return;
  loading = true;
  document.getElementById('loading-spinner').classList.add('visible');
  sendToRust(command, data);
}

function cycleBgMode() {
  bgModeIndex = (bgModeIndex + 1) % bgModes.length;
  var viewport = document.getElementById('viewport');
  viewport.classList.remove('bg-black', 'bg-white');
  if (bgModes[bgModeIndex] === 'black') viewport.classList.add('bg-black');
  else if (bgModes[bgModeIndex] === 'white') viewport.classList.add('bg-white');
}

// Theme
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('icon-sun').style.display = theme === 'light' ? '' : 'none';
  document.getElementById('icon-moon').style.display = theme === 'light' ? 'none' : '';
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

// Keyboard Shortcuts
document.addEventListener('keydown', function(e) {
  if (e.ctrlKey && e.key === 'o') {
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
  }
});

// Init
document.addEventListener('DOMContentLoaded', function() {
  var saved = null;
  try { saved = localStorage.getItem('peekimage-theme'); } catch(e) {}
  if (saved) setTheme(saved);
  sendToRust('ready');
});
