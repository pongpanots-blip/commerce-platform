import styles from './text.module.css';

// 1. กำหนด Interface สำหรับ Props (ถ้าคุณใช้ TypeScript)
interface TextProps {
  bold?: boolean;
  text?: string;
  size?: 'sm' | 'base' | 'lg' | 'xl' | '2xl'; // เพิ่มออปชันขนาดตัวอักษร
}

export function Text({ bold = false, text = '', size = 'base' }: TextProps) {
  
  // 2. แมปขนาดตัวอักษรให้เป็นแบบ Responsive (เล็กในมือถือ - ใหญ่ขึ้นในจอคอม)
  const sizeClasses = {
    sm: 'text-xs md:text-sm',
    base: 'text-sm md:text-base',       // ค่าเริ่มต้น: มือถือตัวเล็ก คอมตัวปกติ
    lg: 'text-base md:text-lg',
    xl: 'text-lg md:text-xl',
    '2xl': 'text-xl md:text-2xl font-semibold tracking-tight', // ขนาดหัวข้อ
  };

  return (
    <div>
      {/* 3. รวมคลาสทั้งหมดเข้าด้วยกัน: สีหลัก + ขนาดแบบ Responsive + เช็กความหนา */}
      <p 
        className={`
        
          ${sizeClasses[size]} 
          ${bold ? 'font-bold' : 'font-normal'}
        `}
      >
        {text}
      </p>
    </div>
  );
}

export default Text;