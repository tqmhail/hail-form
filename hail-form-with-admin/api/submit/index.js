/**
 * Azure Function: submit
 * نظام التسجيل المبدئي — الإدارة العامة للتعليم بمنطقة حائل
 * يستقبل الطلب، يتحقق، يمنع التكرار، يحفظ المرفقات، يولّد رقم الطلب.
 *
 * يعتمد على Azure Table Storage (الطلبات + العدّاد) و Blob Storage (المرفقات).
 * إعدادات الاتصال تُقرأ من متغيّر البيئة: AZURE_STORAGE_CONNECTION_STRING
 */

const { TableClient, odata } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");
const crypto = require("crypto");

// ===== فترة التسجيل (بتوقيت السعودية +03:00) =====
const REG_START = new Date("2026-08-11T00:00:00+03:00");
const REG_END   = new Date("2026-09-10T23:59:59+03:00");

// ===== قواعد التحقق (مطابقة للواجهة) =====
const RULES = {
  name:   /^\S+(?:\s+\S+){3,}$/,          // ٤ مقاطع على الأقل
  id:     /^1[0-9]{9,}$/,                 // يبدأ بـ1 و١٠ أرقام فأكثر
  mobile: /^05[0-9]{8,}$/,               // يبدأ بـ05 و١٠ أرقام فأكثر
  email:  /^[^\s@]+@[^\s@]+\.[^\s@]+$/
};

function validate(d) {
  const e = [];
  if (!d) return ["لا توجد بيانات."];
  if (!d.agreed) e.push("يجب الموافقة على جميع الشروط والإقرارات.");
  if (!d.fullName   || !RULES.name.test(String(d.fullName).trim()))   e.push("الرجاء إدخال الاسم رباعياً كاملاً.");
  if (!d.nationalId || !RULES.id.test(String(d.nationalId).trim()))   e.push("رقم الهوية يجب أن يبدأ بـ 1 ولا يقل عن ١٠ أرقام.");
  if (!d.mobile     || !RULES.mobile.test(String(d.mobile).trim()))   e.push("رقم الجوال يجب أن يبدأ بـ 05 ولا يقل عن ١٠ أرقام.");
  if (String(d.mobileConfirm || "").trim() !== String(d.mobile || "").trim()) e.push("رقم تأكيد الجوال لا يطابق رقم الجوال.");
  if (!d.relativeMobile || !RULES.mobile.test(String(d.relativeMobile).trim())) e.push("رقم جوال القريب يجب أن يبدأ بـ 05 ولا يقل عن ١٠ أرقام.");
  else if (String(d.relativeMobile).trim() === String(d.mobile || "").trim()) e.push("يجب أن يكون رقم جوال القريب مختلفاً عن رقم جوالك.");
  if (!d.email      || !RULES.email.test(String(d.email).trim()))     e.push("صيغة البريد الإلكتروني غير صحيحة.");
  if (!d.gender)      e.push("حقل الجنس مطلوب.");
  if (!d.residence)  e.push("حقل مقر السكن مطلوب.");
  if (!d.eduDept)    e.push("حقل إدارة التعليم مطلوب.");
  if (!d.gradYear)   e.push("حقل عام التخرج مطلوب.");
  if (!d.major || !String(d.major).trim()) e.push("حقل تخصص الشهادة مطلوب.");
  if (!d.requestType) e.push("حقل نوع الطلب مطلوب.");
  if (!Array.isArray(d.files) || d.files.length !== 3) e.push("يجب إرفاق ٣ مستندات إلزامية بالضبط.");
  return e;
}

