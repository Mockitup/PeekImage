var Viewer = (function() {
  var img = document.getElementById('image');
  var viewport = document.getElementById('viewport');

  var state = {
    scale: 1,
    panX: 0,
    panY: 0,
    fitScale: 1,
    naturalWidth: 0,
    naturalHeight: 0,
    mode: 'fit',
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragPanStartX: 0,
    dragPanStartY: 0,
  };

  var MIN_SCALE = 0.05;
  var MAX_SCALE = 32;

  function updateTransform() {
    img.style.transform = 'translate(' + state.panX + 'px, ' + state.panY + 'px) scale(' + state.scale + ')';
    document.getElementById('status-zoom').textContent = Math.round(state.scale * 100) + '%';
  }

  function fitToWindow() {
    if (!state.naturalWidth || !state.naturalHeight) return;
    var vw = viewport.clientWidth;
    var vh = viewport.clientHeight;
    var scaleX = vw / state.naturalWidth;
    var scaleY = vh / state.naturalHeight;
    state.fitScale = Math.min(scaleX, scaleY, 1);
    state.scale = state.fitScale;
    var displayW = state.naturalWidth * state.scale;
    var displayH = state.naturalHeight * state.scale;
    state.panX = (vw - displayW) / 2;
    state.panY = (vh - displayH) / 2;
    state.mode = 'fit';
    updateTransform();
    updateButtons();
  }

  function actualSize() {
    if (!state.naturalWidth || !state.naturalHeight) return;
    state.scale = 1;
    var vw = viewport.clientWidth;
    var vh = viewport.clientHeight;
    state.panX = (vw - state.naturalWidth) / 2;
    state.panY = (vh - state.naturalHeight) / 2;
    state.mode = 'free';
    updateTransform();
    updateButtons();
    showZoomToast();
  }

  function snapScale(oldScale, newScale) {
    // Snap to 100% when zooming across it
    if ((oldScale < 1 && newScale > 1) || (oldScale > 1 && newScale < 1)) {
      return 1;
    }
    // Snap to 100% when very close
    if (Math.abs(newScale - 1) < 0.03) {
      return 1;
    }
    return newScale;
  }

  function zoomAtPoint(newScale, clientX, clientY) {
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
    newScale = snapScale(state.scale, newScale);
    var rect = viewport.getBoundingClientRect();
    var mx = clientX - rect.left;
    var my = clientY - rect.top;

    var imgX = (mx - state.panX) / state.scale;
    var imgY = (my - state.panY) / state.scale;

    state.scale = newScale;

    state.panX = mx - imgX * state.scale;
    state.panY = my - imgY * state.scale;

    state.mode = 'free';
    updateTransform();
    updateButtons();
    showZoomToast();
  }

  function zoomAtCenter(newScale) {
    var rect = viewport.getBoundingClientRect();
    zoomAtPoint(newScale, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function setImage(naturalWidth, naturalHeight) {
    state.naturalWidth = naturalWidth;
    state.naturalHeight = naturalHeight;
    img.style.transformOrigin = '0 0';
    img.style.display = '';
    fitToWindow();
  }

  function updateButtons() {
    document.getElementById('btn-fit').classList.toggle('active', state.mode === 'fit');
    document.getElementById('btn-actual').classList.toggle('active', state.scale === 1 && state.mode !== 'fit');
  }

  // Mouse wheel zoom (no Ctrl needed)
  viewport.addEventListener('wheel', function(e) {
    if (!state.naturalWidth) return;
    e.preventDefault();
    var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAtPoint(state.scale * factor, e.clientX, e.clientY);
  }, { passive: false });

  // Drag pan
  viewport.addEventListener('mousedown', function(e) {
    if (e.button !== 0 || !state.naturalWidth) return;
    state.dragging = true;
    state.dragStartX = e.clientX;
    state.dragStartY = e.clientY;
    state.dragPanStartX = state.panX;
    state.dragPanStartY = state.panY;
    viewport.style.cursor = 'grabbing';
    e.preventDefault();
  });

  document.addEventListener('mousemove', function(e) {
    if (!state.dragging) return;
    state.panX = state.dragPanStartX + (e.clientX - state.dragStartX);
    state.panY = state.dragPanStartY + (e.clientY - state.dragStartY);
    state.mode = 'free';
    updateTransform();
    updateButtons();
  });

  document.addEventListener('mouseup', function() {
    if (!state.dragging) return;
    state.dragging = false;
    viewport.style.cursor = '';
  });

  // Double-click toggle fit/actual
  viewport.addEventListener('dblclick', function() {
    if (!state.naturalWidth) return;
    if (state.mode === 'fit') {
      actualSize();
    } else {
      fitToWindow();
    }
  });

  function centerAtCurrentScale() {
    if (!state.naturalWidth || !state.naturalHeight) return;
    var vw = viewport.clientWidth;
    var vh = viewport.clientHeight;
    var displayW = state.naturalWidth * state.scale;
    var displayH = state.naturalHeight * state.scale;
    state.panX = (vw - displayW) / 2;
    state.panY = (vh - displayH) / 2;
    updateTransform();
  }

  // Recenter on resize
  window.addEventListener('resize', function() {
    if (state.mode === 'fit') {
      fitToWindow();
    } else {
      centerAtCurrentScale();
    }
  });

  function showZoomToast() {
    var toast = document.getElementById('zoom-toast');
    toast.textContent = Math.round(state.scale * 100) + '%';
    toast.classList.add('visible');
    clearTimeout(showZoomToast._timer);
    showZoomToast._timer = setTimeout(function() {
      toast.classList.remove('visible');
    }, 800);
  }

  return {
    setImage: setImage,
    fitToWindow: fitToWindow,
    actualSize: actualSize,
    zoomIn: function() { zoomAtCenter(snapScale(state.scale, state.scale * 1.25)); },
    zoomOut: function() { zoomAtCenter(snapScale(state.scale, state.scale / 1.25)); },
    getScale: function() { return state.scale; },
  };
})();
