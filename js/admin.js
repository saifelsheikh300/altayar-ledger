let adminProfile = null;
let drivers = [];
let txTypes = [];
let balancesByDriver = {};
let selectedDriverId = null;
let currentDriverTxs = [];
let editingTxId = null;
let txDirection = "debit"; // debit = عليه (+), credit = له (-)

async function init() {
  adminProfile = await guardPage("admin");
  if (!adminProfile) return;

  await Promise.all([loadTypes(), loadDrivers(), loadRequests()]);
  setupTabs();
  setupTxSheet();
  document.getElementById("logoutBtn").addEventListener("click", logoutUser);

  const searchInput = document.getElementById("driverSearch");
  if (searchInput) searchInput.addEventListener("input", renderDrivers);

  document.getElementById("printStatementBtn").addEventListener("click", () => {
    const driver = drivers.find((d) => d.id === selectedDriverId);
    if (!driver) return;
    openStatementPrint(driver.full_name, balancesByDriver[selectedDriverId] || 0, currentDriverTxs);
  });
}

// ---------------------------------------------------------
// Tabs
// ---------------------------------------------------------
function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`panel-${tab.dataset.tab}`).classList.add("active");
    });
  });
}

// ---------------------------------------------------------
// Drivers + balances
// ---------------------------------------------------------
async function loadDrivers() {
  const { data: profiles } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("role", "driver")
    .order("full_name");

  const { data: allTx } = await supabaseClient
    .from("transactions")
    .select("driver_id, amount");

  balancesByDriver = {};
  (allTx || []).forEach((t) => {
    balancesByDriver[t.driver_id] = (balancesByDriver[t.driver_id] || 0) + Number(t.amount);
  });

  drivers = profiles || [];
  renderDrivers();
  renderManageDrivers();
  renderStats();
}

function renderManageDrivers() {
  const wrap = document.getElementById("manageDriversList");
  if (!wrap) return;
  if (!drivers.length) {
    wrap.innerHTML = `<div style="color:var(--text-faint); font-size:13px;">لسه مفيش مناديب</div>`;
    return;
  }
  wrap.innerHTML = drivers.map((d) => `
    <div style="display:flex; align-items:center; justify-content:space-between; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:12px 14px; margin-bottom:8px; gap:10px;">
      <div style="min-width:0;">
        <div style="font-weight:700; font-size:14px;">${escapeHtml(d.full_name)}</div>
        <div style="color:var(--text-faint); font-size:12px; margin-top:2px;">${d.phone || "بدون رقم"}</div>
      </div>
      <div style="display:flex; gap:6px; flex-shrink:0;">
        <button class="btn btn-ghost btn-sm" onclick="editDriver('${d.id}', '${escapeHtml(d.full_name).replace(/'/g, "\\'")}', '${d.phone ? d.phone.replace(/'/g, "\\'") : ""}')">تعديل</button>
        <button class="btn btn-debit btn-sm" onclick="confirmDeleteDriver('${d.id}', '${escapeHtml(d.full_name).replace(/'/g, "\\'")}')">حذف</button>
      </div>
    </div>
  `).join("");
}

async function editDriver(driverId, currentName, currentPhone) {
  const newName = window.prompt("اسم المندوب:", currentName);
  if (newName === null) return;
  const newPhone = window.prompt("رقم التليفون (سيبه فاضي لو مفيش):", currentPhone || "");
  if (newPhone === null) return;

  const { error } = await supabaseClient
    .from("profiles")
    .update({ full_name: newName.trim() || currentName, phone: newPhone.trim() || null })
    .eq("id", driverId);

  if (error) {
    showToast("حصل خطأ، حاول تاني", "error");
    return;
  }
  showToast("تم تعديل بيانات المندوب ✓");
  await loadDrivers();
}

async function confirmDeleteDriver(driverId, driverName) {
  const sure = window.confirm(`متأكد إنك عايز تحذف "${driverName}"؟\nهيتمسح حسابه وكل سجل حركاته وطلبات التسوية بتاعته نهائيًا، مفيش رجوع.`);
  if (!sure) return;

  const { data, error } = await supabaseClient.functions.invoke("delete-driver", {
    body: { driver_id: driverId },
  });

  if (error || (data && data.error)) {
    let msg = data && data.error ? data.error : "حصل خطأ، حاول تاني";
    if (error && error.context && typeof error.context.json === "function") {
      try {
        const body = await error.context.json();
        if (body && body.error) msg = body.error;
      } catch (_) { /* تجاهل */ }
    }
    showToast(msg, "error");
    return;
  }

  showToast("تم حذف المندوب ✓");
  await loadDrivers();
}

