let currentProfile = null;
let currentBalance = 0;
let currentTxs = [];

async function init() {
  currentProfile = await guardPage("driver");
  if (!currentProfile) return;

  document.getElementById("driverName").textContent = currentProfile.full_name;

  await checkNotifications();
  await loadTransactions();
  await loadPendingSettlement();

  document.getElementById("printStatementBtn").addEventListener("click", () => {
    openStatementPrint(currentProfile.full_name, currentBalance, currentTxs);
  });
}

async function checkNotifications() {
  const lastSeen = currentProfile.last_seen_at || currentProfile.created_at;

  const [{ data: newTxs }, { data: resolvedRequests }] = await Promise.all([
    supabaseClient.from("transactions").select("id").eq("driver_id", currentProfile.id).gt("created_at", lastSeen),
    supabaseClient.from("settlement_requests").select("id, status").eq("driver_id", currentProfile.id).neq("status", "pending").gt("resolved_at", lastSeen),
  ]);

  const newCount = (newTxs || []).length;
  const approvedCount = (resolvedRequests || []).filter((r) => r.status === "approved").length;
  const rejectedCount = (resolvedRequests || []).filter((r) => r.status === "rejected").length;

  const banner = document.getElementById("notifyBanner");
  const parts = [];
  if (newCount) parts.push(`🔔 ${newCount} عملية جديدة اتسجلت على حسابك`);
  if (approvedCount) parts.push(`✅ الأدمن وافق على طلب تسويتك`);
  if (rejectedCount) parts.push(`⚠️ الأدمن رفض طلب تسويتك`);

  if (parts.length) {
    banner.style.display = "block";
    banner.innerHTML = parts.join(" · ");
  } else {
    banner.style.display = "none";
  }

  // حدّث آخر ظهور بعد ما عرضنا التحديثات
  await supabaseClient.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", currentProfile.id);
}

async function loadTransactions() {
  const { data: txs, error } = await supabaseClient
    .from("transactions")
    .select("*, transaction_types(name, color)")
    .eq("driver_id", currentProfile.id)
    .order("created_at", { ascending: false });

  if (error) {
    showToast("حصل خطأ في تحميل الحركات", "error");
    return;
  }

  currentBalance = (txs || []).reduce((sum, t) => sum + Number(t.amount), 0);
  currentTxs = txs || [];
  renderBalance(currentBalance);
  renderTimeline(txs || []);

  document.getElementById("txCount").textContent = `${(txs || []).length} عملية`;
  if (txs && txs.length) {
    document.getElementById("lastUpdate").textContent = "آخر تحديث " + formatDate(txs[0].created_at);
  }
}

function renderBalance(balance) {
  const amountEl = document.getElementById("balanceAmount");
  const statusEl = document.getElementById("balanceStatus");

  let cls = "zero", label = "حسابك متزود ✓";
  if (balance > 0.009) { cls = "debit"; label = "عليك للأدمن"; }
  else if (balance < -0.009) { cls = "credit"; label = "ليك عند الأدمن"; }

  amountEl.className = `balance-amount amount ${cls}`;
  statusEl.className = `balance-status ${cls}`;
  statusEl.textContent = label;

  animateNumber(amountEl, Math.abs(balance));
}

function renderTimeline(txs) {
  const wrap = document.getElementById("timeline");
  if (!txs.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="emoji">🧾</div>مفيش أي حركات مسجلة لسه</div>`;
    return;
  }
  wrap.innerHTML = txs.map((t, i) => {
    const isDebit = Number(t.amount) > 0;
    const cls = isDebit ? "debit" : "credit";
    const icon = isDebit ? "↑" : "↓";
    const typeName = t.transaction_types ? t.transaction_types.name : "عملية";
    return `
      <div class="t-row" style="animation-delay:${i * 40}ms">
        <div class="t-dot ${cls}">${icon}</div>
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

async function loadPendingSettlement() {
  const { data } = await supabaseClient
    .from("settlement_requests")
    .select("*")
    .eq("driver_id", currentProfile.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);

  const banner = document.getElementById("pendingBanner");
  const settleBtn = document.getElementById("requestSettleBtn");
  if (data && data.length) {
    document.getElementById("pendingAmount").textContent = formatMoney(data[0].requested_amount);
    banner.style.display = "flex";
    settleBtn.disabled = true;
    settleBtn.textContent = "⏳ في انتظار موافقة الأدمن";
  } else {
    banner.style.display = "none";
    settleBtn.disabled = false;
    settleBtn.textContent = "📮 طلب تسوية";
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Sheet controls ----------
const sheetBackdrop = document.getElementById("sheetBackdrop");
document.getElementById("requestSettleBtn").addEventListener("click", () => {
  document.getElementById("settleAmount").value = Math.abs(currentBalance).toFixed(2);
  document.getElementById("settleNote").value = "";
  sheetBackdrop.classList.add("open");
});
document.getElementById("cancelSettleBtn").addEventListener("click", () => sheetBackdrop.classList.remove("open"));
sheetBackdrop.addEventListener("click", (e) => { if (e.target === sheetBackdrop) sheetBackdrop.classList.remove("open"); });

document.getElementById("submitSettleBtn").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("settleAmount").value);
  const note = document.getElementById("settleNote").value.trim();
  if (!amount || amount <= 0) {
    showToast("اكتب مبلغ صحيح", "error");
    return;
  }
  const btn = document.getElementById("submitSettleBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="dots-loader"><span></span><span></span><span></span><span></span></span>';

  const { error } = await supabaseClient.from("settlement_requests").insert({
    driver_id: currentProfile.id,
    requested_amount: amount,
    note: note || null,
  });

  btn.disabled = false;
  btn.textContent = "إرسال الطلب";

  if (error) {
    showToast("حصل خطأ، حاول تاني", "error");
    return;
  }
  sheetBackdrop.classList.remove("open");
  showToast("تم إرسال طلب التسوية ✓");
  await loadPendingSettlement();
});

document.getElementById("logoutBtn").addEventListener("click", logoutUser);

init();
