// دوال مشتركة للمصادقة والتوجيه حسب الدور

async function loginUser(email, password) {
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
