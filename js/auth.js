// دوال مشتركة للمصادقة والتوجيه حسب الدور

async function loginUser(identifier, password) {
  let email = identifier.trim();

  if (!email.includes("@")) {
    // اعتبره رقم تليفون ودور على الإيميل المرتبط بيه
    const { data: resolvedEmail, error: lookupErr } = await supabaseClient.rpc("email_for_phone", { p_phone: email });
    if (lookupErr || !resolvedEmail) {
      throw new Error("مفيش حساب مسجل بالرقم ده");
    }
    email = resolvedEmail;
  }

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw error;
  return data;
}

async function logoutUser() {
  await supabaseClient.auth.signOut();
  window.location.href = "index.html";
}

// بيرجع البروفايل الحالي (اسم، دور...) أو null لو مفيش جلسة
async function getCurrentProfile() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return null;

  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", session.user.id)
    .single();

  if (error || !profile) return null;
  return profile;
}

// حارس صفحة: لازم يكون فيه جلسة وبالدور المطلوب، غير كده يرجع لصفحة الدخول
async function guardPage(requiredRole) {
  const profile = await getCurrentProfile();
  if (!profile) {
    window.location.href = "index.html";
    return null;
  }
  if (requiredRole && profile.role !== requiredRole) {
    window.location.href = profile.role === "admin" ? "admin.html" : "driver.html";
    return null;
  }
  return profile;
}

function showToast(message, type = "success") {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function formatMoney(n) {
  const abs = Math.abs(n);
  return abs.toLocaleString("ar-EG", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("ar-EG", { day: "numeric", month: "short", year: "numeric" }) +
    " · " + d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
}

// عداد متحرك للأرقام (count-up)
function animateNumber(el, target, duration = 800) {
  const start = 0;
  const startTime = performance.now();
  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = start + (target - start) * eased;
    el.textContent = formatMoney(value);
    if (progress < 1) requestAnimationFrame(tick);
    else el.textContent = formatMoney(target);
  }
  requestAnimationFrame(tick);
}

// فتح نافذة كشف حساب قابلة للطباعة/الحفظ كـ PDF عن طريق طباعة المتصفح
function openStatementPrint(driverName, balance, txs) {
  const cls = balance > 0.009 ? "debit" : balance < -0.009 ? "credit" : "zero";
  const label = cls === "debit" ? "عليه للأدمن" : cls === "credit" ? "له عند الأدمن" : "الحساب متزود";
  const color = cls === "debit" ? "#e63946" : cls === "credit" ? "#2bb673" : "#666";

  const rows = txs.map((t) => {
    const isDebit = Number(t.amount) > 0;
    const typeName = t.transaction_types ? t.transaction_types.name : "عملية";
    return `<tr>
      <td>${formatDate(t.created_at)}</td>
      <td>${typeName}</td>
      <td>${t.note ? t.note.replace(/</g, "&lt;") : "—"}</td>
      <td style="color:${isDebit ? "#e63946" : "#2bb673"}; font-weight:700;">${isDebit ? "" : "-"}${formatMoney(Math.abs(t.amount))} ج</td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
  <html lang="ar" dir="rtl"><head><meta charset="UTF-8">
  <title>كشف حساب - ${driverName}</title>
  <style>
    body { font-family: 'Tahoma', 'Arial', sans-serif; padding: 30px; color: #1a1a1a; }
    .header { display:flex; justify-content:space-between; align-items:center; border-bottom: 3px solid #fd5003; padding-bottom: 14px; margin-bottom: 20px; }
    .header h1 { margin:0; font-size: 20px; color: #fd5003; }
    .header .meta { text-align:left; font-size: 12px; color: #666; }
    .summary { display:flex; justify-content:space-between; align-items:center; background:#f5f5f5; border-radius:10px; padding:16px 20px; margin-bottom:22px; }
    .summary .name { font-size:16px; font-weight:700; }
    .summary .bal { font-size: 24px; font-weight:800; color:${color}; }
    .summary .bal-label { font-size:12px; color:#666; }
    table { width:100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 9px 10px; text-align: right; border-bottom: 1px solid #e5e5e5; }
    th { background:#fafafa; color:#666; font-size:12px; }
    @media print { body { padding: 10px; } }
  </style></head>
  <body>
    <div class="header">
      <h1>حسابات الطيار</h1>
      <div class="meta">اتطبع بتاريخ ${new Date().toLocaleDateString("ar-EG")}</div>
    </div>
    <div class="summary">
      <div>
        <div class="name">${driverName}</div>
        <div class="bal-label">${label}</div>
      </div>
      <div class="bal">${formatMoney(Math.abs(balance))} ج</div>
    </div>
    <table>
      <thead><tr><th>التاريخ</th><th>النوع</th><th>ملاحظة</th><th>المبلغ</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" style="text-align:center; color:#999;">مفيش حركات</td></tr>'}</tbody>
    </table>
  </body></html>`;

  const win = window.open("", "_blank");
  if (!win) { showToast("افتح نافذة جديدة مسموح بيها في المتصفح", "error"); return; }
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 350);
}
