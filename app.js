"use strict";

// ---------- Boot: load the C++/WASM module, then start the app ----------
const statusEl = document.getElementById('status');
const plotBtn = document.getElementById('plotBtn');

MillerModule().then(function (Module) {
  // Bind the C functions exported from src/miller.cpp
  const _intercepts_to_miller = Module.cwrap(
    'intercepts_to_miller', 'number', ['number', 'number', 'number', 'number', 'number', 'number']
  );
  const _miller_axis_intercept = Module.cwrap('miller_axis_intercept', 'number', ['number']);

  const WASM = {
    // Returns [h,k,l] or null if p=q=r=0
    interceptsToMiller(p, q, r) {
      const hPtr = Module._malloc(4), kPtr = Module._malloc(4), lPtr = Module._malloc(4);
      try {
        const rc = _intercepts_to_miller(p, q, r, hPtr, kPtr, lPtr);
        if (rc !== 0) return null;
        return [
          Module.getValue(hPtr, 'i32'),
          Module.getValue(kPtr, 'i32'),
          Module.getValue(lPtr, 'i32')
        ];
      } finally {
        Module._free(hPtr); Module._free(kPtr); Module._free(lPtr);
      }
    },
    // Returns [x,y,z] intercepts (Infinity where the index is 0)
    millerToIntercepts(h, k, l) {
      const SENTINEL = 1e18;
      const conv = v => { const x = _miller_axis_intercept(v); return x >= SENTINEL ? Infinity : x; };
      return [conv(h), conv(k), conv(l)];
    }
  };

  statusEl.textContent = 'wasm ready';
  statusEl.classList.add('ready');
  plotBtn.disabled = false;

  startApp(WASM);
}).catch(function (err) {
  console.error(err);
  statusEl.textContent = 'wasm failed to load';
  statusEl.classList.add('error');
});

