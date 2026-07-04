/* 포트폴리오 정리 · 자산 자동 리밸런싱
 * 순수 바닐라 JS. 데이터는 localStorage에만 저장됩니다.
 * 기능: 금액/수량·단가 입력, 손익·수익률, 자산군/종목 기준 리밸런싱,
 *       검색·정렬·자산군 소계·메모, 스크린샷 OCR 인식(베타). */

(() => {
  "use strict";

  const STORAGE_KEY = "portfolio-organizer-v1";
  const DEFAULT_CLASSES = ["국내주식", "해외주식", "채권", "현금", "부동산", "암호화폐", "기타"];
  const PALETTE = [
    "#4f46e5", "#059669", "#f59e0b", "#0ea5e9",
    "#ec4899", "#8b5cf6", "#ef4444", "#14b8a6",
    "#f97316", "#64748b",
  ];

  let state = load();
  let searchText = "";     // 검색어 (저장 안 함)
  let inputMode = "amount"; // 폼 입력방식: amount | qty

  // ---------- 저장/불러오기 ----------
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        return {
          assets: Array.isArray(p.assets) ? p.assets : [],
          targets: p.targets && typeof p.targets === "object" ? p.targets : {},
          theme: p.theme === "dark" ? "dark" : "light",
          sortBy: p.sortBy || "value-desc",
          rebalanceMode: p.rebalanceMode === "item" ? "item" : "class",
        };
      }
    } catch (e) {
      console.warn("저장된 데이터를 불러오지 못했습니다:", e);
    }
    return { assets: [], targets: {}, theme: "light", sortBy: "value-desc", rebalanceMode: "class" };
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
  const won = (n) => "₩" + Math.round(n).toLocaleString("ko-KR");
  const wonSigned = (n) => (n >= 0 ? "+" : "-") + "₩" + Math.round(Math.abs(n)).toLocaleString("ko-KR");
  const pct = (n) => (Math.round(n * 10) / 10).toFixed(1) + "%";
  const pctSigned = (n) => (n >= 0 ? "+" : "-") + Math.abs(Math.round(n * 10) / 10).toFixed(1) + "%";
  const uid = () => "a" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const colorForIndex = (i) => PALETTE[i % PALETTE.length];
  const plOf = (a) => (Number(a.cost) > 0 ? a.value - Number(a.cost) : null);

  function allClasses() {
    const set = new Set();
    state.assets.forEach((a) => set.add(a.class));
    Object.keys(state.targets).forEach((c) => set.add(c));
    if (set.size === 0) DEFAULT_CLASSES.forEach((c) => set.add(c));
    return [...set];
  }
  function classTotals() {
    const map = {};
    state.assets.forEach((a) => (map[a.class] = (map[a.class] || 0) + Number(a.value || 0)));
    return map;
  }
  const grandTotal = () => state.assets.reduce((s, a) => s + Number(a.value || 0), 0);

  function indexClasses() {
    const idx = {};
    allClasses().forEach((c, i) => (idx[c] = i));
    return idx;
  }

  // 리밸런싱 대상 행 (모드에 따라 자산군 또는 종목)
  function rebalanceRows() {
    const classIndex = indexClasses();
    if (state.rebalanceMode === "item") {
      return state.assets
        .slice()
        .sort((a, b) => b.value - a.value)
        .map((a) => ({
          key: a.id,
          isItem: true,
          label: a.name,
          cur: Number(a.value || 0),
          target: Number(a.target || 0),
          color: colorForIndex(classIndex[a.class] ?? 0),
        }));
    }
    const totals = classTotals();
    return allClasses().map((c) => ({
      key: c,
      isItem: false,
      label: c,
      cur: totals[c] || 0,
      target: Number(state.targets[c] || 0),
      color: colorForIndex(classIndex[c] ?? 0),
    }));
  }
  const targetSumOf = (rows) => rows.reduce((s, r) => s + r.target, 0);

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
    $("assetCountSub").textContent =
      `종목 ${state.assets.length}개 · 자산군 ${Object.keys(classTotals()).length}개`;
    $("driftValue").textContent = pct(computeDrift());

    const withCost = state.assets.filter((a) => Number(a.cost) > 0);
    const invested = withCost.reduce((s, a) => s + Number(a.cost), 0);
    const curValue = withCost.reduce((s, a) => s + Number(a.value || 0), 0);
    const plEl = $("plValue"), retEl = $("returnValue"), plSub = $("plSub");
    if (invested > 0) {
      const pl = curValue - invested;
      const ret = (pl / invested) * 100;
      const cls = pl >= 0 ? "pos" : "neg";
      plEl.textContent = wonSigned(pl);
      plEl.className = "stat-value " + cls;
      retEl.textContent = pctSigned(ret);
      retEl.className = "stat-value " + cls;
      plSub.textContent = withCost.length === state.assets.length
        ? `매입 ${won(invested)} 기준` : `${withCost.length}/${state.assets.length}종목 기준`;
    } else {
      plEl.textContent = "—"; plEl.className = "stat-value";
      retEl.textContent = "—"; retEl.className = "stat-value";
      plSub.textContent = "매입금액 입력 시 표시";
    }
  }

  // 목표 이탈도 = Σ|현재비중 - 목표비중| / 2 (활성 모드 기준)
  function computeDrift() {
    const total = grandTotal();
    if (total === 0) return 0;
    const rows = rebalanceRows();
    if (targetSumOf(rows) === 0) return 0;
    let sum = 0;
    rows.forEach((r) => (sum += Math.abs((r.cur / total) * 100 - r.target)));
    return sum / 2;
  }

  function assetRow(a, classIndex, total) {
    const tr = document.createElement("tr");
    const share = total ? (a.value / total) * 100 : 0;
    const color = colorForIndex(classIndex[a.class] ?? 0);
    let sub = "";
    const pl = plOf(a);
    if (pl !== null) {
      const ret = (pl / Number(a.cost)) * 100;
      sub += `<div class="cell-sub ${pl >= 0 ? "pos" : "neg"}">${wonSigned(pl)} (${pctSigned(ret)})</div>`;
    }
    let nameExtra = "";
    if (a.qty && a.price) nameExtra += `<div class="cell-sub dim">${Number(a.qty).toLocaleString("ko-KR")}주 × ${won(a.price)}</div>`;
    if (a.memo) nameExtra += `<div class="cell-sub dim">📝 ${escapeHtml(a.memo)}</div>`;
    tr.innerHTML = `
      <td>${escapeHtml(a.name)}${nameExtra}</td>
      <td><span class="tag"><span class="dot" style="background:${color}"></span>${escapeHtml(a.class)}</span></td>
      <td class="num">${won(a.value)}${sub}</td>
      <td class="num">${pct(share)}</td>
      <td class="num">
        <button class="btn-mini" data-edit="${a.id}">수정</button>
        <button class="btn-mini danger" data-del="${a.id}">삭제</button>
      </td>`;
    return tr;
  }

  function subtotalRow(cls, sum, total) {
    const tr = document.createElement("tr");
    tr.className = "subtotal";
    const share = total ? (sum / total) * 100 : 0;
    tr.innerHTML = `
      <td colspan="2">${escapeHtml(cls)} 소계</td>
      <td class="num">${won(sum)}</td>
      <td class="num">${pct(share)}</td>
      <td></td>`;
    return tr;
  }

  function renderAssetTable() {
    const body = $("assetBody");
    const total = grandTotal();
    const classIndex = indexClasses();
    body.innerHTML = "";

    const q = searchText.trim().toLowerCase();
    let list = state.assets.filter(
      (a) => !q || (a.name + " " + a.class + " " + (a.memo || "")).toLowerCase().includes(q)
    );
    const cmp = {
      "value-desc": (a, b) => b.value - a.value,
      "value-asc": (a, b) => a.value - b.value,
      "name-asc": (a, b) => a.name.localeCompare(b.name, "ko"),
      "class-asc": (a, b) => a.class.localeCompare(b.class, "ko") || b.value - a.value,
      "pl-desc": (a, b) => (plOf(b) ?? -Infinity) - (plOf(a) ?? -Infinity),
    }[state.sortBy] || ((a, b) => b.value - a.value);
    list = list.slice().sort(cmp);

    if (state.sortBy === "class-asc") {
      let cur = null, groupSum = 0;
      const flush = () => { if (cur !== null) body.appendChild(subtotalRow(cur, groupSum, total)); };
      list.forEach((a) => {
        if (a.class !== cur) { flush(); cur = a.class; groupSum = 0; }
        body.appendChild(assetRow(a, classIndex, total));
        groupSum += Number(a.value || 0);
      });
      flush();
    } else {
      list.forEach((a) => body.appendChild(assetRow(a, classIndex, total)));
    }

    const noAssets = state.assets.length === 0;
    const noMatch = !noAssets && list.length === 0;
    const empty = $("emptyAssets");
    empty.style.display = noAssets || noMatch ? "block" : "none";
    empty.textContent = noAssets
      ? '아직 등록된 자산이 없습니다. "자산 추가"로 시작하세요.'
      : noMatch ? "검색 결과가 없습니다." : "";
    $("assetTable").style.display = noAssets || noMatch ? "none" : "";
    $("assetToolbar").hidden = noAssets;
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
    const size = canvas.width, cx = size / 2, cy = size / 2, r = size / 2 - 10, inner = r * 0.6;
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
      const frac = val / total, slice = frac * Math.PI * 2;
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

    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fillStyle = getCss("--surface");
    ctx.fill();
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
    const rows = rebalanceRows();

    $("rbColName").textContent = state.rebalanceMode === "item" ? "종목" : "자산군";
    const hasData = state.assets.length > 0;
    $("emptyRebalance").style.display = hasData ? "none" : "block";
    $("rebalanceTable").style.display = hasData ? "" : "none";

    rows.forEach((row) => {
      const curPct = total ? (row.cur / total) * 100 : 0;
      const tgtValue = (total * row.target) / 100;
      const diff = tgtValue - row.cur;
      const attr = row.isItem ? `data-item="${escapeHtml(row.key)}"` : `data-target="${escapeHtml(row.key)}"`;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="tag"><span class="dot" style="background:${row.color}"></span>${escapeHtml(row.label)}</span></td>
        <td class="num">${pct(curPct)}</td>
        <td class="num">
          <input class="target-input" type="number" min="0" max="100" step="1"
                 ${attr} value="${row.target || ""}" placeholder="0" />
        </td>
        <td class="num">${won(row.cur)}</td>
        <td class="num" data-cell="target-value">${total ? won(tgtValue) : "—"}</td>
        <td class="num" data-cell="adjust">${total ? adjHtml(diff, total) : "—"}</td>`;
      body.appendChild(tr);
    });

    updateTargetSum();
    buildRebalanceSummary();
  }

  function adjHtml(diff, total) {
    if (!total) return "—";
    if (Math.abs(diff) < 1) return `<span class="adj-hold">유지</span>`;
    if (diff > 0) return `<span class="adj-buy">▲ 매수 ${won(diff)}</span>`;
    return `<span class="adj-sell">▼ 매도 ${won(-diff)}</span>`;
  }

  function updateTargetSum() {
    const sum = targetSumOf(rebalanceRows());
    const el = $("targetSum");
    el.textContent = `합계 ${Math.round(sum)}%`;
    el.className = "pill";
    if (sum > 0 && Math.round(sum) === 100) el.classList.add("ok");
    else if (sum > 0) el.classList.add("warn");
  }

  function buildRebalanceSummary() {
    const el = $("rebalanceSummary");
    const total = grandTotal();
    const rows = rebalanceRows();
    const sum = targetSumOf(rows);
    if (!total || sum === 0) { el.innerHTML = ""; return; }

    const sells = [], buys = [];
    rows.forEach((r) => {
      const diff = (total * r.target) / 100 - r.cur;
      if (diff > 1) buys.push(`${escapeHtml(r.label)} ${won(diff)}`);
      else if (diff < -1) sells.push(`${escapeHtml(r.label)} ${won(-diff)}`);
    });
    if (!sells.length && !buys.length) {
      el.innerHTML = "✅ 이미 목표 배분에 맞게 정리되어 있습니다.";
      return;
    }
    const parts = [];
    if (sells.length) parts.push(`<span class="s-sell">▼ 매도</span> ${sells.join(", ")}`);
    if (buys.length) parts.push(`<span class="s-buy">▲ 매수</span> ${buys.join(", ")}`);
    let note = "";
    if (Math.round(sum) !== 100) {
      note = `<br><span class="note">※ 목표 비중 합계가 ${Math.round(sum)}%입니다. 100%로 맞추면 더 정확해요.</span>`;
    }
    el.innerHTML = `<strong>리밸런싱 요약</strong><br>${parts.join("<br>")}${note}`;
  }

  // 목표 입력 시 계산 셀만 부분 갱신 (포커스 유지)
  function updateRebalanceComputations() {
    const total = grandTotal();
    const totals = classTotals();
    $("rebalanceBody").querySelectorAll("tr").forEach((tr) => {
      const input = tr.querySelector(".target-input");
      if (!input) return;
      let cur, target;
      if (input.dataset.item !== undefined) {
        const a = state.assets.find((x) => x.id === input.dataset.item);
        cur = a ? Number(a.value || 0) : 0;
        target = a ? Number(a.target || 0) : 0;
      } else {
        cur = totals[input.dataset.target] || 0;
        target = Number(state.targets[input.dataset.target] || 0);
      }
      const tgtValue = (total * target) / 100;
      const tv = tr.querySelector('[data-cell="target-value"]');
      const adj = tr.querySelector('[data-cell="adjust"]');
      if (tv) tv.textContent = total ? won(tgtValue) : "—";
      if (adj) adj.innerHTML = adjHtml(tgtValue - cur, total);
    });
    updateTargetSum();
    buildRebalanceSummary();
    $("driftValue").textContent = pct(computeDrift());
  }

  // ---------- 입력 폼 ----------
  function setInputMode(mode) {
    inputMode = mode;
    $("inputModeSeg").querySelectorAll(".seg-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.mode === mode));
    document.querySelector(".mode-amount").hidden = mode !== "amount";
    document.querySelector(".mode-qty").hidden = mode !== "qty";
    updateQtyComputed();
  }

  function updateQtyComputed() {
    const qty = Number($("assetQty").value), price = Number($("assetPrice").value);
    const v = qty > 0 && price > 0 ? qty * price : 0;
    $("qtyComputed").textContent = "평가금액 " + (v > 0 ? won(v) : "—");
  }

  function toggleForm(open, asset) {
    const form = $("assetForm");
    form.classList.toggle("open", open);
    if (open) {
      $("assetId").value = asset ? asset.id : "";
      $("assetName").value = asset ? asset.name : "";
      $("assetClass").value = asset ? asset.class : "";
      $("assetMemo").value = asset && asset.memo ? asset.memo : "";
      const useQty = asset && asset.qty && asset.price;
      $("assetValue").value = asset && !useQty ? asset.value : "";
      $("assetCost").value = asset && !useQty && asset.cost ? asset.cost : "";
      $("assetQty").value = useQty ? asset.qty : "";
      $("assetPrice").value = useQty ? asset.price : "";
      $("assetAvg").value = useQty && asset.avgCost ? asset.avgCost : "";
      setInputMode(useQty ? "qty" : "amount");
      $("saveAssetBtn").textContent = asset ? "수정 저장" : "저장";
      $("assetName").focus();
    } else {
      form.reset();
      $("assetId").value = "";
      setInputMode("amount");
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    const id = $("assetId").value;
    const name = $("assetName").value.trim();
    const cls = $("assetClass").value.trim();
    const memo = $("assetMemo").value.trim();
    let value, cost = 0, qty = 0, price = 0, avg = 0;

    if (inputMode === "qty") {
      qty = Number($("assetQty").value);
      price = Number($("assetPrice").value);
      avg = Number($("assetAvg").value);
      value = qty * price;
      cost = avg > 0 ? qty * avg : 0;
    } else {
      value = Number($("assetValue").value);
      cost = Number($("assetCost").value);
    }

    if (!name || !cls) { toast("종목명과 자산군을 입력하세요."); return; }
    if (!(value > 0)) { toast("평가금액(또는 수량×현재가)을 확인하세요."); return; }

    const existing = id ? state.assets.find((x) => x.id === id) : null;
    const asset = { id: existing ? existing.id : uid(), name, class: cls, value };
    if (memo) asset.memo = memo;
    if (cost > 0) asset.cost = cost;
    if (inputMode === "qty") { asset.qty = qty; asset.price = price; if (avg > 0) asset.avgCost = avg; }
    if (existing && existing.target != null) asset.target = existing.target;

    if (existing) {
      state.assets[state.assets.indexOf(existing)] = asset;
      toast("자산을 수정했습니다.");
    } else {
      state.assets.push(asset);
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
    const input = e.target;
    if (!input.classList.contains("target-input")) return;
    let v = Number(input.value);
    if (isNaN(v) || v < 0) v = 0;
    if (v > 100) v = 100;
    if (input.dataset.item !== undefined) {
      const a = state.assets.find((x) => x.id === input.dataset.item);
      if (a) a.target = v;
    } else {
      state.targets[input.dataset.target] = v;
    }
    save();
    updateRebalanceComputations();
  }

  function autoEqualTargets() {
    if (state.rebalanceMode === "item") {
      const list = state.assets;
      if (!list.length) return;
      const each = Math.floor((100 / list.length) * 10) / 10;
      list.forEach((a, i) => (a.target =
        i === list.length - 1 ? Math.round((100 - each * (list.length - 1)) * 10) / 10 : each));
    } else {
      const totals = classTotals();
      const list = allClasses().filter((c) => (totals[c] || 0) > 0);
      const use = list.length ? list : allClasses();
      if (!use.length) return;
      const each = Math.floor((100 / use.length) * 10) / 10;
      state.targets = {};
      use.forEach((c, i) => (state.targets[c] =
        i === use.length - 1 ? Math.round((100 - each * (use.length - 1)) * 10) / 10 : each));
    }
    save();
    render();
    toast("균등 배분으로 목표를 설정했습니다.");
  }

  function resetTargets() {
    if (!confirm("목표 배분을 모두 초기화할까요?")) return;
    if (state.rebalanceMode === "item") state.assets.forEach((a) => delete a.target);
    else state.targets = {};
    save();
    render();
    toast("목표를 초기화했습니다.");
  }

  function setRebalanceMode(mode) {
    state.rebalanceMode = mode;
    $("rebalanceModeSeg").querySelectorAll(".seg-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.rmode === mode));
    save();
    renderSummary();
    renderRebalance();
  }

  // ---------- 스크린샷 OCR (베타) ----------
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error("스크립트 로드 실패"));
      document.head.appendChild(s);
    });
  }
  async function ensureTesseract() {
    if (window.Tesseract) return window.Tesseract;
    await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js");
    return window.Tesseract;
  }

  // 텍스트에서 (종목명, 금액) 후보 추출
  function parseOcr(text) {
    const out = [];
    (text || "").split(/\n/).forEach((line) => {
      const l = line.trim();
      if (!l) return;
      const nums = l.match(/\d[\d,]{2,}/g);
      if (!nums) return;
      const amount = Math.max(...nums.map((n) => Number(n.replace(/,/g, ""))));
      if (amount < 1000) return; // 수량·퍼센트 등 작은 수 제외
      let name = l.replace(/[\d,]+\s*원?/g, " ").replace(/[%()\-+.\[\]]/g, " ").replace(/\s+/g, " ").trim();
      if (name.length < 1) name = "종목";
      out.push({ name, cls: "", value: amount });
    });
    return out;
  }

  function setScanStatus(msg) { $("scanStatus").textContent = msg || ""; }

  async function runOcr(file) {
    $("scanResult").hidden = true;
    setScanStatus("이미지 분석 준비 중… (처음 실행 시 한국어 데이터 다운로드로 시간이 걸릴 수 있어요)");
    try {
      const T = await ensureTesseract();
      const { data } = await T.recognize(file, "kor+eng", {
        logger: (m) => {
          if (m.status === "recognizing text") setScanStatus(`글자 인식 중… ${Math.round(m.progress * 100)}%`);
        },
      });
      const rows = parseOcr(data.text);
      if (!rows.length) {
        setScanStatus("금액으로 보이는 항목을 찾지 못했어요. 직접 입력하거나 다른 캡처를 시도해 주세요.");
        renderScanRows([{ name: "", cls: "", value: "" }]);
      } else {
        setScanStatus(`${rows.length}개 항목을 인식했습니다. 저장 전에 종목명·금액을 확인·수정하세요.`);
        renderScanRows(rows);
      }
    } catch (e) {
      setScanStatus("인식 실패: 인터넷 연결이 필요합니다. (" + e.message + ")");
    }
  }

  function renderScanRows(rows) {
    const body = $("scanBody");
    body.innerHTML = "";
    rows.forEach((r) => body.appendChild(scanEditRow(r)));
    $("scanResult").hidden = false;
  }

  function scanEditRow(r) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" class="scan-chk" checked /></td>
      <td><input class="scan-in scan-name" value="${escapeHtml(r.name || "")}" placeholder="종목명" /></td>
      <td><input class="scan-in scan-cls" list="classList" value="${escapeHtml(r.cls || "")}" placeholder="자산군" /></td>
      <td class="num"><input class="scan-in scan-val num" type="number" inputmode="numeric" value="${r.value || ""}" placeholder="금액" /></td>
      <td><button class="btn-mini danger scan-del">×</button></td>`;
    tr.querySelector(".scan-del").addEventListener("click", () => tr.remove());
    return tr;
  }

  function commitScan() {
    const rows = [...$("scanBody").querySelectorAll("tr")];
    let added = 0;
    rows.forEach((tr) => {
      if (!tr.querySelector(".scan-chk").checked) return;
      const name = tr.querySelector(".scan-name").value.trim();
      const cls = tr.querySelector(".scan-cls").value.trim() || "기타";
      const value = Number(tr.querySelector(".scan-val").value);
      if (!name || !(value > 0)) return;
      const asset = { id: uid(), name, class: cls, value };
      state.assets.push(asset);
      added++;
    });
    if (!added) { toast("등록할 항목이 없습니다. 종목명과 금액을 확인하세요."); return; }
    save();
    render();
    $("scanPanel").hidden = true;
    $("scanResult").hidden = true;
    setScanStatus("");
    toast(`${added}개 항목을 등록했습니다.`);
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
        const d = JSON.parse(reader.result);
        state = {
          assets: Array.isArray(d.assets) ? d.assets : [],
          targets: d.targets && typeof d.targets === "object" ? d.targets : {},
          theme: state.theme,
          sortBy: d.sortBy || state.sortBy,
          rebalanceMode: d.rebalanceMode === "item" ? "item" : "class",
        };
        save();
        syncControls();
        render();
        toast("불러오기 완료.");
      } catch (err) {
        toast("올바른 JSON 파일이 아닙니다.");
      }
    };
    reader.readAsText(file);
  }

  // ---------- 테마 ----------
  function applyTheme() { document.documentElement.setAttribute("data-theme", state.theme); }
  function toggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    save();
    renderChart();
  }

  // ---------- 헬퍼 ----------
  function getCss(v) {
    return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#000";
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }
  let toastTimer;
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function syncControls() {
    $("sortSelect").value = state.sortBy;
    $("rebalanceModeSeg").querySelectorAll(".seg-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.rmode === state.rebalanceMode));
  }

  // ---------- 초기화 ----------
  function init() {
    applyTheme();
    syncControls();
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

    // 입력방식 토글
    $("inputModeSeg").addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn");
      if (btn) setInputMode(btn.dataset.mode);
    });
    $("assetQty").addEventListener("input", updateQtyComputed);
    $("assetPrice").addEventListener("input", updateQtyComputed);

    // 리밸런싱 모드 토글
    $("rebalanceModeSeg").addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn");
      if (btn) setRebalanceMode(btn.dataset.rmode);
    });

    // 검색/정렬
    $("searchInput").addEventListener("input", (e) => { searchText = e.target.value; renderAssetTable(); });
    $("sortSelect").addEventListener("change", (e) => { state.sortBy = e.target.value; save(); renderAssetTable(); });

    // 스크린샷 OCR
    $("scanBtn").addEventListener("click", () => {
      const p = $("scanPanel");
      p.hidden = !p.hidden;
      if (!p.hidden) toggleForm(false);
    });
    $("scanCloseBtn").addEventListener("click", () => { $("scanPanel").hidden = true; });
    $("scanPickBtn").addEventListener("click", () => $("scanFile").click());
    $("scanFile").addEventListener("change", (e) => {
      if (e.target.files[0]) runOcr(e.target.files[0]);
      e.target.value = "";
    });
    $("scanAddRowBtn").addEventListener("click", () => {
      $("scanBody").appendChild(scanEditRow({ name: "", cls: "", value: "" }));
      $("scanResult").hidden = false;
    });
    $("scanSaveBtn").addEventListener("click", commitScan);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
