import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';

// Ten horizontal cylindrical ribbons; theta=0 is the fixed front playhead (+Z).
const TAU = Math.PI * 2;
const RADIUS = 2.15;
const GAP = 0.68;
const BAND_HEIGHT = 0.23;
const PLAYHEAD_GLOW_ANGLE = 0.22; // ~0.47 world units on either side of the fixed playhead.
const colorFor = loop => loop.isDrone ? '#00c896' : '#ff8a00';

export function createStage(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor('#242426');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', '十层独立循环环带，拖动旋转视角，滚轮缩放');
  renderer.domElement.setAttribute('role', 'img');
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-6, 6, 6, -6, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x656575, 2.1));
  const light = new THREE.DirectionalLight(0xffeddb, 2.3);
  light.position.set(-4, 7, 8);
  scene.add(light);
  const group = new THREE.Group();
  scene.add(group);
  let ribbons = [], yaw = 0, pitch = 0.24, zoom = 1, disposed = false;
  let height = 8, frame = 0, clock = null;
  const cornerRadius = { value: 0 };
  const abort = new AbortController();
  const on = (target, name, fn, options = {}) => target.addEventListener(name, fn, { ...options, signal: abort.signal });

  function positionCamera() {
    camera.position.set(18 * Math.sin(yaw) * Math.cos(pitch), 18 * Math.sin(pitch), 18 * Math.cos(yaw) * Math.cos(pitch));
    camera.lookAt(0, 0, 0);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
  }
  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    const aspect = w / Math.max(h, 1);
    const half = Math.max(height / 2 + 1.1, (RADIUS + 0.75) / aspect);
    camera.left = -half * aspect; camera.right = half * aspect;
    // Narrow screens reserve space for the two stacked HUD panels.
    const offset = w <= 700 && h > w ? 1 : 0;
    camera.top = half + offset; camera.bottom = -half + offset;
    positionCamera();
    renderer.setSize(w, h);
    draw();
  }
  function clear() {
    group.traverse(object => {
      object.geometry?.dispose();
      if (object.material) {
        object.material.map?.dispose();
        object.material.dispose();
      }
    });
    group.clear();
    ribbons = [];
  }
  function setLoops(loops) {
    clear();
    height = (loops.length - 1) * GAP + BAND_HEIGHT;
    loops.forEach((loop, i) => {
      const y = ((loops.length - 1) / 2 - i) * GAP;
      const span = TAU * loop.duration / loop.period;
      // Geometry runs from tail (-span) to head (0), so +rotation advances the head.
      const geometry = new THREE.CylinderGeometry(RADIUS, RADIUS, BAND_HEIGHT, 128, 1, true, -span, span);
      const material = new THREE.MeshStandardMaterial({ color: colorFor(loop), side: THREE.DoubleSide, roughness: 0.76, metalness: 0, emissive: colorFor(loop), emissiveIntensity: 0.06 });
      // The light belongs to the fixed playhead in WORLD space, never to the
      // moving head or a note-on envelope. Each passing fragment lights locally.
      const glow = { value: 0 };
      material.onBeforeCompile = shader => {
        shader.uniforms.playheadGlow = glow;
        shader.uniforms.ribbonBaseColor = { value: new THREE.Color(colorFor(loop)) };
        shader.uniforms.ribbonCornerRadius = cornerRadius;
        shader.uniforms.ribbonSize = { value: new THREE.Vector2(RADIUS * span, BAND_HEIGHT) };
        shader.vertexShader = 'varying vec3 ribbonWorldPosition;\nvarying vec2 ribbonUv;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\nribbonWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nribbonUv = uv;');
        shader.fragmentShader = 'varying vec3 ribbonWorldPosition;\nvarying vec2 ribbonUv;\nuniform vec3 ribbonBaseColor;\nuniform float ribbonCornerRadius;\nuniform vec2 ribbonSize;\nuniform float playheadGlow;\n' + shader.fragmentShader;
        // Rounded rectangle in the band's unwrapped surface coordinates: its
        // centreline/endpoints stay fixed, so duration and playhead timing do too.
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
          #include <map_fragment>
          // Text is printed on the outer/front face only; keep the back opaque.
          if (!gl_FrontFacing) diffuseColor.rgb = ribbonBaseColor;
          if (ribbonCornerRadius > 0.0) {
            vec2 q = abs((ribbonUv - 0.5) * ribbonSize) - ribbonSize * 0.5 + ribbonCornerRadius;
            float distanceToEdge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - ribbonCornerRadius;
            if (distanceToEdge > 0.0) discard;
          }
        `);
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
          vec3 unprintedEmissive = totalEmissiveRadiance * ribbonBaseColor;
          #include <emissivemap_fragment>
          if (!gl_FrontFacing) totalEmissiveRadiance = unprintedEmissive;
          float playheadAngle = abs(atan(ribbonWorldPosition.x, ribbonWorldPosition.z));
          float localGlow = 1.0 - smoothstep(0.0, ${PLAYHEAD_GLOW_ANGLE.toFixed(4)}, playheadAngle);
          totalEmissiveRadiance += mix(diffuseColor.rgb, vec3(1.0), 0.35) * localGlow * playheadGlow;
        `);
      };
      material.customProgramCacheKey = () => 'fixed-playhead-front-print-v3';
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = y;
      group.add(mesh);
      // Quiet full-circle tracks retain the period reference without forming solid walls.
      // Draw only the silent part: a full coplanar circle causes z-fighting through the ribbon.
      const points = Array.from({ length: 129 }, (_, n) => {
        const angle = n / 128 * (TAU - span);
        return new THREE.Vector3(RADIUS * Math.sin(angle), y, RADIUS * Math.cos(angle));
      });
      const track = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x343438 }));
      group.add(track);
      // Paint the note directly into the ribbon's UV texture. A Sprite always faces
      // the camera and floats off the surface; the band's own UVs bend and occlude it.
      const canvas = document.createElement('canvas');
      canvas.height = 128;
      canvas.width = Math.min(4096, Math.ceil(RADIUS * span / BAND_HEIGHT * canvas.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = colorFor(loop);
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = '500 72px monospace';
      ctx.fillStyle = '#fafafa';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      // Cylinder U increases from tail to head; leave a small margin before U=1.
      const inset = 0.08 / (RADIUS * span) * canvas.width;
      ctx.fillText(loop.note, canvas.width - inset, canvas.height / 2);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      material.color.set('#ffffff');
      material.map = texture;
      material.emissive.set('#ffffff');
      material.emissiveMap = texture;
      material.needsUpdate = true;
      ribbons.push({ loop, mesh, track, glow });
    });
    const guide = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -height / 2 - 0.25, RADIUS - 0.025),
      new THREE.Vector3(0, height / 2 + 0.25, RADIUS - 0.025),
    ]), new THREE.LineBasicMaterial({ color: 0x747479 }));
    group.add(guide);
    resize();
    update(0);
  }
  function update(seconds) {
    ribbons.forEach(({ loop, mesh, track, glow }) => {
      // Modulo stays continuous across Draw's next-fire update (exactly one revolution).
      const turn = ((seconds - loop.visibleFireAt) / loop.period) % 1;
      mesh.rotation.y = turn * TAU;
      track.rotation.y = mesh.rotation.y;
      const age = seconds - (loop.lastVisualFireAt ?? -Infinity);
      glow.value = clock ? 1.25 : 0;
      document.getElementById('loop-' + loop.index)?.classList.toggle('active', !!clock && age >= 0 && age < loop.duration);
    });
    draw();
  }
  function draw() { if (!disposed) renderer.render(scene, camera); }
  function tick() {
    if (!clock || disposed) return;
    update(clock());
    frame = requestAnimationFrame(tick);
  }
  function start(readClock) {
    cancelAnimationFrame(frame);
    clock = readClock;
    tick();
  }
  function stop() {
    clock = null;
    cancelAnimationFrame(frame);
    ribbons.forEach(({ glow, loop }) => {
      glow.value = 0;
      document.getElementById('loop-' + loop.index)?.classList.remove('active');
    });
    draw();
  }
  let gesture = null;
  on(host, 'pointerdown', event => {
    if (event.button !== 0) return;
    if (gesture) { gesture.moved = true; return; }
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw, pitch, moved: false };
    host.setPointerCapture(event.pointerId);
  });
  on(host, 'pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (Math.hypot(dx, dy) > 5) gesture.moved = true;
    if (!gesture.moved) return;
    yaw = gesture.yaw - dx * 0.006;
    pitch = THREE.MathUtils.clamp(gesture.pitch + dy * 0.004, -0.55, 0.85);
    positionCamera(); draw();
  });
  on(host, 'pointerup', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (!gesture.moved) document.body.classList.toggle('hud-hidden');
    gesture = null;
    host.releasePointerCapture(event.pointerId);
  });
  on(host, 'pointercancel', () => { gesture = null; });
  on(host, 'wheel', event => {
    event.preventDefault();
    zoom = THREE.MathUtils.clamp(zoom * Math.exp(-event.deltaY * 0.001), 0.65, 2.1);
    positionCamera(); draw();
  }, { passive: false });
  on(window, 'resize', resize);
  on(document, 'fullscreenchange', resize);
  on(window, 'keydown', event => {
    if (event.composedPath().some(node => /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.isContentEditable)) return;
    if (event.key.toLowerCase() === 'r') { yaw = 0; pitch = 0.24; zoom = 1; positionCamera(); draw(); }
    if (event.key.toLowerCase() === 'f') {
      const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      request.catch(() => {});
    }
  });
  on(renderer.domElement, 'webglcontextlost', event => {
    event.preventDefault(); stop();
    document.getElementById('status').textContent = '3D 显示连接中断，请刷新页面。';
  });
  function setRoundness(percent) {
    const value = Number(percent);
    if (!Number.isFinite(value)) return;
    cornerRadius.value = THREE.MathUtils.clamp(value, 0, 100) / 100 * BAND_HEIGHT / 2;
    draw();
  }
  function dispose() {
    stop(); disposed = true; abort.abort(); clear(); renderer.dispose(); renderer.domElement.remove();
  }
  return { setLoops, update, start, stop, setRoundness, dispose };
}
