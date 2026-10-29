// Fig 1 · Plethos: the counts matrix as towers (genes × samples); normalising by size factors levels the depth.
FIGS.push({
  id: 'pl', name: 'Plethos · counts matrix', hint: 'Click a tower · ←→ sample · n normalise',
  aria: 'Isometric bar matrix of bulk RNA-seq counts, genes by samples. Click a tower or use arrow keys to pick a sample; press n to divide by size factors.',
  mount(stage, api) {
    const NS = 7, NG = 6, SX = 34, SY = 30, X0 = 22, Y0 = 22, Z0 = 10;
    const names = ['V1', 'V2', 'V3', 'V4', 'T1', 'T2', 'T3'];
    const sf = [0.7, 1.0, 1.35, 0.85, 1.25, 0.8, 1.1];                    // size factors s_j
    const base = [90, 40, 60, 25, 75, 50];                                // per-gene mean
    const de = [0, 0, 1.8, 0, 0, 0.55];                                   // gene 3 up, gene 6 down in T
    const c = Array.from({ length: NS }, (_, i) => base.map((b, g) => Math.round(b * sf[i] * (i >= 4 ? de[g] || 1 : 1) * (0.9 + ((i * 7 + g * 3) % 5) * 0.05))));
    const W = X0 * 2 + NS * SX, D = Y0 * 2 + NG * SY;
    const K = api.iso.frame([[0, 0, 0], [W, 0, 0], [0, D, 0], [W, D, 0], [0, 0, 150]]);
    const { TOP, FRONT, box, rect } = K;
    const st = { sel: 4, norm: false };
    function svg() {
      let s = box(0, 0, 0, W, D, Z0, 12);
      s += `<g transform="${TOP(0, 0, Z0)}"><rect class="detail" x="8" y="8" width="${W - 16}" height="${D - 16}" rx="8"/></g>`;
      const order = [];
      for (let i = 0; i < NS; i++) for (let g = 0; g < NG; g++) order.push([i, g]);
      order.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
      for (const [i, g] of order) {
        const v = st.norm ? c[i][g] / sf[i] : c[i][g];
        const h = Math.max(3, v * 1.15);
        const on = i === st.sel;
        s += `<g class="press${on ? ' latched' : ''}" data-i="${i}">${box(X0 + i * SX, Y0 + g * SY, Z0, 22, 20, h, 3)}</g>`;
        if (on) s += `<g transform="${TOP(X0 + i * SX, Y0 + g * SY, Z0 + h)}"><rect class="face led hot" filter="url(#soft)" x="3" y="3" width="16" height="14" rx="2"/></g>`;
      }
      for (let i = 0; i < NS; i++)
        s += `<g transform="${FRONT(X0 + i * SX, D, Z0)}"><text class="label${i === st.sel ? ' scr-accent' : ''}" x="11" y="-2" font-size="8" text-anchor="middle">${names[i]}</text></g>`;
      return s;
    }
    function render() {
      stage.setAttribute('viewBox', K.viewBox); stage.innerHTML = svg();
      const tot = c[st.sel].reduce((a, b) => a + b, 0);
      api.readout(`${names[st.sel]} · s=${sf[st.sel].toFixed(2)} · ${st.norm ? 'normalised' : 'raw'} · lib ${tot}`);
      api.power(st.norm);
    }
    stage.addEventListener('click', e => { const g = e.target.closest('[data-i]'); if (g) { st.sel = +g.dataset.i; render(); } });
    render();
    return {
      key: e => {
        if (e.key === 'ArrowRight') { st.sel = (st.sel + 1) % NS; render(); return true; }
        if (e.key === 'ArrowLeft') { st.sel = (st.sel + NS - 1) % NS; render(); return true; }
        if (e.key === 'n' || e.key === ' ') { st.norm = !st.norm; render(); return true; }
        return false;
      },
      demo: () => api.after(600, () => { st.norm = true; render(); }),
    };
  },
});