module.exports = async function (context, req) {
  const respond = (status, body) => {
    context.res = { status, headers: { "Content-Type": "application/json" }, body };
  };

  try {
    // 1) التحقق من فترة التسجيل (الخادم هو المرجع)
    const now = new Date();
    if (now < REG_START) return respond(200, { ok: false, errors: ["لم تبدأ فترة التسجيل بعد. تبدأ يوم 11 أغسطس 2026م (28 صفر 1448هـ)."] });
    if (now > REG_END)   return respond(200, { ok: false, errors: ["انتهت فترة التسجيل بتاريخ 10 سبتمبر 2026م (28 ربيع الأول 1448هـ)."] });

    const d = req.body || {};

    // 2) التحقق من صحة البيانات
    const errors = validate(d);
    if (errors.length) return respond(200, { ok: false, errors });

    const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!conn) return respond(200, { ok: false, errors: ["النظام غير مهيّأ: مفقود AZURE_STORAGE_CONNECTION_STRING."] });

    const nid = String(d.nationalId).trim();
    const email = String(d.email).trim().toLowerCase();

    // إنشاء جداول التخزين إن لم تكن موجودة
    const requests = TableClient.fromConnectionString(conn, "Requests");
    const counters = TableClient.fromConnectionString(conn, "Counters");
    await requests.createTable().catch(() => {});
    await counters.createTable().catch(() => {});

    // 3) منع تكرار الهوية (المفتاح الأساسي = الهوية، فالتكرار يُرفض ذرّياً)
    try {
      await requests.getEntity("REQ", nid);
      return respond(200, { ok: false, errors: ["رقم الهوية مسجّل مسبقاً. لا يمكن التقديم أكثر من مرة."] });
    } catch (e) { /* غير موجود = جيد، نكمل */ }

    // 4) منع تكرار البريد (بحث)
    const dup = requests.listEntities({ queryOptions: { filter: odata`Email eq ${email}` } });
    for await (const _ of dup) {
      return respond(200, { ok: false, errors: ["البريد الإلكتروني مستخدم في طلب سابق. لا يمكن التقديم أكثر من مرة."] });
    }

    // 5) رفع المرفقات إلى Blob Storage
    const blobSvc = BlobServiceClient.fromConnectionString(conn);
    const container = blobSvc.getContainerClient("documents");
    await container.createIfNotExists();
    const links = [];
    for (let i = 0; i < d.files.length; i++) {
      const f = d.files[i];
      const buf = Buffer.from(f.data, "base64");
      const safeName = `${nid}/مستند${i + 1}_${(f.name || "file").replace(/[^\w.\-\u0600-\u06FF]/g, "_")}`;
      const block = container.getBlockBlobClient(safeName);
      await block.uploadData(buf, { blobHTTPHeaders: { blobContentType: f.mimeType || "application/octet-stream" } });
      links.push(block.url);
    }

    // 6) توليد رقم الطلب عبر عدّاد ذرّي (ETag) لمنع التكرار عند التزامن
    let seq = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const c = await counters.getEntity("SEQ", "requests").catch(() => null);
        if (!c) {
          seq = 1;
          await counters.createEntity({ partitionKey: "SEQ", rowKey: "requests", value: 1 });
        } else {
          seq = (c.value || 0) + 1;
          await counters.updateEntity({ partitionKey: "SEQ", rowKey: "requests", value: seq }, "Replace", { etag: c.etag });
        }
        break;
      } catch (e) {
        if (attempt === 7) throw e; // فشل بعد محاولات
      }
    }
    const reqNo = "1448-" + String(seq).padStart(6, "0");

    // 7) حفظ الطلب (المفتاح = الهوية لضمان عدم التكرار)
    await requests.createEntity({
      partitionKey: "REQ",
      rowKey: nid,
      RequestNo: reqNo,
      SubmittedAt: new Date().toISOString(),
      FullName: String(d.fullName).trim(),
      NationalId: nid,
      Mobile: String(d.mobile).trim(),
      RelativeMobile: String(d.relativeMobile).trim(),
      Email: email,
      Gender: d.gender,
      Residence: d.residence,
      EduDept: d.eduDept,
      GradYear: d.gradYear,
      Major: String(d.major).trim(),
      RequestType: d.requestType,
      Agreed: "نعم",
      Documents: links.join("\n")
    });

    // 8) (اختياري) إشعار عبر Microsoft 365 — يُضاف لاحقاً عبر Logic App أو Graph

    return respond(200, { ok: true, requestNumber: reqNo });
  } catch (err) {
    context.log.error(err);
    return respond(200, { ok: false, errors: ["حدث خطأ غير متوقع: " + (err.message || err)] });
  }
};
