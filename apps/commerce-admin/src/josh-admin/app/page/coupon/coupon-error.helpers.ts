/** ดึง message จาก NestJS error response (string หรือ array จาก ValidationPipe) */
export function extractApiError(
  error: unknown,
  fallback = 'เกิดข้อผิดพลาดในการบันทึก',
): string {
  const message = (error as { response?: { data?: { message?: string | string[] } } })
    ?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.trim()) return message;
  return fallback;
}
