/* ============================================================
   网页内实时播放 Spine 骨骼动画（spine-webgl 3.8 运行时）
   - 自己 fetch 骨骼数据与图集文本、自己加载贴图（不走 AssetManager，行为可控）
   - 循环播放 idle / wave，可切换、可暂停
   - 任何一步失败都会回退到视频版，不影响页面其余内容
   ============================================================ */
(function () {
  const canvas = document.getElementById("spine-canvas");
  if (!canvas || !window.spine) return;

  const stage = document.getElementById("spine-stage");
  const buttons = document.querySelectorAll("[data-spine-anim]");
  const pauseBtn = document.getElementById("spine-pause");
  const statusEl = document.getElementById("spine-status");

  const BASE = "assets/spine/";
  const JSON_FILE = "girl-wave.json";
  const ATLAS_FILE = "girl-wave.atlas";

  function mark(step) { if (stage) stage.setAttribute("data-step", step); }
  window.addEventListener("error", function (e) {
    if (stage) stage.setAttribute("data-error", String((e && (e.message || e.error)) || "unknown"));
  });

  function fail(msg) {
    if (stage) { stage.style.display = "none"; stage.classList.add("spine-failed"); }
    const fb = document.getElementById("spine-fallback");
    if (fb) fb.style.display = "block";
    if (statusEl) statusEl.textContent = msg;
    console.warn("[spine]", msg);
  }

  let gl;
  try {
    gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: true })
      || canvas.getContext("experimental-webgl", { alpha: true, premultipliedAlpha: false });
  } catch (e) { gl = null; }
  if (!gl) { fail("当前浏览器不支持 WebGL，已切换为视频版"); return; }

  let renderer, skeleton, state, bounds = null, currentAnim = "idle", paused = false, lastTime = 0, frames = 0;

  function fitCamera() {
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 420;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    // 关键：改了 canvas 尺寸必须同步 GL 视口，否则画面只画在左下角一小块
    gl.viewport(0, 0, canvas.width, canvas.height);
    const b = bounds || { x: 0, y: 0, width: 100, height: 100 };
    renderer.camera.viewportHeight = b.height * 1.06;
    renderer.camera.viewportWidth = renderer.camera.viewportHeight * (w / h);
    renderer.camera.position.x = b.x + b.width / 2;
    renderer.camera.position.y = b.y + b.height / 2;
    renderer.camera.update();
  }

  /** 画一帧（同步） */
  function drawFrame(delta) {
    if (!paused) { state.update(delta); state.apply(skeleton); }
    skeleton.updateWorldTransform();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    renderer.begin();
    renderer.drawSkeleton(skeleton, false);
    renderer.end();
    frames++;
    if (stage && frames % 20 === 0) stage.setAttribute("data-frames", String(frames));
  }

  /** 把刚画完那一帧的实际像素统计写进 DOM（自检/调试用，不影响渲染） */
  function reportFrameStats() {
    try {
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let n = 0, minX = w, minY = h, maxX = -1, maxY = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (px[(y * w + x) * 4 + 3] > 8) {
            n++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (stage) {
        stage.setAttribute("data-pixels", String(n));
        stage.setAttribute("data-pixelbox", n ? [minX, minY, maxX, maxY].join(",") : "none");
        stage.setAttribute("data-buffer", w + "x" + h);
      }
    } catch (e) {
      if (stage) stage.setAttribute("data-pixels", "err:" + e.message);
    }
  }

  function render() {
    requestAnimationFrame(render);
    try {
      const now = performance.now();
      const delta = Math.min((now - lastTime) / 1000, 1 / 20);
      lastTime = now;
      drawFrame(delta);
    } catch (err) {
      if (stage && !stage.getAttribute("data-error")) stage.setAttribute("data-error", "render: " + err.message);
    }
  }

  /** setup 姿势下的包围盒（数据里没写画布范围时用） */
  function computeBounds(sk) {
    try {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      sk.setToSetupPose();
      sk.updateWorldTransform();
      for (let i = 0; i < sk.drawOrder.length; i++) {
        const att = sk.drawOrder[i].attachment;
        if (!att || !att.computeWorldVertices || !att.worldVerticesLength) continue;
        const n = att.worldVerticesLength, verts = new Array(n);
        att.computeWorldVertices(sk.drawOrder[i], 0, n, verts, 0, 2);
        for (let v = 0; v + 1 < n; v += 2) {
          if (verts[v] < minX) minX = verts[v];
          if (verts[v] > maxX) maxX = verts[v];
          if (verts[v + 1] < minY) minY = verts[v + 1];
          if (verts[v + 1] > maxY) maxY = verts[v + 1];
        }
      }
      if (!isFinite(minX) || maxX - minX <= 0) return null;
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    } catch (e) { return null; }
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("图片加载失败 " + url)); };
      img.src = url;
    });
  }

  Promise.all([
    fetch(BASE + JSON_FILE, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("骨骼数据 HTTP " + r.status);
      return r.text();
    }),
    fetch(BASE + ATLAS_FILE, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("图集 HTTP " + r.status);
      return r.text();
    }),
  ]).then(function (res) {
    mark("text-ok");
    const obj = JSON.parse(res[0]);
    // 这个 3.8 运行时构建会拒绝「数据版本 == 运行时版本」的文件（上游校验写法所致）；
    // 3.8.x 数据格式一致，把版本号顺延一位即可，重新导出也不用改文件。
    const rtVersion = (window.spine && window.spine.VERSION) || "3.8.75";
    if (obj.skeleton && obj.skeleton.spine === rtVersion) obj.skeleton.spine = "3.8.80";
    const atlasText = res[1];
    // 图集里的页（png）名字
    const pages = atlasText.split(/\r?\n/).map(function (l) { return l.trim(); })
      .filter(function (l) { return /\.(png|jpg|jpeg|webp)$/i.test(l); });
    return Promise.all(pages.map(function (p) { return loadImage(BASE + p); }))
      .then(function (imgs) {
        mark("images-ok");
        return { obj: obj, atlasText: atlasText, pages: pages, imgs: imgs };
      });
  }).then(function (data) {
    const textures = {};
    data.pages.forEach(function (p, i) { textures[p] = new spine.webgl.GLTexture(gl, data.imgs[i]); });
    let first = true;
    const atlas = new spine.TextureAtlas(data.atlasText, function (path) {
      if (first) { first = false; return textures[path] || textures[data.pages[0]]; }
      return textures[path] || textures[data.pages[0]];
    });
    const atlasLoader = new spine.AtlasAttachmentLoader(atlas);
    const skeletonJson = new spine.SkeletonJson(atlasLoader);
    const skData = skeletonJson.readSkeletonData(data.obj);

    skeleton = new spine.Skeleton(skData);
    state = new spine.AnimationState(new spine.AnimationStateData(skData));
    state.setAnimation(0, currentAnim, true);

    const sk2 = data.obj.skeleton || {};
    bounds = (skData.width && skData.height)
      ? { x: skData.x || 0, y: skData.y || 0, width: skData.width, height: skData.height }
      : (sk2.width && sk2.height
        ? { x: sk2.x || 0, y: sk2.y || 0, width: sk2.width, height: sk2.height }
        : computeBounds(skeleton));

    renderer = new spine.webgl.SceneRenderer(canvas, gl, true);
    renderer.camera.zoom = 1;
    fitCamera();
    window.addEventListener("resize", fitCamera);
    if (statusEl) statusEl.textContent = "";

    if (stage) {
      stage.classList.add("spine-ready");
      stage.setAttribute("data-anims", skData.animations.map(function (a) { return a.name; }).join(","));
      stage.setAttribute("data-bones", String(skData.bones.length));
      stage.setAttribute("data-drawable", String(skeleton.drawOrder.filter(function (s) { return s.attachment != null; }).length));
      stage.setAttribute("data-bounds", bounds ? [bounds.x, bounds.y, bounds.width, bounds.height].join(",") : "none");
    }
    // 先同步画一帧，保证首屏立刻有内容（不依赖 rAF 的首次回调时机）
    try { drawFrame(0); reportFrameStats(); } catch (err) {
      if (stage) stage.setAttribute("data-error", "firstframe: " + err.message);
    }
    requestAnimationFrame(render);
  }).catch(function (e) {
    fail("动画资源加载失败：" + e.message);
  });

  buttons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      const name = btn.getAttribute("data-spine-anim");
      if (!state || name === currentAnim) return;
      currentAnim = name;
      paused = false;
      if (pauseBtn) pauseBtn.textContent = "⏸ 暂停";
      state.setAnimation(0, name, true);
      buttons.forEach(function (b) { b.classList.toggle("active", b === btn); });
    });
  });

  if (pauseBtn) {
    pauseBtn.addEventListener("click", function () {
      paused = !paused;
      pauseBtn.textContent = paused ? "▶ 继续" : "⏸ 暂停";
    });
  }
})();
