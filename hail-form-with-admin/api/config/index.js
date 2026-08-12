/**
 * Azure Function: config
 * تُرجع حالة فترة التسجيل ليعتمدها المتصفح (اختياري — الواجهة تحسبها أيضاً).
 * وجودها يجعل الخادم مرجعاً موحّداً للتاريخ.
 */
const REG_START = new Date("2026-08-11T00:00:00+03:00");
const REG_END   = new Date("2026-09-10T23:59:59+03:00");

module.exports = async function (context, req) {
  const now = new Date();
  const open = now >= REG_START && now <= REG_END;
  let state = "open";
  if (now < REG_START) state = "before";
  else if (now > REG_END) state = "after";
  else if (Math.ceil((REG_END - now) / 86400000) <= 3) state = "warn";

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: {
      open,
      state,
      startISO: REG_START.toISOString(),
      endISO: REG_END.toISOString(),
      daysLeft: Math.max(0, Math.ceil((REG_END - now) / 86400000))
    }
  };
};