function renderStats() {
  let totalDebit = 0, totalCredit = 0;
  Object.values(balancesByDriver).forEach((b) => {
    if (b > 0) totalDebit += b; else totalCredit += Math.abs(b);
  });
  document.getElementById("statDebit").textContent = formatMoney(totalDebit);
  document.getElementById("statCredit").textContent = formatMoney(totalCredit);
}

function renderDrivers() {
  const wrap = document.getElementById("driversList");
  const searchInput = document.getElementById("driverSearch");
  const term = (searchInput && searchInput.value || "").trim().toLowerCase();

  const filtered = term
    ? drivers.filter((d) =>
        d.full_name.toLowerCase().includes(term) || (d.phone || "").includes(term)
      )
    : drivers;

  if (!drivers.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="emoji">🏍️</div>لسه مفيش مناديب مضافين<br>ضيفهم من تاب الإعدادات</div>`;
    return;
  }
  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="emoji">🔍</div>مفيش نتايج تطابق البحث</div>`;
    return;
  }
  wrap.innerHTML = filtered.map((d, i) => {
    const bal = balancesByDriver[d.id] || 0;
    const cls = bal > 0.009 ? "debit" : bal < -0.009 ? "credit" : "zero";
    const color = cls === "debit" ? "var(--debit)" : cls === "credit" ? "var(--credit)" : "var(--text-dim)";
    const label = cls === "debit" ? "عليه" : cls === "credit" ? "له" : "متزود";
    return `
      <div class="driver-card" style="animation-delay:${i * 30}ms" onclick="openDriverSheet('${d.id}')">
        <div>
          <div class="name">${escapeHtml(d.full_name)}</div>
          <div class="sub">${d.phone || "بدون رقم"}</div>
        </div>
        <div style="text-align:left;">
          <div class="amt mono" style="color:${color}">${formatMoney(Math.abs(bal))} ج</div>
          <div class="sub" style="color:${color}">${label}</div>
        </div>
      </div>`;
  }).join("");
}

// ---------------------------------------------------------
// Driver detail sheet
// ---------------------------------------------------------
const driverSheetBackdrop = document.getElementById("driverSheetBackdrop");

async function openDriverSheet(driverId) {
  selectedDriverId = driverId;
  const driver = drivers.find((d) => d.id === driverId);
  document.getElementById("driverSheetName").textContent = driver.full_name;

  const bal = balancesByDriver[driverId] || 0;
  const cls = bal > 0.009 ? "debit" : bal < -0.009 ? "credit" : "zero";
  const balEl = document.getElementById("driverSheetBalance");
  balEl.className = `balance-amount amount ${cls}`;
  balEl.textContent = formatMoney(Math.abs(bal));

  document.getElementById("driverSheetTimeline").innerHTML = `<div class="skel" style="height:50px;"></div>`;
  driverSheetBackdrop.classList.add("open");

  const { data: txs } = await supabaseClient
    .from("transactions")
    .select("*, transaction_types(name)")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false })
    .limit(20);

  renderDriverTimeline(txs || []);
  renderTrendChart(txs || []);
}

function renderTrendChart(txs) {
  const el = document.getElementById("driverTrendChart");
  if (!el) return;

  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push({ date: d, net: 0 });
  }

  txs.forEach((t) => {
    const d = new Date(t.created_at);
    d.setHours(0, 0, 0, 0);
    const match = days.find((day) => day.date.getTime() === d.getTime());
    if (match) match.net += Number(t.amount);
  });

  const maxAbs = Math.max(1, ...days.map((d) => Math.abs(d.net)));

  el.innerHTML = days.map((d) => {
    const h = Math.max(3, Math.round((Math.abs(d.net) / maxAbs) * 60));
    const color = d.net > 0.009 ? "var(--debit)" : d.net < -0.009 ? "var(--credit)" : "var(--border)";
    const label = d.date.toLocaleDateString("ar-EG", { day: "numeric", month: "numeric" });
    return `<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:4px;" title="${label}: ${formatMoney(d.net)}">
      <div style="width:100%; max-width:14px; height:${h}px; background:${color}; border-radius:4px 4px 0 0;"></div>
    </div>`;
  }).join("");
}