// ---------- Everything below runs once the WASM module is ready ----------
function startApp(WASM) {

  function overline(n) {
    const s = Math.trunc(n);
    return s < 0 ? Math.abs(s) + '\u0305' : String(s);
  }
  function fmtMiller(h, k, l) { return '(' + overline(h) + ' ' + overline(k) + ' ' + overline(l) + ')'; }
  function fmtIntercepts(p, q, r) {
    const f = v => (v === Infinity || v === -Infinity) ? '\u221E' : (Math.round(v * 1000) / 1000);
    return f(p) + ', ' + f(q) + ', ' + f(r);
  }
  function fmtEq(h, k, l) {
    const terms = [];
    const parts = [[h, 'x'], [k, 'y'], [l, 'z']];
    parts.forEach(([coef, sym]) => {
      if (coef === 0) return;
      const sign = terms.length === 0 ? (coef < 0 ? '-' : '') : (coef < 0 ? ' - ' : ' + ');
      const mag = Math.abs(coef);
      const coefStr = mag === 1 ? '' : String(mag);
      terms.push(sign + coefStr + sym);
    });
    if (terms.length === 0) return 'undefined plane';
    return terms.join('') + ' = 1';
  }

  // ---------- three.js scene ----------
  const host = document.getElementById('canvas-host');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const dl = new THREE.DirectionalLight(0xffffff, 0.7);
  dl.position.set(3, 4, 5);
  scene.add(dl);
  const dl2 = new THREE.DirectionalLight(0xffffff, 0.3);
  dl2.position.set(-3, -2, -4);
  scene.add(dl2);

  const cubeGeo = new THREE.BoxGeometry(2, 2, 2);
  const cubeEdges = new THREE.EdgesGeometry(cubeGeo);
  const cubeLines = new THREE.LineSegments(cubeEdges, new THREE.LineBasicMaterial({ color: 0x3A4D59 }));
  scene.add(cubeLines);

  const originDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x7E909A })
  );
  scene.add(originDot);

  const AXIS_LEN = 1.35;
  function makeAxis(dir, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      dir.clone().multiplyScalar(AXIS_LEN)
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: color }));
    scene.add(line);
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.035, 0.09, 12),
      new THREE.MeshBasicMaterial({ color: color })
    );
    tip.position.copy(dir.clone().multiplyScalar(AXIS_LEN));
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    tip.setRotationFromQuaternion(quat);
    scene.add(tip);
  }
  const colA = 0xE15A3C, colB = 0x4FA65B, colC = 0x4C93D8;
  makeAxis(new THREE.Vector3(1, 0, 0), colA);
  makeAxis(new THREE.Vector3(0, 1, 0), colB);
  makeAxis(new THREE.Vector3(0, 0, 1), colC);

  const markerA = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 16), new THREE.MeshBasicMaterial({ color: colA }));
  const markerB = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 16), new THREE.MeshBasicMaterial({ color: colB }));
  const markerC = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 16), new THREE.MeshBasicMaterial({ color: colC }));
  [markerA, markerB, markerC].forEach(m => { m.visible = false; scene.add(m); });

  let planeMesh = null, planeOutline = null;
  const planeMat = new THREE.MeshStandardMaterial({
    color: 0xF2B84B, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    roughness: 0.55, metalness: 0.05, depthWrite: false
  });
  const outlineMat = new THREE.LineBasicMaterial({ color: 0xF2B84B });

  function clipPolygon(poly, normal, offset) {
    const out = [];
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const cur = poly[i], nxt = poly[(i + 1) % n];
      const dCur = cur.dot(normal) - offset;
      const dNxt = nxt.dot(normal) - offset;
      if (dCur <= 1e-9) out.push(cur.clone());
      if ((dCur < -1e-9 && dNxt > 1e-9) || (dCur > 1e-9 && dNxt < -1e-9)) {
        const t = dCur / (dCur - dNxt);
        out.push(cur.clone().lerp(nxt, t));
      }
    }
    return out;
  }

  function buildPlane(h, k, l) {
    const n = new THREE.Vector3(h, k, l);
    if (n.lengthSq() < 1e-12) return null;
    const d = 1;
    const p0 = n.clone().multiplyScalar(d / n.lengthSq());

    let ref = Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(n, ref).normalize();
    const v = new THREE.Vector3().crossVectors(n, u).normalize();

    const BIG = 6;
    let poly = [
      p0.clone().addScaledVector(u, BIG).addScaledVector(v, BIG),
      p0.clone().addScaledVector(u, -BIG).addScaledVector(v, BIG),
      p0.clone().addScaledVector(u, -BIG).addScaledVector(v, -BIG),
      p0.clone().addScaledVector(u, BIG).addScaledVector(v, -BIG)
    ];

    const halfSpaces = [
      [new THREE.Vector3(1, 0, 0), 1], [new THREE.Vector3(-1, 0, 0), 1],
      [new THREE.Vector3(0, 1, 0), 1], [new THREE.Vector3(0, -1, 0), 1],
      [new THREE.Vector3(0, 0, 1), 1], [new THREE.Vector3(0, 0, -1), 1]
    ];
    halfSpaces.forEach(([nrm, off]) => {
      if (poly.length) poly = clipPolygon(poly, nrm, off);
    });

    if (poly.length < 3) return null;
    return poly;
  }

  function updatePlaneGeometry(h, k, l) {
    if (planeMesh) { scene.remove(planeMesh); planeMesh.geometry.dispose(); planeMesh = null; }
    if (planeOutline) { scene.remove(planeOutline); planeOutline.geometry.dispose(); planeOutline = null; }

    const poly = buildPlane(h, k, l);
    if (!poly) return false;

    const centroid = new THREE.Vector3();
    poly.forEach(p => centroid.add(p));
    centroid.divideScalar(poly.length);

    const positions = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      positions.push(centroid.x, centroid.y, centroid.z, a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    planeMesh = new THREE.Mesh(geo, planeMat);
    scene.add(planeMesh);

    const outlinePts = poly.concat([poly[0]]);
    const outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePts);
    planeOutline = new THREE.Line(outlineGeo, outlineMat);
    scene.add(planeOutline);

    return true;
  }

  function placeMarker(mesh, coord, visible) {
    mesh.visible = visible && isFinite(coord) && Math.abs(coord) <= 1.0001;
    if (mesh.visible) {
      if (mesh === markerA) mesh.position.set(coord, 0, 0);
      if (mesh === markerB) mesh.position.set(0, coord, 0);
      if (mesh === markerC) mesh.position.set(0, 0, coord);
    }
  }

  // ---------- camera orbit (manual, no external controls library needed) ----------
  let radius = 4.2, theta = Math.PI * 0.28, phi = Math.PI * 0.36;
  const MIN_R = 2.2, MAX_R = 9;
  function updateCamera() {
    const sinPhi = Math.sin(phi);
    camera.position.set(
      radius * sinPhi * Math.sin(theta),
      radius * Math.cos(phi),
      radius * sinPhi * Math.cos(theta)
    );
    camera.lookAt(0, 0, 0);
  }
  updateCamera();

  let dragging = false, lastX = 0, lastY = 0;
  const dom = renderer.domElement;
  dom.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; dom.setPointerCapture(e.pointerId); });
  dom.addEventListener('pointerup', () => { dragging = false; });
  dom.addEventListener('pointercancel', () => { dragging = false; });
  dom.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    theta -= dx * 0.008;
    phi -= dy * 0.008;
    phi = Math.max(0.12, Math.min(Math.PI - 0.12, phi));
    updateCamera();
  });
  dom.addEventListener('wheel', e => {
    e.preventDefault();
    radius += e.deltaY * 0.0035 * radius;
    radius = Math.max(MIN_R, Math.min(MAX_R, radius));
    updateCamera();
  }, { passive: false });

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  const labelA = document.getElementById('labelA');
  const labelB = document.getElementById('labelB');
  const labelC = document.getElementById('labelC');
  function project(vec, el) {
    const p = vec.clone().project(camera);
    const w = host.clientWidth, h = host.clientHeight;
    const x = (p.x * 0.5 + 0.5) * w;
    const y = (-p.y * 0.5 + 0.5) * h;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
    project(new THREE.Vector3(AXIS_LEN + 0.12, 0, 0), labelA);
    project(new THREE.Vector3(0, AXIS_LEN + 0.12, 0), labelB);
    project(new THREE.Vector3(0, 0, AXIS_LEN + 0.12), labelC);
  }

  // ---------- UI wiring ----------
  const tabMiller = document.getElementById('tabMiller');
  const tabIntercept = document.getElementById('tabIntercept');
  const millerFields = document.getElementById('millerFields');
  const interceptFields = document.getElementById('interceptFields');
  const msg = document.getElementById('msg');
  const outMiller = document.getElementById('outMiller');
  const outIntercepts = document.getElementById('outIntercepts');
  const outEq = document.getElementById('outEq');

  let mode = 'miller';
  tabMiller.addEventListener('click', () => {
    mode = 'miller'; tabMiller.classList.add('active'); tabIntercept.classList.remove('active');
    millerFields.style.display = ''; interceptFields.style.display = 'none';
  });
  tabIntercept.addEventListener('click', () => {
    mode = 'intercept'; tabIntercept.classList.add('active'); tabMiller.classList.remove('active');
    interceptFields.style.display = ''; millerFields.style.display = 'none';
  });

  const signs = { h: 1, k: 1, l: 1, p: 1, q: 1, r: 1 };
  document.querySelectorAll('.sign-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.target;
      signs[id] *= -1;
      const neg = signs[id] === -1;
      btn.textContent = neg ? '\u2212' : '+';
      btn.classList.toggle('neg', neg);
    });
  });

  ['h', 'k', 'l', 'p', 'q', 'r'].forEach(id => {
    document.getElementById(id).addEventListener('input', e => {
      e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });
  });

  function intInput(id) {
    const raw = document.getElementById(id).value.trim();
    if (raw === '') return 0;
    const n = parseInt(raw, 10);
    const mag = isNaN(n) ? 0 : n;
    return mag * (signs[id] || 1);
  }

  function plot() {
    msg.textContent = '';
    let h, k, l;

    if (mode === 'miller') {
      h = intInput('h'); k = intInput('k'); l = intInput('l');
      if (h === 0 && k === 0 && l === 0) {
        msg.textContent = 'Enter at least one non-zero Miller index.';
        return;
      }
    } else {
      const p = intInput('p'), q = intInput('q'), r = intInput('r');
      const res = WASM.interceptsToMiller(p, q, r); // <-- computed in C++/WASM
      if (!res) {
        msg.textContent = 'Enter at least one non-zero intercept.';
        return;
      }
      [h, k, l] = res;
    }

    const ok = updatePlaneGeometry(h, k, l);
    if (!ok) {
      msg.textContent = 'That plane does not cross the unit cell shown — try smaller indices.';
      return;
    }

    const [ip, iq, ir] = WASM.millerToIntercepts(h, k, l); // <-- computed in C++/WASM
    placeMarker(markerA, ip, h !== 0);
    placeMarker(markerB, iq, k !== 0);
    placeMarker(markerC, ir, l !== 0);

    outMiller.textContent = fmtMiller(h, k, l);
    outIntercepts.textContent = fmtIntercepts(ip, iq, ir);
    outEq.textContent = fmtEq(h, k, l);
  }

  plotBtn.addEventListener('click', plot);
  ['h', 'k', 'l', 'p', 'q', 'r'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') plot(); });
  });

  requestAnimationFrame(() => { resize(); plot(); animate(); });
}
