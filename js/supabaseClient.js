// إعداد الاتصال بمشروع Supabase الخاص بنظام حسابات المناديب
const SUPABASE_URL = "https://rnsakfkwuqqiqvowbade.supabase.co";
const SUPABASE_KEY = "sb_publishable_8u1bvsoDR3fht1oYJFFgkA_Qfjg3B3I";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// تحويل اسم المستخدم لإيميل داخلي (المناديب مش محتاجين إيميل حقيقي)
function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@altayar-ledger.local`;
}