function renderDriverTimeline(txs) {
  currentDriverTxs = txs;
  const wrap = document.getElementById("driverSheetTimeline");
  if (!txs.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="emoji">🧾</div>مفيش حركات لسه</div>`;
    return;
  }
  wrap.innerHTML = txs.map((t) => {
    const isDebit = Number(t.amount) > 0;
    const cls = isDebit ? "debit" : "credit";
    const typeName = t.transaction_types ? t.transaction_types.name : "عملية";
    return `
      <div class="t-row" style="cursor:pointer;" onclick="openEditTx('${t.id}')">
        <div class="t-dot ${cls}">${isDebit ? "↑" : "↓"}</div>
        <div class="t-body">
          <div class="t-top">
            <span class="t-type">${typeName}</span>
            <span class="t-amount amount ${cls}">${isDebit ? "" : "-"}${formatMoney(Math.abs(t.amount))} ج</span>
          </div>
          <div class="t-meta">${formatDate(t.created_at)}</div>
          ${t.note ? `<div class="t-note">${escapeHtml(t.note)}</div>` : ""}
        </div>
      </div>`;
  }).join("");
}

driverSheetBackdrop.addEventListener("click", (e) => {
  if (e.target === driverSheetBackdrop) driverSheetBackdrop.classList.remove("open");
});

// ---------------------------------------------------------
// Add transaction sheet
// ---------------------------------------------------------
const txSheetBackdrop = document.getElementById("txSheetBackdrop");

function setupTxSheet() {
  document.getElementById("addTxBtn").addEventListener("click", () => {
    editingTxId = null;
    document.getElementById("txSheetTitle").textContent = "إضافة عملية";
    document.getElementById("deleteTxBtn").style.display = "none";
    document.getElementById("txAmount").value = "";
    document.getElementById("txNote").value = "";
    setDirection("debit");
    if (txTypes[0]) document.getElementById("txType").value = txTypes[0].id;
    txSheetBackdrop.classList.add("open");
  });
  document.getElementById("cancelTxBtn").addEventListener("click", () => txSheetBackdrop.classList.remove("open"));
  txSheetBackdrop.addEventListener("click", (e) => { if (e.target === txSheetBackdrop) txSheetBackdrop.classList.remove("open"); });

  document.querySelectorAll(".segmented .seg").forEach((seg) => {
    seg.addEventListener("click", () => setDirection(seg.dataset.dir));
  });

  document.getElementById("submitTxBtn").addEventListener("click", submitTransaction);
  document.getElementById("deleteTxBtn").addEventListener("click", deleteTransaction);
}

function setDirection(dir) {
  txDirection = dir;
  document.querySelectorAll(".segmented .seg").forEach((s) => s.classList.toggle("active", s.dataset.dir === dir));
}

function openEditTx(txId) {
  const tx = currentDriverTxs.find((t) => t.id === txId);
  if (!tx) return;
  editingTxId = txId;
  document.getElementById("txSheetTitle").textContent = "تعديل العملية";
  document.getElementById("deleteTxBtn").style.display = "block";
  setDirection(Number(tx.amount) > 0 ? "debit" : "credit");
  document.getElementById("txAmount").value = Math.abs(tx.amount);
  document.getElementById("txNote").value = tx.note || "";
  if (tx.type_id) document.getElementById("txType").value = tx.type_id;
  txSheetBackdrop.classList.add("open");
}

async function submitTransaction() {
  const amountRaw = parseFloat(document.getElementById("txAmount").value);
  const typeId = document.getElementById("txType").value;
  const note = document.getElementById("txNote").value.trim();

  if (!amountRaw || amountRaw <= 0) {
    showToast("اكتب مبلغ صحيح", "error");
    return;
  }
  const amount = txDirection === "debit" ? amountRaw : -amountRaw;

  const btn = document.getElementById("submitTxBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="dots-loader"><span></span><span></span><span></span><span></span></span>';

  let error;
  if (editingTxId) {
    ({ error } = await supabaseClient
      .from("transactions")
      .update({ type_id: typeId || null, amount, note: note || null })
      .eq("id", editingTxId));
  } else {
    ({ error } = await supabaseClient.from("transactions").insert({
      driver_id: selectedDriverId,
      type_id: typeId || null,
      amount,
      note: note || null,
      created_by: adminProfile.id,
    }));
  }

  btn.disabled = false;
  btn.textContent = "حفظ العملية";

  if (error) {
    showToast("حصل خطأ، حاول تاني", "error");
    return;
  }

  showToast(editingTxId ? "تم تعديل العملية ✓" : "تمت إضافة العملية ✓");
  txSheetBackdrop.classList.remove("open");
  await loadDrivers();
  await openDriverSheet(selectedDriverId);
}

async function deleteTransaction() {
  if (!editingTxId) return;
  const sure = window.confirm("متأكد إنك عايز تحذف العملية دي نهائيًا؟");
  if (!sure) return;

  const { error } = await supabaseClient.from("transactions").delete().eq("id", editingTxId);
  if (error) {
    showToast("حصل خطأ، حاول تاني", "error");
    return;
  }
  showToast("تم حذف العملية ✓");
  txSheetBackdrop.classList.remove("open");
  await loadDrivers();
  await openDriverSheet(selectedDriverId);
}

// ---------------------------------------------------------
// Transaction types
// ---------------------------------------------------------
async function loadTypes() {
  const { data } = await supabaseClient.from("transaction_types").select("*").order("name");
  txTypes = data || [];
  renderTypesUI();
}

function renderTypesUI() {
  const listEl = document.getElementById("typesList");
  listEl.innerHTML = txTypes.length ? txTypes.map((t) => `
    <div style="display:flex; align-items:center; gap:10px; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:10px 12px; margin-bottom:8px;">
      <span style="width:10px; height:10px; border-radius:50%; background:${t.color || "var(--brand)"}; flex-shrink:0;"></span>
      <span style="flex:1; font-size:14px; font-weight:600;">${escapeHtml(t.name)}</span>
      <button class="btn btn-ghost btn-sm" onclick="editType('${t.id}', '${escapeHtml(t.name).replace(/'/g, "\\'")}')">تعديل</button>
      <button class="btn btn-debit btn-sm" onclick="deleteType('${t.id}', '${escapeHtml(t.name).replace(/'/g, "\\'")}')">حذف</button>
    </div>
  `).join("") : `<span style="color:var(--text-faint); font-size:13px;">مفيش أنواع لسه</span>`;

  const select = document.getElementById("txType");
  if (select) {
    select.innerHTML = txTypes.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
  }
}

async function editType(typeId, currentName) {
  const newName = window.prompt("اسم النوع الجديد:", currentName);
  if (!newName || !newName.trim() || newName.trim() === currentName) return;

  const { error } = await supabaseClient
    .from("transaction_types")
    .update({ name: newName.trim() })
    .eq("id", typeId);

  if (error) {
    showToast("حصل خطأ، ممكن يكون فيه نوع بنفس الاسم", "error");
    return;
  }
  showToast("تم التعديل ✓");
  await loadTypes();
}

async function deleteType(typeId, typeName) {
  const sure = window.confirm(`متأكد إنك عايز تحذف نوع "${typeName}"؟\nالعمليات القديمة اللي مسجلة بالنوع ده هتفضل موجودة بس من غير تصنيف.`);
  if (!sure) return;

  const { error } = await supabaseClient.from("transaction_types").delete().eq("id", typeId);
  if (error) {
    showToast("حصل خطأ، حاول تاني", "error");
    return;
  }
  showToast("تم حذف النوع ✓");
  await loadTypes();
}

const COLOR_PALETTE = [
  "#E63946", "#2A9D8F", "#457B9D", "#8E44AD", "#06D6A0", "#EF476F",
  "#118AB2", "#C77DFF", "#3A86FF", "#43AA8B", "#F72585", "#4CC9F0",
];

function nextAvailableColor() {
  const used = new Set(txTypes.map((t) => (t.color || "").toLowerCase()));
  const free = COLOR_PALETTE.find((c) => !used.has(c.toLowerCase()));
  if (free) return free;
  // كل الألوان الجاهزة اتاخدت، نولّد لون عشوائي مختلف بوضوح عن الموجود
  let color, tries = 0;
  do {
    const hue = Math.floor(Math.random() * 360);
    color = `hsl(${hue}, 70%, 55%)`;
    tries++;
  } while (used.has(color.toLowerCase()) && tries < 20);
  return color;
}

document.getElementById("addTypeBtn").addEventListener("click", async () => {
  const input = document.getElementById("newTypeName");
  const name = input.value.trim();
  if (!name) return;
  const { error } = await supabaseClient.from("transaction_types").insert({ name, color: nextAvailableColor() });
  if (error) {
    showToast("النوع ده موجود بالفعل أو حصل خطأ", "error");
    return;
  }
  input.value = "";
  showToast("تمت إضافة النوع ✓");
  await loadTypes();
});

// ---------------------------------------------------------
// Add driver
// ---------------------------------------------------------
document.getElementById("addDriverBtn").addEventListener("click", async () => {
  const name = document.getElementById("newDriverName").value.trim();
  const email = document.getElementById("newDriverEmail").value.trim();
  const password = document.getElementById("newDriverPassword").value;
  const phone = document.getElementById("newDriverPhone").value.trim();

  if (!name || !email || !password) {
    showToast("لازم تدخل الاسم والإيميل والباسورد", "error");
    return;
  }

  const btn = document.getElementById("addDriverBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="dots-loader"><span></span><span></span><span></span><span></span></span>';

  const { data, error } = await supabaseClient.functions.invoke("create-driver", {
    body: { email, password, full_name: name, phone: phone || null },
  });

  btn.disabled = false;
  btn.textContent = "إضافة المندوب";

  if (error || (data && data.error)) {
    let msg = data && data.error ? data.error : "حصل خطأ، حاول تاني";
    if (error && error.context && typeof error.context.json === "function") {
      try {
        const body = await error.context.json();
        if (body && body.error) msg = body.error;
      } catch (_) { /* تجاهل لو مش JSON */ }
    }
    showToast(msg, "error");
    return;
  }

  document.getElementById("newDriverName").value = "";
  document.getElementById("newDriverEmail").value = "";
  document.getElementById("newDriverPassword").value = "";
  document.getElementById("newDriverPhone").value = "";
  showToast("تمت إضافة المندوب ✓");
  await loadDrivers();
});

// ---------------------------------------------------------
// Settlement requests
// ---------------------------------------------------------
async function loadRequests() {
  const { data } = await supabaseClient
    .from("settlement_requests")
    .select("*, profiles!settlement_requests_driver_id_fkey(full_name)")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  const list = data || [];
  document.getElementById("reqDot").style.display = list.length ? "block" : "none";
  renderRequests(list);
}

function renderRequests(list) {
  const wrap = document.getElementById("requestsList");
  if (!list.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="emoji">📭</div>مفيش طلبات تسوية دلوقتي</div>`;
    return;
  }
  wrap.innerHTML = list.map((r) => `
    <div class="driver-card" style="cursor:default; flex-direction:column; align-items:stretch;">
      <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
        <div>
          <div class="name">${escapeHtml(r.profiles ? r.profiles.full_name : "مندوب")}</div>
          <div class="sub">${formatDate(r.created_at)}</div>
        </div>
        <div class="amt mono" style="color:var(--brand)">${formatMoney(r.requested_amount)} ج</div>
      </div>
      ${r.note ? `<div class="t-note" style="margin-top:8px;">${escapeHtml(r.note)}</div>` : ""}
      <div style="display:flex; gap:8px; margin-top:12px;">
        <button class="btn btn-credit btn-sm" style="flex:1;" onclick="resolveRequest('${r.id}', 'approved')">✓ موافقة</button>
        <button class="btn btn-debit btn-sm" style="flex:1;" onclick="resolveRequest('${r.id}', 'rejected')">✕ رفض</button>
      </div>
    </div>
  `).join("");
}

async function resolveRequest(requestId, decision) {
  const { data: reqRow } = await supabaseClient
    .from("settlement_requests")
    .select("*")
    .eq("id", requestId)
    .single();

  if (!reqRow) return;

  if (decision === "approved") {
    const settlementType = txTypes.find((t) => t.name === "تسوية");
    const { error: txError } = await supabaseClient.from("transactions").insert({
      driver_id: reqRow.driver_id,
      type_id: settlementType ? settlementType.id : null,
      amount: -Math.abs(reqRow.requested_amount),
      note: reqRow.note || "تسوية عبر طلب المندوب",
      created_by: adminProfile.id,
    });
    if (txError) {
      showToast("حصل خطأ في تسجيل التسوية", "error");
      return;
    }
  }

  const { error } = await supabaseClient
    .from("settlement_requests")
    .update({ status: decision, resolved_at: new Date().toISOString(), resolved_by: adminProfile.id })
    .eq("id", requestId);

  if (error) {
    showToast("حصل خطأ", "error");
    return;
  }

  showToast(decision === "approved" ? "تمت الموافقة وتحديث الحساب ✓" : "تم رفض الطلب");
  await Promise.all([loadRequests(), loadDrivers()]);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

init();
