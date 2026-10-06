import { UseInterceptors, applyDecorators } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';

// 🎯 สร้าง Interface เพื่อล็อกฟอร์แมตข้อมูลที่จะส่งเข้ามา (เพิ่มความปลอดภัยให้ TypeScript)
export interface UploadFieldStructure {
  name: string;
  maxCount: number;
}

/**
 * 🚀 Super Shared Interceptor สำหรับดักจับการอัปโหลดหลายฟิลด์แบบไดนามิก
 * @param fields อาร์เรย์ของฟิลด์ที่ต้องการรับ เช่น [{ name: 'file_desktop', maxCount: 1 }]
 * @param destinationPath โฟลเดอร์ปลายทาง (ค่าเริ่มต้นคือ './uploads')
 * @param maxMBSize ขนาดไฟล์สูงสุดต่อรูป (หน่วยเป็น MB ค่าเริ่มต้นคือ 2MB)
 */
export function UploadMultipleFields(
  fields: UploadFieldStructure[], // 🎯 รับฟิลด์อะไรเข้ามากก็ได้จากภายนอก
  destinationPath: string = './uploads',
  maxMBSize: number = 2,
  filePattern: RegExp = /\.(jpg|jpeg|png|gif|webp|pdf|csv)$/i,
  // 🎯 เมื่อ false: ปิด multer-level fileSize/fileFilter ทั้งคู่ ปล่อยให้ทุกไฟล์เข้ามาก่อน
  // แล้วให้ service ตรวจสอบต่อไฟล์เอง — ป้องกันไฟล์เดียวที่เกินขนาด/ผิดชนิดทำให้ทั้ง
  // multipart request abort ก่อน FileFieldsInterceptor resolve (multer aborts the whole
  // request, not just the offending file, so this must stay opt-in per route).
  abortOnInvalidFile: boolean = true,
) {
  return applyDecorators(
    UseInterceptors(
      FileFieldsInterceptor(
        fields, // 🔥 เสียบอาร์เรย์ฟิลด์แบบไดนามิกตรงนี้เลย!
        {
          storage: diskStorage({
            destination: destinationPath,
            filename: (req, file, callback) => {
              const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
              const ext = extname(file.originalname);
              // ตั้งชื่อไฟล์ตามชื่อฟิลด์จริงที่ส่งมาอัตโนมัติ
              callback(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
            },
          }),
          ...(abortOnInvalidFile
            ? {
                limits: {
                  fileSize: maxMBSize * 1024 * 1024 // คำนวณขนาดไฟล์ตามใจชอบ
                },
                fileFilter: (req, file, callback) => {
                  // อนุญาตเฉพาะไฟล์รูปภาพ, pdf และ csv (ปรับเพิ่มตามประเภทงานส่วนใหญ่ได้เลยครับ)
                  if (!file.originalname.match(filePattern)) {
                    return callback(new Error('ประเภทไฟล์ไม่ถูกต้อง'), false);
                  }
                  callback(null, true);
                },
              }
            : {}),
        },
      ),
    ),
  );
}