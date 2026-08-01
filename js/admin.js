let adminProfile = null;
let drivers = [];
let txTypes = [];
let balancesByDriver = {};
let selectedDriverId = null;
let txDirection = "debit"; // debit = عليه (+), credit = له (-)

async function init() {
  adminProfile = await guardPage("admin");
  if (!adminProfile) return;

  await Promise.all([loadTypes(), loadDrivers(), loadRequests()]);
  setupTabs();
  setupTxSheet();
  document.getElementById("logoutBtn").addEventListener("click", logoutUser);
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
  renderStats();
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
  if (!drivers.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="emoji">🏍️</div>لسه مفيش مناديب مضافين<br>ضيفهم من تاب الإعدادات</div>`;
    return;
  }
  wrap.innerHTML = drivers.map((d, i) => {
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
}

function renderDriverTimeline(txs) {
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
      <div class="t-row">
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
    document.getElementById("txAmount").value = "";
    document.getElementById("txNote").value = "";
    txSheetBackdrop.classList.add("open");
  });
  document.getElementById("cancelTxBtn").addEventListener("click", () => txSheetBackdrop.classList.remove("open"));
  txSheetBackdrop.addEventListener("click", (e) => { if (e.target === txSheetBackdrop) txSheetBackdrop.classList.remove("open"); });

  document.querySelectorAll(".segmented .seg").forEach((seg) => {
    seg.addEventListener("click", () => {
      document.querySelectorAll(".segmented .seg").forEach((s) => s.classList.remove("active"));
      seg.classList.add("active");
      txDirection = seg.dataset.dir;
    });
  });

  document.getElementById("submitTxBtn").addEventListener("click", submitTransaction);
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
  btn.innerHTML = '<span class="spinner"></span>';

  const { error } = await supabaseClient.from("transactions").insert({
    driver_id: selectedDriverId,
    type_id: typeId || null,
    amount,
    note: note || null,
    created_by: adminProfile.id,
  });

  btn.disabled = false;
  btn.textContent = "حفظ العملية";

  if (error) {
    showToast("حصل خطأ، حاول تاني", "error");
    return;
  }

  showToast("تمت إضافة العملية ✓");
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
  document.getElementById("typesList").innerHTML = txTypes.map((t) =>
    `<span class="type-chip"><span style="width:8px;height:8px;border-radius:50%;background:${t.color || "var(--brand)"};display:inline-block;"></span>${escapeHtml(t.name)}</span>`
  ).join("") || `<span style="color:var(--text-faint); font-size:13px;">مفيش أنواع لسه</span>`;

  const select = document.getElementById("txType");
  if (select) {
    select.innerHTML = txTypes.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
  }
}

document.getElementById("addTypeBtn").addEventListener("click", async () => {
  const input = document.getElementById("newTypeName");
  const name = input.value.trim();
  if (!name) return;
  const { error } = await supabaseClient.from("transaction_types").insert({ name });
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
  btn.innerHTML = '<span class="spinner"></span>';

  const { data, error } = await supabaseClient.functions.invoke("create-driver", {
    body: { email, password, full_name: name, phone: phone || null },
  });

  btn.disabled = false;
  btn.textContent = "إضافة المندوب";

  if (error || (data && data.error)) {
    showToast((data && data.error) || "حصل خطأ، حاول تاني", "error");
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
