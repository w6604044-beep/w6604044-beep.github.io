/* ============================================================
   作品集 v0.1 —— 交互脚本
   职责：1) 滚动入场动画  2) 自动读取 assets/videos 生成作品卡片
   ============================================================ */

// ---------- 1. 滚动入场 ----------
const revealEls = document.querySelectorAll(".reveal");

if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target); // 只播一次
        }
      });
    },
    { threshold: 0.12 }
  );
  revealEls.forEach((el) => io.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add("in"));
}

// ---------- 2. 作品卡片 ----------
// GitHub Pages 无法列目录，所以这里维护一份「作品清单」。
// 你每做好一个动画：把 MP4 放进 assets/videos/，
// 并在下方 WORKS 数组加一行（标题 + 文件相对路径），卡片即自动生成。
const WORKS = [
  // 示例：{ title: "角色待机-行走循环", file: "assets/videos/demo-loop.mp4" }
];

const grid = document.getElementById("work-grid");

function renderWorks() {
  if (!grid) return;

  if (WORKS.length === 0) {
    grid.innerHTML = `
      <div class="work-empty">
        🎬 动画展示区等待第一位「演员」进场…<br><br>
        把导出的 <strong>MP4</strong> 放进 <code>assets/videos/</code>，
        然后在 <code>js/main.js</code> 的 <code>WORKS</code> 数组里登记一行即可。
      </div>`;
    return;
  }

  grid.innerHTML = "";
  WORKS.forEach((w) => {
    const card = document.createElement("div");
    card.className = "work-card reveal in";
    card.innerHTML = `
      <video src="${w.file}" muted loop playsinline autoplay></video>
      <div style="position:absolute;left:0;right:0;bottom:0;padding:26px 14px 10px;
                 background:linear-gradient(transparent, rgba(0,0,0,.75));font-size:14px;">${w.title}</div>`;
    grid.appendChild(card);
  });
}

renderWorks();

// ---------- 3. 页脚年份 ----------
const yr = document.querySelector("footer p");
if (yr) {
  const m = yr.textContent.match(/\d{4}/);
  if (m) yr.textContent = yr.textContent.replace(m[0], new Date().getFullYear());
}

console.log("✅ 作品集网站 v0.1 已加载 —— 干得漂亮，魏子瑶！");