// Fig 2 · Karyon: droplets carry nuclei down a channel; each one is summed into its animal's pseudobulk tower.
FIGS.push({
  id: 'ka', name: 'Karyon · nuclei to pseudobulk', hint: 'Space runs the stream · r resets',
  aria: 'Isometric microfluidic channel. Droplets each carrying one nucleus flow along it and add to one of eight animal towers, the pseudobulk sums. Space starts or stops, r resets.',
  mount(stage, api) {
    const W = 330, D = 200, Z0 = 10, TX = 26, TS = 36, TY = 26;
    const names = ['V1', 'V2', 'V3', 'V4', 'T1', 'T2', 'T3', 'T4'];
    const K = api.iso.frame([[0, 0, 0], [W, 0, 0], [0, D, 0], [W, D, 0], [0, 0, 140]]);
    const { TOP, FRONT, P, box } = K;
    const st = { run: false, n: Array(8).fill(0), last: -1, drops: [], t0: 0, made: 0 };
    let towers, drops;
    function towersSvg() {
      let s = '';
      for (let i = 0; i < 8; i++) {
        const h = 4 + Math.min(110, st.n[i] * 0.9);
        s += `<g class="press${i === st.last ? ' lit' : ''}">${box(TX + i * TS, TY, Z0, 24, 24, h, 3)}</g>`;
        s += `<g transform="${FRONT(TX + i * TS, TY + 24, Z0)}"><text class="label" x="12" y="-3" font-size="8" text-anchor="middle">${names[i]}</text></g>`;
      }
      return s;
    }
    function base() {
      let s = box(0, 0, 0, W, D, Z0, 12);
      s += `<g transform="${TOP(0, 0, Z0)}"><rect class="detail" x="8" y="8" width="${W - 16}" height="${D - 16}" rx="8"/>`;
      s += `<rect class="face recess" x="20" y="130" width="${W - 40}" height="22" rx="11"/>`;
      s += `<rect class="face recess" x="${W - 40}" y="64" width="16" height="80" rx="8"/></g>`;
      return s;
    }
    stage.setAttribute('viewBox', K.viewBox);
    stage.innerHTML = base() + '<g id="ka-t"></g><g id="ka-d"></g>';
    towers = stage.querySelector('#ka-t'); drops = stage.querySelector('#ka-d');
    function drawTowers() { towers.innerHTML = towersSvg(); }
    function readout() {
      const tot = st.n.reduce((a, b) => a + b, 0);
      api.readout(`${tot} nuclei · 8 animals · test df ≤ 6`);
    }
    function spawn(now) { st.drops.push({ t: now, a: (st.made++ * 5 + 3) % 8 }); }
    api.loop(now => {
      if (st.run && now - st.t0 > 180) { st.t0 = now; spawn(now); }
      let s = '';
      const keep = [];
      for (const d of st.drops) {
        const k = (now - d.t) / 2600;                                    // 0..1 along the channel, then up the return lane
        if (k >= 1) { st.n[d.a]++; st.last = d.a; drawTowers(); readout(); continue; }
        keep.push(d);
        const x = k < 0.8 ? 30 + k / 0.8 * (W - 70) : W - 32, y = k < 0.8 ? 141 : 141 - (k - 0.8) / 0.2 * 70;
        const [px, py] = P(x, y, Z0 + 4);
        s += `<ellipse class="halo hot" filter="url(#bloom)" cx="${px}" cy="${py}" rx="9" ry="5"/>`;
        s += `<ellipse class="glass hot" cx="${px}" cy="${py}" rx="6" ry="3.6"/><circle class="led hot" cx="${px}" cy="${py - 0.5}" r="1.6"/>`;
      }
      st.drops = keep; drops.innerHTML = s;
    });
    drawTowers(); readout();
    const toggle = () => { st.run = !st.run; api.power(st.run); };
    const reset = () => { st.n.fill(0); st.drops = []; st.last = -1; drawTowers(); readout(); };
    stage.addEventListener('click', toggle);
    return {
      key: e => (e.key === ' ' || e.key === 'Enter') ? (toggle(), true) : e.key === 'r' ? (reset(), true) : false,
      demo: () => api.after(200, () => { if (!st.run) toggle(); }),
    };
  },
});
