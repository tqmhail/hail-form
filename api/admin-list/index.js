/**
 * Azure Function: admin-list
 * تُرجع كل الطلبات للوحة الإدارية — محمية بتسجيل دخول + قائمة بيضاء.
 * فقط البريد المدرج في ALLOWED_ADMINS يمكنه القراءة.
 */
const { TableClient } = require("@azure/data-tables");

// ===== القائمة البيضاء: عدّل هذه بالبُرد المسموح لها =====
// ضع بريد كل مسؤول مسموح له (بأحرف صغيرة). أضف/احذف حسب الحاجة.
const ALLOWED_ADMINS = [
  "oshl@hotmail.com",
  "colleague1@example.com",
  "colleague2@example.com"
];

module.exports = async function (context, req) {
  const respond = (status, body) => {
    context.res = { status, headers: { "Content-Type": "application/json" }, body };
  };

  try {
    // 1) قراءة هوية المستخدم من Azure Static Web Apps
    let email = "";
    const header = req.headers["x-ms-client-principal"];
    if (header) {
      const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
      email = (decoded.userDetails || "").toLowerCase();
    }

    // 2) التحقق من القائمة البيضاء
    if (!email || ALLOWED_ADMINS.map(e => e.toLowerCase()).indexOf(email) === -1) {
      return respond(403, { ok: false, error: "غير مصرّح لك بالوصول إلى هذه اللوحة." });
    }

    // 3) قراءة الطلبات
    const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!conn) return respond(500, { ok: false, error: "النظام غير مهيّأ." });

    const requests = TableClient.fromConnectionString(conn, "Requests");
    const rows = [];
    const iter = requests.listEntities();
    for await (const e of iter) {
      rows.push({
        requestNo: e.RequestNo || "",
        submittedAt: e.SubmittedAt || "",
        fullName: e.FullName || "",
        nationalId: e.NationalId || "",
        mobile: e.Mobile || "",
        relativeMobile: e.RelativeMobile || "",
        email: e.Email || "",
        gender: e.Gender || "",
        residence: e.Residence || "",
        eduDept: e.EduDept || "",
        gradYear: e.GradYear || "",
        major: e.Major || "",
        requestType: e.RequestType || "",
        documents: e.Documents || ""
      });
    }

    // ترتيب حسب رقم الطلب
    rows.sort((a, b) => (a.requestNo || "").localeCompare(b.requestNo || ""));

    return respond(200, { ok: true, count: rows.length, rows, admin: email });
  } catch (err) {
    context.log.error(err);
    return respond(500, { ok: false, error: "خطأ: " + (err.message || err) });
  }
};
