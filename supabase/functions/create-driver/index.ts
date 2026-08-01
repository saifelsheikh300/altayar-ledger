// Edge Function: create-driver
// بتنشئ حساب Auth للمندوب + صف في profiles، بس لو الطالب أدمن فعلاً
// السيرفر بيستخدم SUPABASE_SERVICE_ROLE_KEY (متاح تلقائيًا هنا) ومتوصلش للمتصفح أبدًا

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("لازم تكون مسجل دخول");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    // تحقق من هوية اللي طالب العملية عن طريق التوكن بتاعه
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) throw new Error("جلسة الدخول مش صحيحة");

    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!callerProfile || callerProfile.role !== "admin") {
      throw new Error("مسموح للأدمن بس");
    }

    const { email, password, full_name, phone } = await req.json();
    if (!email || !password || !full_name) {
      throw new Error("بيانات ناقصة: الإيميل والباسورد والاسم مطلوبين");
    }
    if (password.length < 6) {
      throw new Error("الباسورد لازم يكون 6 حروف/أرقام على الأقل");
    }

    const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
    });
    if (createErr) throw new Error(createErr.message);

    const { error: profileErr } = await adminClient.from("profiles").insert({
      id: newUser.user.id,
      full_name,
      phone: phone || null,
      role: "driver",
    });
    if (profileErr) {
      // لو فشل إدخال البروفايل، امسح حساب الـ Auth عشان مايفضلش يتيم
      await adminClient.auth.admin.deleteUser(newUser.user.id);
      throw new Error(profileErr.message);
    }

    return new Response(JSON.stringify({ success: true, id: newUser.user.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
