// توليد استمارة إقرار PDF عربية — تُستدعى من دالة submit
const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const reshaper = require("arabic-reshaper");
const fs = require("fs");
const path = require("path");

function ar(t){
  let s = reshaper.convertArabic(String(t));
  s = s.replace(/[0-9\u0660-\u0669A-Za-z@][0-9\u0660-\u0669A-Za-z@._\-/:,]*/g, m => m.split("").reverse().join(""));
  return s;
}

async function buildAckPdf(d, reqNo, dateStr){
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync(path.join(__dirname, "amiri.ttf")));
  const page = doc.addPage([595, 842]);
  const W = 595; let y = 800;
  const teal = rgb(0.06,0.43,0.43), gray = rgb(0.4,0.4,0.4), green = rgb(0.1,0.5,0.35);
  const R = (txt,size,color=rgb(0,0,0),gap=9)=>{ const t=ar(txt); const w=font.widthOfTextAtSize(t,size); page.drawText(t,{x:W-45-w,y,size,font,color}); y-=size+gap; };
  const line = ()=>{ page.drawLine({start:{x:45,y:y+4},end:{x:W-45,y:y+4},thickness:0.7,color:rgb(0.8,0.85,0.85)}); y-=10; };

  R("وزارة التعليم",16,teal,3);
  R("الإدارة العامة للتعليم بمنطقة حائل",11,gray,2);
  R("إدارة تقويم الأداء المعرفي والمهاري",10,gray);
  y-=8; line();
  R("استمارة التسجيل المبدئي لإعادة إصدار شهادة إتمام الثانوية العامة 1448هـ",13,teal); y-=6;

  R("رقم الطلب: " + reqNo, 12);
  R("الاسم الرباعي: " + (d.fullName||""), 11);
  R("رقم الهوية: " + (d.nationalId||""), 11);
  R("رقم الجوال: " + (d.mobile||""), 11);
  R("جوال أحد الأقارب: " + (d.relativeMobile||""), 11);
  R("البريد الإلكتروني: " + (d.email||""), 11);
  R("الجنس: " + (d.gender||"") + "   -   مقر السكن: " + (d.residence||""), 11);
  R("إدارة التعليم المتخرج منها: " + (d.eduDept||""), 11);
  R("عام التخرج: " + (d.gradYear||"") + "   -   تخصص الشهادة: " + (d.major||""), 11);
  R("نوع الطلب: " + (d.requestType||""), 11);
  y-=6; line();

  R("الشروط والإقرارات التي وافق عليها المتقدم:",12,teal); y-=2;
  const items = [
    "أن يكون المتقدم سعوديًا.",
    "أن يكون قد حصل على شهادة الثانوية العامة في المملكة العربية السعودية في العام 1430/1431هـ وما بعده، أو ما يعادلها.",
    "أن يكون قد مضى على تخرجه خمس سنوات فأكثر.",
    "ألا يكون قد حصل على مؤهل أكاديمي أعلى من شهادة الثانوية العامة.",
    "الإقرار بأن فرصة إعادة الإصدار تتاح مرة واحدة فقط، وأنه لم يسبق له التقدّم.",
    "الإقرار بأن أداء اختبار القدرات والتحصيلي خاضع لاشتراطات هيئة تقويم التعليم والتدريب.",
    "الإقرار بأن قبول الشهادة المعاد إصدارها في الجامعات خاضع لسياسة القبول.",
    "التعهّد بصحة البيانات المدخلة في النموذج."
  ];
  items.forEach(it => R("•  " + it, 9.5, rgb(0.15,0.2,0.2), 6));
  y-=10; line(); y-=4;

  R("تمت المصادقة على البيانات إلكترونياً",13,green,3);
  R("بتاريخ " + dateStr + " (بتوقيت السعودية)",10,gray);
  R("هذه الاستمارة مُولّدة إلكترونياً وموثّقة برقم الطلب أعلاه ولا تحتاج توقيعاً يدوياً.",9,gray);

  return Buffer.from(await doc.save());
}
module.exports = { buildAckPdf };
