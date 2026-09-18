/* ============================================================
   网页内实时播放 Spine 骨骼动画（spine-webgl 3.8 运行时）

   每个带 data-spine 的块独立初始化一个播放器，块内自带
   canvas / 动作按钮 / 暂停 / 状态文字 / 降级提示：
     data-base   资源目录（默认 assets/spine/）
     data-json   骨骼数据文件名
     data-atlas  图集文件名
     data-default 默认动作（默认 idle）
     data-once   只播一次的动作，逗号分隔（如 cast）

   - 自己 fetch 骨骼数据与图集文本、自己加载贴图（不走 AssetManager，行为可控）
   - 任何一步失败都只影响本块，并回退到视频版
   ============================================================ */
(function () {
  if (!window.spine) return;

  function initViewer(root) {
    if (root.getAttribute("data-spine-ready")) return;
    root.setAttribute("data-spine-ready", "1");

    const canvas = root.querySelector("canvas");
    if (!canvas) return;

    const stage = root.querySelector(".spine-stage");
    const buttons = root.querySelectorAll("[data-spine-anim]");
    const pauseBtn = root.querySelector("[data-spine-pause]");
    const statusEl = root.querySelector(".spine-status");
    const fbEl = root.querySelector(".spine-fallback");

    const BASE = root.getAttribute("data-base") || "assets/spine/";
    const JSON_FILE = root.getAttribute("data-json");
    const ATLAS_FILE = root.getAttribute("data-atlas");
    const DEFAULT_ANIM = root.getAttribute("data-default") || "idle";
    const ONCE = (root.getAttribute("data-once") || "")
      .split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    // 取景余量：特效比角色更宽扁；老包（2.1 转换）的姿势会超出数据里的画布尺寸，用 data-pad 指定
    const PAD_ATTR = parseFloat(root.getAttribute("data-pad"));
    const PAD = isFinite(PAD_ATTR) && PAD_ATTR > 0 ? PAD_ATTR : (/fx|aura/.test(BASE) ? 1.16 : 1.06);
    // 素材若是预乘 alpha（如从老引擎包里解出来的图），混合方式必须跟着改，否则边缘发黑
    const PMA = root.getAttribute("data-pma") === "1";
    // 取景框（数据坐标 x,y,w,h）。老包的数据里画布框相对人物是偏的，用它显式指定，免得人物贴边被裁
    const BOUNDS_RAW = (root.getAttribute("data-bounds") || "").split(",").map(parseFloat);
    const BOUNDS = BOUNDS_RAW.length === 4 && BOUNDS_RAW.every(function (v) { return isFinite(v); })
      ? { x: BOUNDS_RAW[0], y: BOUNDS_RAW[1], width: BOUNDS_RAW[2], height: BOUNDS_RAW[3] }
      : null;
    if (!JSON_FILE || !ATLAS_FILE) return;

    function mark(step) { if (stage) stage.setAttribute("data-step", step); }
    window.addEventListener("error", function (e) {
      if (stage && !stage.getAttribute("data-error")) {
        stage.setAttribute("data-error", String((e && (e.message || e.error)) || "unknown"));
      }
    });

    function fail(msg) {
      if (stage) { stage.style.display = "none"; stage.classList.add("spine-failed"); }
      if (fbEl) fbEl.style.display = "block";
      if (statusEl) statusEl.textContent = msg;
      console.warn("[spine]", BASE, msg);
    }

    let gl;
    try {
      gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: true })
        || canvas.getContext("experimental-webgl", { alpha: true, premultipliedAlpha: false });
    } catch (e) { gl = null; }
    if (!gl) { fail("当前浏览器不支持 WebGL，已切换为视频版"); return; }

    let renderer, skeleton, state, bounds = null;
    let currentAnim = DEFAULT_ANIM, paused = false, lastTime = 0, frames = 0;

    function fitCamera() {
      const w = canvas.clientWidth || 320;
      const h = canvas.clientHeight || 420;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      // 关键：改了 canvas 尺寸必须同步 GL 视口，否则画面只画在左下角一小块
      gl.viewport(0, 0, canvas.width, canvas.height);
      const b = bounds || { x: 0, y: 0, width: 100, height: 100 };
      renderer.camera.viewportHeight = b.height * PAD;
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
      renderer.drawSkeleton(skeleton, PMA);
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

    /** setup 姿势下的包围盒（数据里没写画布范围时用）。
     *  注意 3.8 运行时里两种附件的取顶点方式不同：
     *    mesh  : computeWorldVertices(slot, start, count, out, offset, stride)，靠 worldVerticesLength 取长度
     *    region: computeWorldVertices(bone, out, offset, stride)，固定 8 个数，且【没有】worldVerticesLength
     *  只判断 worldVerticesLength 会把纯 region 的骨架（比如纯特效）全部跳过，边界变成 null。 */
    function computeBounds(sk) {
      try {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        sk.setToSetupPose();
        sk.updateWorldTransform();
        for (let i = 0; i < sk.drawOrder.length; i++) {
          const slot = sk.drawOrder[i];
          const att = slot.attachment;
          if (!att || !att.computeWorldVertices) continue;
          let n, verts;
          if (att.worldVerticesLength) {
            n = att.worldVerticesLength;
            verts = new Array(n);
            att.computeWorldVertices(slot, 0, n, verts, 0, 2);
          } else {
            n = 8;
            verts = new Array(n);
            att.computeWorldVertices(slot.bone, verts, 0, 2);
          }
          for (let v = 0; v + 1 < n; v += 2) {
            if (verts[v] < minX) minX = verts[v];
            if (verts[v] > maxX) maxX = verts[v];
            if (verts[v + 1] < minY) minY = verts[v + 1];
            if (verts[v + 1] > maxY) maxY = verts[v + 1];
          }
        }
        if (!isFinite(minX) || maxX - minX <= 0) return null;
        // 动画会把部件甩到 setup 姿势之外（施法爆发尤其明显），留出余量免得贴边被裁
        const padX = (maxX - minX) * 0.25, padY = (maxY - minY) * 0.45;
        return {
          x: minX - padX, y: minY - padY,
          width: (maxX - minX) + padX * 2, height: (maxY - minY) + padY * 2,
        };
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

    function play(name) {
      if (!state || name === currentAnim) return;
      currentAnim = name;
      paused = false;
      if (pauseBtn) pauseBtn.textContent = "⏸ 暂停";
      // 一次性动作播完回到默认循环，否则留在最后一帧不动
      const once = ONCE.indexOf(name) >= 0;
      const entry = state.setAnimation(0, name, !once);
      if (once) entry.next = state.addAnimation(0, DEFAULT_ANIM, true, 0);
      buttons.forEach(function (b) { b.classList.toggle("active", b === root.querySelector('[data-spine-anim="' + name + '"]')); });
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
      const def = skData.findAnimation(DEFAULT_ANIM) ? DEFAULT_ANIM : skData.animations[0].name;
      currentAnim = def;
      state.setAnimation(0, def, true);

      const sk2 = data.obj.skeleton || {};
      bounds = BOUNDS || ((skData.width && skData.height)
        ? { x: skData.x || 0, y: skData.y || 0, width: skData.width, height: skData.height }
        : (sk2.width && sk2.height
          ? { x: sk2.x || 0, y: sk2.y || 0, width: sk2.width, height: sk2.height }
          : computeBounds(skeleton)));

      renderer = new spine.webgl.SceneRenderer(canvas, gl, true);
      renderer.camera.zoom = 1;
      fitCamera();
      window.addEventListener("resize", fitCamera);
      if (statusEl) statusEl.textContent = "";

      if (stage) {
        stage.classList.add("spine-ready");
        stage.setAttribute("data-anims", skData.animations.map(function (a) { return a.name; }).join(","));
        stage.setAttribute("data-bones", String(skData.bones.length));
        stage.setAttribute("data-slots", String(skData.slots.length));
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
        play(btn.getAttribute("data-spine-anim"));
      });
    });

    if (pauseBtn) {
      pauseBtn.addEventListener("click", function () {
        paused = !paused;
        pauseBtn.textContent = paused ? "▶ 继续" : "⏸ 暂停";
      });
    }
  }

  const blocks = document.querySelectorAll("[data-spine]");
  for (let i = 0; i < blocks.length; i++) initViewer(blocks[i]);
})();
