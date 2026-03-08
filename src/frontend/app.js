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
var exrLayers = null;
var exrCurrentLayer = '';

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
      // EXR channel controls
      if (data.exr_layers && data.exr_layers.length > 0) {
        exrLayers = data.exr_layers;
        exrCurrentLayer = data.exr_current_layer || '';
        populateLayerSelect(exrLayers, exrCurrentLayer);
        document.getElementById('exr-sep').style.display = '';
        document.getElementById('exr-controls').style.display = '';
        // Reset channel mode
        document.getElementById('channel-mode-select').value = '0';
        if (Renderer) Renderer.setChannelMode(0);
      } else {
        exrLayers = null;
        exrCurrentLayer = '';
        document.getElementById('exr-sep').style.display = 'none';
        document.getElementById('exr-controls').style.display = 'none';
      }
      fetchAndDisplay(data);
      break;
    case 'layer_switched':
      exrCurrentLayer = data.layer;
      loading = true;
      document.getElementById('loading-spinner').classList.add('visible');
      var url = 'http://peekimage.localhost/image?t=' + Date.now();
      fetch(url).then(function(r) { return r.arrayBuffer(); }).then(function(buf) {
        Renderer.uploadHDR(buf, data.width, data.height);
        loading = false;
        document.getElementById('loading-spinner').classList.remove('visible');
        Renderer.render();
        // Update status with layer name
        var layerLabel = data.layer || 'RGBA';
        showStatus('Layer: ' + layerLabel);
      }).catch(function(e) {
        loading = false;
        document.getElementById('loading-spinner').classList.remove('visible');
        showError('Failed to load layer: ' + e.message);
      });
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
  } else if (e.key === '[') {
    e.preventDefault();
    cycleLayer(-1);
  } else if (e.key === ']') {
    e.preventDefault();
    cycleLayer(1);
  } else if (e.key === 'r' && !e.ctrlKey) {
    if (exrLayers) { e.preventDefault(); setChannelMode(1); }
  } else if (e.key === 'g' && !e.ctrlKey) {
    if (exrLayers) { e.preventDefault(); setChannelMode(2); }
  } else if (e.key === 'b' && !e.ctrlKey) {
    if (exrLayers) { e.preventDefault(); setChannelMode(3); }
  } else if (e.key === '0' && !e.ctrlKey) {
    if (exrLayers) { e.preventDefault(); setChannelMode(0); }
  }
});

// EXR Layer/Channel controls
function populateLayerSelect(layers, currentLayer) {
  var sel = document.getElementById('layer-select');
  sel.innerHTML = '';
  for (var i = 0; i < layers.length; i++) {
    var opt = document.createElement('option');
    opt.value = layers[i].name;
    opt.textContent = layers[i].display_name;
    if (layers[i].name === currentLayer) opt.selected = true;
    sel.appendChild(opt);
  }
  // Hide layer dropdown if only 1 layer
  sel.style.display = layers.length > 1 ? '' : 'none';
}

document.getElementById('layer-select').addEventListener('change', function() {
  if (loading) return;
  sendToRust('select_layer', { layer: this.value });
});

document.getElementById('channel-mode-select').addEventListener('change', function() {
  var mode = parseInt(this.value, 10);
  if (Renderer) {
    Renderer.setChannelMode(mode);
    Renderer.render();
  }
});

function setChannelMode(mode) {
  document.getElementById('channel-mode-select').value = String(mode);
  if (Renderer) {
    Renderer.setChannelMode(mode);
    Renderer.render();
  }
}

function cycleLayer(direction) {
  if (!exrLayers || exrLayers.length <= 1 || loading) return;
  var sel = document.getElementById('layer-select');
  var idx = sel.selectedIndex + direction;
  if (idx < 0) idx = exrLayers.length - 1;
  if (idx >= exrLayers.length) idx = 0;
  sel.selectedIndex = idx;
  sendToRust('select_layer', { layer: exrLayers[idx].name });
}

// Pixel inspection
(function() {
  var vp = document.getElementById('viewport');
  var elPixel = document.getElementById('status-pixel');
  var elSwatch = document.getElementById('pixel-swatch');
  var elRgba = document.getElementById('pixel-rgba');
  var elHex = document.getElementById('pixel-hex');

  function clamp8(v) { return Math.max(0, Math.min(255, Math.floor(v))); }

  function updatePixelInfo(px) {
    var r8 = px.isHdr ? clamp8(px.r * 255) : px.r;
    var g8 = px.isHdr ? clamp8(px.g * 255) : px.g;
    var b8 = px.isHdr ? clamp8(px.b * 255) : px.b;
    elSwatch.style.backgroundColor = 'rgb(' + r8 + ',' + g8 + ',' + b8 + ')';
    if (px.isHdr) {
      elRgba.textContent = 'RGBA(' + px.r.toFixed(3) + ', ' + px.g.toFixed(3) + ', ' + px.b.toFixed(3) + ', ' + px.a.toFixed(3) + ')';
    } else {
      elRgba.textContent = 'RGBA(' + px.r + ', ' + px.g + ', ' + px.b + ', ' + px.a + ')';
    }
    var hex = '#' + ('0' + r8.toString(16)).slice(-2) + ('0' + g8.toString(16)).slice(-2) + ('0' + b8.toString(16)).slice(-2);
    elHex.textContent = hex.toUpperCase();
    elPixel.style.display = '';
  }

  vp.addEventListener('mousemove', function(e) {
    var coord = Viewer.screenToImage(e.clientX, e.clientY);
    if (!coord) { elPixel.style.display = 'none'; return; }
    var px = Renderer.getPixel(coord.x, coord.y);
    if (!px) { elPixel.style.display = 'none'; return; }
    updatePixelInfo(px);
  });

  vp.addEventListener('mouseleave', function() {
    elPixel.style.display = 'none';
  });
})();

// Init
document.addEventListener('DOMContentLoaded', function() {
  var saved = null;
  try { saved = localStorage.getItem('peekimage-theme'); } catch(e) {}
  if (saved) setTheme(saved);
  sendToRust('ready');
});
