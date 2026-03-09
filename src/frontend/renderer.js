var Renderer = (function() {
  var canvas = document.getElementById('canvas');
  var gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false });
  if (!gl) { console.error('WebGL2 not supported'); return null; }

  // Enable float textures
  var floatExt = gl.getExtension('EXT_color_buffer_float');
  var floatLinear = gl.getExtension('OES_texture_float_linear');

  // GPU texture size limit
  var _maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);

  // Shader sources
  var VS_SRC = [
    '#version 300 es',
    'in vec2 a_pos;',
    'out vec2 v_screenPos;',
    'uniform vec2 u_resolution;',
    'void main() {',
    '  v_screenPos = a_pos;',
    '  vec2 ndc = (a_pos / u_resolution) * 2.0 - 1.0;',
    '  ndc.y = -ndc.y;',
    '  gl_Position = vec4(ndc, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FS_SRC = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 v_screenPos;',
    'out vec4 fragColor;',
    'uniform sampler2D u_texture;',
    'uniform vec2 u_imageSize;',
    'uniform vec3 u_transform;',  // panX*dpr, panY*dpr, scale
    'uniform vec2 u_resolution;',
    'uniform float u_exposure;',
    'uniform bool u_isHdr;',
    'uniform int u_bgMode;',     // 0=checker, 1=black, 2=white
    'uniform int u_channelMode;', // 0=RGB, 1=R, 2=G, 3=B, 4=A, 5=Luma
    'uniform bool u_ignoreAlpha;',
    'uniform vec3 u_checkerA;',
    'uniform vec3 u_checkerB;',
    'uniform vec2 u_tileOffset;',
    'uniform vec2 u_tileSize;',
    'uniform bool u_bgPass;',
    'uniform bool u_srgb;',
    '',
    'vec3 linearToSrgb(vec3 c) {',
    '  vec3 lo = c * 12.92;',
    '  vec3 hi = 1.055 * pow(c, vec3(1.0/2.4)) - 0.055;',
    '  return mix(lo, hi, step(vec3(0.0031308), c));',
    '}',
    '',
    'vec3 checkerboard(vec2 pos) {',
    '  float size = 10.0;',
    '  vec2 cell = floor(pos / size);',
    '  float check = mod(cell.x + cell.y, 2.0);',
    '  return mix(u_checkerA, u_checkerB, check);',
    '}',
    '',
    'void main() {',
    '  vec3 bg;',
    '  if (u_bgMode == 1) bg = vec3(0.0);',
    '  else if (u_bgMode == 2) bg = vec3(0.863, 0.878, 0.910);',
    '  else bg = checkerboard(v_screenPos);',
    '',
    '  if (u_bgPass) {',
    '    fragColor = vec4(bg, 1.0);',
    '    return;',
    '  }',
    '',
    '  vec2 imgPos = (v_screenPos - u_transform.xy) / u_transform.z;',
    '',
    '  vec2 tilePos = imgPos - u_tileOffset;',
    '  vec2 tileUv = tilePos / u_tileSize;',
    '  if (tileUv.x < 0.0 || tileUv.x > 1.0 || tileUv.y < 0.0 || tileUv.y > 1.0) {',
    '    discard;',
    '  }',
    '',
    '  vec4 texel = texture(u_texture, tileUv);',
    '  vec3 color = texel.rgb;',
    '  float a = texel.a;',
    '  if (u_channelMode == 1) { color = vec3(color.r); a = 1.0; }',
    '  else if (u_channelMode == 2) { color = vec3(color.g); a = 1.0; }',
    '  else if (u_channelMode == 3) { color = vec3(color.b); a = 1.0; }',
    '  else if (u_channelMode == 4) { color = vec3(a); a = 1.0; }',
    '  else if (u_channelMode == 5) { color = vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))); a = 1.0; }',
    '  if (u_isHdr) {',
    '    color = color * exp2(u_exposure);',
    '    if (u_srgb) color = linearToSrgb(color);',
    '    color = clamp(color, 0.0, 1.0);',
    '  }',
    '  if (u_ignoreAlpha) a = 1.0;',
    '  vec3 final_color = mix(bg, color, a);',
    '  fragColor = vec4(final_color, 1.0);',
    '}'
  ].join('\n');

  function compileShader(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Shader error:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  var vs = compileShader(gl.VERTEX_SHADER, VS_SRC);
  var fs = compileShader(gl.FRAGMENT_SHADER, FS_SRC);
  var program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);

  // Uniforms
  var u_texture = gl.getUniformLocation(program, 'u_texture');
  var u_imageSize = gl.getUniformLocation(program, 'u_imageSize');
  var u_transform = gl.getUniformLocation(program, 'u_transform');
  var u_resolution = gl.getUniformLocation(program, 'u_resolution');
  var u_exposure = gl.getUniformLocation(program, 'u_exposure');
  var u_isHdr = gl.getUniformLocation(program, 'u_isHdr');
  var u_bgMode = gl.getUniformLocation(program, 'u_bgMode');
  var u_channelMode = gl.getUniformLocation(program, 'u_channelMode');
  var u_ignoreAlpha = gl.getUniformLocation(program, 'u_ignoreAlpha');
  var u_checkerA = gl.getUniformLocation(program, 'u_checkerA');
  var u_checkerB = gl.getUniformLocation(program, 'u_checkerB');
  var u_tileOffset = gl.getUniformLocation(program, 'u_tileOffset');
  var u_tileSize = gl.getUniformLocation(program, 'u_tileSize');
  var u_bgPass = gl.getUniformLocation(program, 'u_bgPass');
  var u_srgb = gl.getUniformLocation(program, 'u_srgb');

  // Fullscreen quad VAO
  var vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  var posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  // Will be updated on resize
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 1,1]), gl.DYNAMIC_DRAW);
  var a_pos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(a_pos);
  gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 0, 0);

  // State
  var _hasImage = false;
  var _isHdr = false;
  var _imageW = 0, _imageH = 0;
  var _panX = 0, _panY = 0, _scale = 1;
  var _exposure = 0;
  var _bgMode = 0;
  var _channelMode = 0;
  var _ignoreAlpha = false;
  var _srgb = false;
  var _pixelData = null;
  var _tiles = []; // [{texture, x, y, w, h}]

  function parseThemeColor(varName) {
    var val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (!val) return [0, 0, 0];
    // Handle hex
    if (val.startsWith('#')) {
      var hex = val.slice(1);
      if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
      return [parseInt(hex.slice(0,2),16)/255, parseInt(hex.slice(2,4),16)/255, parseInt(hex.slice(4,6),16)/255];
    }
    // Handle rgba(...)
    var m = val.match(/[\d.]+/g);
    if (m && m.length >= 3) return [parseFloat(m[0])/255, parseFloat(m[1])/255, parseFloat(m[2])/255];
    return [0, 0, 0];
  }

  var _checkerA = [0, 0, 0];
  var _checkerB = [0, 0, 0];

  function updateThemeColors() {
    var base = parseThemeColor('--bg-base');
    // Checker: base +/- slight offset
    var isDark = base[0] + base[1] + base[2] < 1.5;
    var offset = isDark ? 0.035 : -0.035;
    _checkerA = base;
    _checkerB = [
      Math.max(0, Math.min(1, base[0] + offset)),
      Math.max(0, Math.min(1, base[1] + offset)),
      Math.max(0, Math.min(1, base[2] + offset))
    ];
  }

  updateThemeColors();

  function updateQuad() {
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.width;
    var h = canvas.height;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 0,  w, 0,  0, h,  w, h
    ]), gl.DYNAMIC_DRAW);
  }

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    var cw = canvas.clientWidth;
    var ch = canvas.clientHeight;
    var pw = Math.round(cw * dpr);
    var ph = Math.round(ch * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    gl.viewport(0, 0, pw, ph);
    updateQuad();
  }

  function freeTiles() {
    for (var i = 0; i < _tiles.length; i++) {
      gl.deleteTexture(_tiles[i].texture);
    }
    _tiles = [];
  }

  function createTileTexture() {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function render() {
    if (!_hasImage) return;
    var dpr = window.devicePixelRatio || 1;
    resize();

    // Common uniforms
    gl.uniform2f(u_resolution, canvas.width, canvas.height);
    gl.uniform2f(u_imageSize, _imageW, _imageH);
    gl.uniform3f(u_transform, _panX * dpr, _panY * dpr, _scale);
    gl.uniform1f(u_exposure, _exposure);
    gl.uniform1i(u_isHdr, _isHdr ? 1 : 0);
    gl.uniform1i(u_bgMode, _bgMode);
    gl.uniform1i(u_channelMode, _channelMode);
    gl.uniform1i(u_ignoreAlpha, _ignoreAlpha ? 1 : 0);
    gl.uniform1i(u_srgb, _srgb ? 1 : 0);
    gl.uniform3f(u_checkerA, _checkerA[0], _checkerA[1], _checkerA[2]);
    gl.uniform3f(u_checkerB, _checkerB[0], _checkerB[1], _checkerB[2]);

    gl.bindVertexArray(vao);

    // Background pass (draws bg everywhere, tiles overdraw with image)
    gl.uniform1i(u_bgPass, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.uniform1i(u_bgPass, 0);

    // Tile passes
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(u_texture, 0);
    for (var i = 0; i < _tiles.length; i++) {
      var tile = _tiles[i];
      gl.bindTexture(gl.TEXTURE_2D, tile.texture);
      gl.uniform2f(u_tileOffset, tile.x, tile.y);
      gl.uniform2f(u_tileSize, tile.w, tile.h);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  function uploadLDR(htmlImage) {
    var w = htmlImage.naturalWidth || htmlImage.width;
    var h = htmlImage.naturalHeight || htmlImage.height;
    _imageW = w;
    _imageH = h;
    _isHdr = false;
    _hasImage = true;
    _exposure = 0;

    freeTiles();

    var tileW = Math.min(w, _maxTexSize);
    var tileH = Math.min(h, _maxTexSize);

    for (var ty = 0; ty < h; ty += tileH) {
      for (var tx = 0; tx < w; tx += tileW) {
        var tw = Math.min(tileW, w - tx);
        var th = Math.min(tileH, h - ty);

        var oc = document.createElement('canvas');
        oc.width = tw;
        oc.height = th;
        var ctx = oc.getContext('2d');
        ctx.drawImage(htmlImage, tx, ty, tw, th, 0, 0, tw, th);

        var tex = createTileTexture();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, oc);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

        _tiles.push({ texture: tex, x: tx, y: ty, w: tw, h: th });
      }
    }

    // Extract pixel data for inspection
    try {
      var pc = document.createElement('canvas');
      pc.width = w;
      pc.height = h;
      var pctx = pc.getContext('2d');
      pctx.drawImage(htmlImage, 0, 0);
      _pixelData = pctx.getImageData(0, 0, w, h).data;
    } catch(e) {
      _pixelData = null;
    }
  }

  function uploadHDR(arrayBuffer, w, h) {
    var floatData = new Float32Array(arrayBuffer);
    _imageW = w;
    _imageH = h;
    _isHdr = true;
    _hasImage = true;
    _exposure = 0;

    freeTiles();

    var tileW = Math.min(w, _maxTexSize);
    var tileH = Math.min(h, _maxTexSize);

    for (var ty = 0; ty < h; ty += tileH) {
      for (var tx = 0; tx < w; tx += tileW) {
        var tw = Math.min(tileW, w - tx);
        var th = Math.min(tileH, h - ty);

        var tileData = new Float32Array(tw * th * 4);
        for (var row = 0; row < th; row++) {
          var srcOffset = ((ty + row) * w + tx) * 4;
          var dstOffset = row * tw * 4;
          tileData.set(floatData.subarray(srcOffset, srcOffset + tw * 4), dstOffset);
        }

        var tex = createTileTexture();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, tw, th, 0, gl.RGBA, gl.FLOAT, tileData);
        var minFilter = floatLinear ? gl.LINEAR : gl.NEAREST;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

        _tiles.push({ texture: tex, x: tx, y: ty, w: tw, h: th });
      }
    }

    _pixelData = floatData;
  }

  return {
    uploadLDR: uploadLDR,
    uploadHDR: uploadHDR,
    setTransform: function(px, py, s) { _panX = px; _panY = py; _scale = s; },
    setExposure: function(ev) { _exposure = ev; },
    setBgMode: function(mode) { _bgMode = mode; },
    setChannelMode: function(mode) { _channelMode = mode; },
    setIgnoreAlpha: function(v) { _ignoreAlpha = v; },
    getIgnoreAlpha: function() { return _ignoreAlpha; },
    setSrgb: function(v) { _srgb = v; },
    getSrgb: function() { return _srgb; },
    updateThemeColors: function() { updateThemeColors(); },
    render: render,
    resize: resize,
    hasImage: function() { return _hasImage; },
    clearImage: function() { _hasImage = false; _pixelData = null; freeTiles(); },
    getPixel: function(x, y) {
      if (!_pixelData || x < 0 || y < 0 || x >= _imageW || y >= _imageH) return null;
      var idx = (y * _imageW + x) * 4;
      return { r: _pixelData[idx], g: _pixelData[idx+1], b: _pixelData[idx+2], a: _pixelData[idx+3], isHdr: _isHdr };
    }
  };
})();
