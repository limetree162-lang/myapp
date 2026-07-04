/* 포트폴리오 정리 · 자산 자동 리밸런싱
 * 순수 바닐라 JS. 데이터는 localStorage에만 저장됩니다. */

(() => {
  "use strict";

  const STORAGE_KEY = "portfolio-organizer-v1";
  const DEFAULT_CLASSES = ["국내주식", "해외주식", "채권", "현금", "부동산", "암호화폐", "기타"];
  const PALETTE = [
    "#4f46e5", "#059669", "#f59e0b", "#0ea5e9",
    "#ec4899", "#8b5cf6", "#ef4444", "#14b8a6",
    "#f97316", "#64748b",
  ];

  /** @type {{assets: Array, targets: Object, theme: string}} */
  let state = load();

  // ---------- 저장/불러오기 ----------
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          assets: Array.isArray(parsed.assets) ? parsed.assets : [],
          targets: parsed.targets && typeof parsed.targets === "object" ? parsed.targets : {},
          theme: parsed.theme === "dark" ? "dark" : "light",
        };
      }
    } catch (e) {
      console.warn("저장된 데이터를 불러오지 못했습니다:", e);
    }
    return { assets: [], targets: {}, theme: "light" };
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast("저장에 실패했습니다.");
    }
  }

  // ---------- 유틸 ----------
  const $ = (id) => document.getElementById(id);
  const won = (n) =>
    "₩" + Math.round(n).toLocaleString("ko-KR");
  const pct = (n) => (Math.round(n * 10) / 10).toFixed(1) + "%";
  const uid = () =>
    "a" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

  function colorForIndex(i) {
    return PALETTE[i % PALETTE.length];
  }

  // 자산군 목록 (등록된 것 + 목표에 있는 것 + 기본값)
  function allClasses() {
    const set = new Set();
    state.assets.forEach((a) => set.add(a.class));
    Object.keys(state.targets).forEach((c) => set.add(c));
    if (set.size === 0) DEFAULT_CLASSES.forEach((c) => set.add(c));
    return [...set];
  }

  // 자산군별 현재 금액 집계
  function classTotals() {
    const map = {};
    state.assets.forEach((a) => {
      map[a.class] = (map[a.class] || 0) + Number(a.value || 0);
    });
    return map;
  }

  const grandTotal = () =>
    state.assets.reduce((s, a) => s + Number(a.value || 0), 0);

  // ---------- 렌더 ----------
  function render() {
    renderSummary();
    renderAssetTable();
    renderClassDatalist();
    renderChart();
    renderRebalance();
  }

  function renderSummary() {
    const total = grandTotal();
    $("totalValue").textContent = won(total);
    $("assetCount").textContent = String(state.assets.length);
    const totals = classTotals();
    $("classCount").textContent = String(Object.keys(totals).length);
    $("driftValue").textContent = pct(computeDrift());
  }

  // 목표 이탈도 = 각 자산군 (현재비중-목표비중) 절대값 합 / 2
  function computeDrift() {
    const total = grandTotal();
    if (total === 0) return 0;
    const totals = classTotals();
    const classes = new Set([...Object.keys(totals), ...Object.keys(state.targets)]);
    let sum = 0;
    classes.forEach((c) => {
      const cur = ((totals[c] || 0) / total) * 100;
      const tgt = Number(state.targets[c] || 0);
      sum += Math.abs(cur - tgt);
    });
    return sum / 2;
  }

  function renderAssetTable() {
    const body = $("assetBody");
    const total = grandTotal();
    body.innerHTML = "";
    const classIndex = indexClasses();

    state.assets
      .slice()
      .sort((a, b) => b.value - a.value)
      .forEach((a) => {
        const tr = document.createElement("tr");
        const share = total ? (a.value / total) * 100 : 0;
        const color = colorForIndex(classIndex[a.class] ?? 0);
        tr.innerHTML = `
          <td>${escapeHtml(a.name)}</td>
          <td><span class="tag"><span class="dot" style="background:${color}"></span>${escapeHtml(a.class)}</span></td>
          <td class="num">${won(a.value)}</td>
          <td class="num">${pct(share)}</td>
          <td class="num">
            <button class="btn-mini" data-edit="${a.id}">수정</button>
            <button class="btn-mini danger" data-del="${a.id}">삭제</button>
          </td>`;
        body.appendChild(tr);
      });

    $("emptyAssets").style.display = state.assets.length ? "none" : "block";
    $("assetTable").style.display = state.assets.length ? "" : "none";
  }

  function indexClasses() {
    const idx = {};
    allClasses().forEach((c, i) => (idx[c] = i));
    return idx;
  }

  function renderClassDatalist() {
    const dl = $("classList");
    dl.innerHTML = "";
    allClasses().forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      dl.appendChild(opt);
    });
  }

  function renderChart() {
    const canvas = $("donut");
    const ctx = canvas.getContext("2d");
    const size = canvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 10;
    const inner = r * 0.6;
    ctx.clearRect(0, 0, size, size);

    const totals = classTotals();
    const total = grandTotal();
    const legend = $("legend");
    legend.innerHTML = "";

    if (total === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
      ctx.fillStyle = getCss("--surface-2");
      ctx.fill();
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "자산을 등록하면 배분이 표시됩니다.";
      legend.appendChild(li);
      return;
    }

    const classIndex = indexClasses();
    const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    let angle = -Math.PI / 2;

    entries.forEach(([cls, val]) => {
      const frac = val / total;
      const slice = frac * Math.PI * 2;
      const color = colorForIndex(classIndex[cls] ?? 0);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, angle, angle + slice);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      angle += slice;

      const li = document.createElement("li");
      li.innerHTML = `
        <span class="l-left"><span class="dot" style="background:${color}"></span>${escapeHtml(cls)}</span>
        <span class="l-pct">${pct(frac * 100)} · ${won(val)}</span>`;
      legend.appendChild(li);
    });

    // 도넛 구멍
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fillStyle = getCss("--surface");
    ctx.fill();

    // 중앙 총액
    ctx.fillStyle = getCss("--text");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "600 15px -apple-system, 'Noto Sans KR', sans-serif";
    ctx.fillText("총 자산", cx, cy - 12);
    ctx.font = "700 16px -apple-system, 'Noto Sans KR', sans-serif";
    ctx.fillText(won(total), cx, cy + 10);
  }

  function renderRebalance() {
    const body = $("rebalanceBody");
    body.innerHTML = "";
    const total = grandTotal();
    const totals = classTotals();
    const classes = allClasses();
    const classIndex = indexClasses();

    const hasData = state.assets.length > 0;
    $("emptyRebalance").style.display = hasData ? "none" : "block";
    $("rebalanceTable").style.display = hasData ? "" : "none";

    let targetSum = 0;

    classes.forEach((cls) => {
      const cur = totals[cls] || 0;
      const curPct = total ? (cur / total) * 100 : 0;
      const tgt = Number(state.targets[cls] || 0);
      targetSum += tgt;
      const tgtValue = (total * tgt) / 100;
      const diff = tgtValue - cur;
      const color = colorForIndex(classIndex[cls] ?? 0);

      let adjHtml;
      if (Math.abs(diff) < 1) {
        adjHtml = `<span class="adj-hold">유지</span>`;
      } else if (diff > 0) {
        adjHtml = `<span class="adj-buy">▲ 매수 ${won(diff)}</span>`;
      } else {
        adjHtml = `<span class="adj-sell">▼ 매도 ${won(-diff)}</span>`;
      }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="tag"><span class="dot" style="background:${color}"></span>${escapeHtml(cls)}</span></td>
        <td class="num">${pct(curPct)}</td>
        <td class="num">
          <input class="target-input" type="number" min="0" max="100" step="1"
                 data-target="${escapeHtml(cls)}" value="${tgt || ""}" placeholder="0" />
        </td>
        <td class="num">${won(cur)}</td>
        <td class="num" data-cell="target-value">${total ? won(tgtValue) : "—"}</td>
        <td class="num" data-cell="adjust">${total ? adjHtml : "—"}</td>`;
      body.appendChild(tr);
    });

    updateTargetSum();
  }

  function updateTargetSum() {
    const targetSum = allClasses().reduce(
      (s, c) => s + Number(state.targets[c] || 0),
      0
    );
    const sumEl = $("targetSum");
    sumEl.textContent = `합계 ${Math.round(targetSum)}%`;
    sumEl.className = "pill";
    if (targetSum > 0 && Math.round(targetSum) === 100) sumEl.classList.add("ok");
    else if (targetSum > 0) sumEl.classList.add("warn");
  }

  // 목표 % 입력 시: 입력창을 다시 만들지 않고 계산 셀만 갱신 (포커스 유지)
  function updateRebalanceComputations() {
    const total = grandTotal();
    const totals = classTotals();
    $("rebalanceBody").querySelectorAll("tr").forEach((tr) => {
      const input = tr.querySelector(".target-input");
      if (!input) return;
      const cls = input.getAttribute("data-target");
      const cur = totals[cls] || 0;
      const tgt = Number(state.targets[cls] || 0);
      const tgtValue = (total * tgt) / 100;
      const diff = tgtValue - cur;

      const tvCell = tr.querySelector('[data-cell="target-value"]');
      const adjCell = tr.querySelector('[data-cell="adjust"]');
      if (tvCell) tvCell.textContent = total ? won(tgtValue) : "—";
      if (adjCell) {
        if (!total) adjCell.textContent = "—";
        else if (Math.abs(diff) < 1) adjCell.innerHTML = `<span class="adj-hold">유지</span>`;
        else if (diff > 0) adjCell.innerHTML = `<span class="adj-buy">▲ 매수 ${won(diff)}</span>`;
        else adjCell.innerHTML = `<span class="adj-sell">▼ 매도 ${won(-diff)}</span>`;
      }
    });
    updateTargetSum();
  }

  // ---------- 이벤트 ----------
  function toggleForm(open, asset) {
    const form = $("assetForm");
    form.classList.toggle("open", open);
    if (open) {
      $("assetId").value = asset ? asset.id : "";
      $("assetName").value = asset ? asset.name : "";
      $("assetClass").value = asset ? asset.class : "";
      $("assetValue").value = asset ? asset.value : "";
      $("assetName").focus();
      $("saveAssetBtn").textContent = asset ? "수정 저장" : "저장";
    } else {
      form.reset();
      $("assetId").value = "";
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    const id = $("assetId").value;
    const name = $("assetName").value.trim();
    const cls = $("assetClass").value.trim();
    const value = Number($("assetValue").value);
    if (!name || !cls || !(value >= 0)) return;

    if (id) {
      const a = state.assets.find((x) => x.id === id);
      if (a) Object.assign(a, { name, class: cls, value });
      toast("자산을 수정했습니다.");
    } else {
      state.assets.push({ id: uid(), name, class: cls, value });
      toast("자산을 추가했습니다.");
    }
    save();
    toggleForm(false);
    render();
  }

  function handleTableClick(e) {
    const editId = e.target.getAttribute("data-edit");
    const delId = e.target.getAttribute("data-del");
    if (editId) {
      const a = state.assets.find((x) => x.id === editId);
      if (a) toggleForm(true, a);
    } else if (delId) {
      const a = state.assets.find((x) => x.id === delId);
      if (a && confirm(`"${a.name}"을(를) 삭제할까요?`)) {
        state.assets = state.assets.filter((x) => x.id !== delId);
        save();
        render();
        toast("삭제했습니다.");
      }
    }
  }

  function handleTargetInput(e) {
    const cls = e.target.getAttribute("data-target");
    if (!cls) return;
    let v = Number(e.target.value);
    if (isNaN(v) || v < 0) v = 0;
    if (v > 100) v = 100;
    state.targets[cls] = v;
    save();
    renderSummary();
    // 입력창을 재생성하지 않도록 계산 셀만 부분 갱신 (포커스/커서 유지)
    updateRebalanceComputations();
  }

  function autoEqualTargets() {
    const classes = allClasses().filter((c) => (classTotals()[c] || 0) > 0);
    const list = classes.length ? classes : allClasses();
    if (!list.length) return;
    const each = Math.floor((100 / list.length) * 10) / 10;
    state.targets = {};
    list.forEach((c, i) => {
      // 마지막 항목에 잔여를 몰아 합계 100 맞춤
      state.targets[c] =
        i === list.length - 1
          ? Math.round((100 - each * (list.length - 1)) * 10) / 10
          : each;
    });
    save();
    render();
    toast("균등 배분으로 목표를 설정했습니다.");
  }

  function resetTargets() {
    if (!Object.keys(state.targets).length) return;
    if (confirm("목표 배분을 모두 초기화할까요?")) {
      state.targets = {};
      save();
      render();
      toast("목표를 초기화했습니다.");
    }
  }

  // ---------- 내보내기/불러오기 ----------
  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "portfolio.json";
    a.click();
    URL.revokeObjectURL(url);
    toast("portfolio.json으로 내보냈습니다.");
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        state = {
          assets: Array.isArray(data.assets) ? data.assets : [],
          targets: data.targets && typeof data.targets === "object" ? data.targets : {},
          theme: state.theme,
        };
        save();
        render();
        toast("불러오기 완료.");
      } catch (err) {
        toast("올바른 JSON 파일이 아닙니다.");
      }
    };
    reader.readAsText(file);
  }

  // ---------- 테마 ----------
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.theme);
  }
  function toggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    save();
    renderChart(); // 캔버스 색상 갱신
  }

  // ---------- 헬퍼 ----------
  function getCss(varName) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || "#000";
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
    );
  }
  let toastTimer;
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  // ---------- 초기화 ----------
  function init() {
    applyTheme();
    render();

    $("addAssetBtn").addEventListener("click", () => toggleForm(true));
    $("cancelAssetBtn").addEventListener("click", () => toggleForm(false));
    $("assetForm").addEventListener("submit", handleSubmit);
    $("assetBody").addEventListener("click", handleTableClick);
    $("rebalanceBody").addEventListener("input", handleTargetInput);
    $("autoTargetBtn").addEventListener("click", autoEqualTargets);
    $("resetTargetBtn").addEventListener("click", resetTargets);
    $("themeBtn").addEventListener("click", toggleTheme);
    $("exportBtn").addEventListener("click", exportJson);
    $("importBtn").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", (e) => {
      if (e.target.files[0]) importJson(e.target.files[0]);
      e.target.value = "";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
