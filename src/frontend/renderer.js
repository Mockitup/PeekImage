var Renderer = (function() {
  var canvas = document.getElementById('canvas');
  var gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false });
  if (!gl) { console.error('WebGL2 not supported'); return null; }

  // Enable float textures
  var floatExt = gl.getExtension('EXT_color_buffer_float');
  var floatLinear = gl.getExtension('OES_texture_float_linear');

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
    'uniform vec3 u_checkerA;',
    'uniform vec3 u_checkerB;',
    '',
    'vec3 checkerboard(vec2 pos) {',
    '  float size = 10.0;',
    '  vec2 cell = floor(pos / size);',
    '  float check = mod(cell.x + cell.y, 2.0);',
    '  return mix(u_checkerA, u_checkerB, check);',
    '}',
    '',
    'void main() {',
    '  vec2 imgPos = (v_screenPos - u_transform.xy) / u_transform.z;',
    '  vec2 uv = imgPos / u_imageSize;',
    '',
    '  vec3 bg;',
    '  if (u_bgMode == 1) bg = vec3(0.0);',
    '  else if (u_bgMode == 2) bg = vec3(0.863, 0.878, 0.910);',
    '  else bg = checkerboard(v_screenPos);',
    '',
    '  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {',
    '    fragColor = vec4(bg, 1.0);',
    '    return;',
    '  }',
    '',
    '  vec4 texel = texture(u_texture, uv);',
    '  vec3 color = texel.rgb;',
    '  float a = texel.a;',
    '  if (u_channelMode == 1) { color = vec3(color.r); a = 1.0; }',
    '  else if (u_channelMode == 2) { color = vec3(color.g); a = 1.0; }',
    '  else if (u_channelMode == 3) { color = vec3(color.b); a = 1.0; }',
    '  else if (u_channelMode == 4) { color = vec3(a); a = 1.0; }',
    '  else if (u_channelMode == 5) { color = vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))); a = 1.0; }',
    '  if (u_isHdr) {',
    '    color = color * exp2(u_exposure);',
    '    color = clamp(color, 0.0, 1.0);',
    '  }',
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
  var u_checkerA = gl.getUniformLocation(program, 'u_checkerA');
  var u_checkerB = gl.getUniformLocation(program, 'u_checkerB');

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

  // Texture
  var texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  // State
  var _hasImage = false;
  var _isHdr = false;
  var _imageW = 0, _imageH = 0;
  var _panX = 0, _panY = 0, _scale = 1;
  var _exposure = 0;
  var _bgMode = 0;
  var _channelMode = 0;
  var _pixelData = null;

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

  function render() {
    if (!_hasImage) return;
    var dpr = window.devicePixelRatio || 1;
    resize();

    gl.uniform2f(u_resolution, canvas.width, canvas.height);
    gl.uniform2f(u_imageSize, _imageW, _imageH);
    gl.uniform3f(u_transform, _panX * dpr, _panY * dpr, _scale);
    gl.uniform1f(u_exposure, _exposure);
    gl.uniform1i(u_isHdr, _isHdr ? 1 : 0);
    gl.uniform1i(u_bgMode, _bgMode);
    gl.uniform1i(u_channelMode, _channelMode);
    gl.uniform3f(u_checkerA, _checkerA[0], _checkerA[1], _checkerA[2]);
    gl.uniform3f(u_checkerB, _checkerB[0], _checkerB[1], _checkerB[2]);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(u_texture, 0);

    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function uploadLDR(htmlImage) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, htmlImage);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    _imageW = htmlImage.naturalWidth || htmlImage.width;
    _imageH = htmlImage.naturalHeight || htmlImage.height;
    _isHdr = false;
    _hasImage = true;
    _exposure = 0;
    // Extract pixel data via offscreen canvas
    var oc = document.createElement('canvas');
    oc.width = _imageW;
    oc.height = _imageH;
    var ctx = oc.getContext('2d');
    ctx.drawImage(htmlImage, 0, 0);
    _pixelData = ctx.getImageData(0, 0, _imageW, _imageH).data;
  }

  function uploadHDR(arrayBuffer, w, h) {
    var floatData = new Float32Array(arrayBuffer);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, floatData);
    var minFilter = floatLinear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    _imageW = w;
    _imageH = h;
    _isHdr = true;
    _hasImage = true;
    _exposure = 0;
    _pixelData = floatData;
  }

  return {
    uploadLDR: uploadLDR,
    uploadHDR: uploadHDR,
    setTransform: function(px, py, s) { _panX = px; _panY = py; _scale = s; },
    setExposure: function(ev) { _exposure = ev; },
    setBgMode: function(mode) { _bgMode = mode; },
    setChannelMode: function(mode) { _channelMode = mode; },
    updateThemeColors: function() { updateThemeColors(); },
    render: render,
    resize: resize,
    hasImage: function() { return _hasImage; },
    clearImage: function() { _hasImage = false; _pixelData = null; },
    getPixel: function(x, y) {
      if (!_pixelData || x < 0 || y < 0 || x >= _imageW || y >= _imageH) return null;
      var idx = (y * _imageW + x) * 4;
      return { r: _pixelData[idx], g: _pixelData[idx+1], b: _pixelData[idx+2], a: _pixelData[idx+3], isHdr: _isHdr };
    }
  };
})();
